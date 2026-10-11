import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import detect from '../api/detect.mjs';
import { validDetectionReport, segmentDetectionText } from '../js/detection-report.js';

const text = 'A experiência de escrever envolve decisões sobre vocabulário, contexto e intenção. Cada revisão permite avaliar a clareza das ideias e a relação entre os argumentos. A autoria de um texto não pode ser comprovada apenas pelo estilo ou por sua correção gramatical.';
const answer = { classification: 'mixed', confidence: 'low', scores: { human: 0.2, mixed: 0.7, ai: 0.1 }, summary: 'Há indícios mistos, mas a evidência é limitada.', highlighted_ids: [1] };
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
let warnings;
const envNames = ['DEEPSEEK_API_KEY', 'GPTZERO_API_KEY', 'AI_DETECTOR_PROVIDER', 'DEEPSEEK_MODEL', 'DEEPSEEK_DETECTOR_MODEL'];
const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
let ip = 20;
const request = ({ value = text, body, method = 'POST', headers = {}, signal, client } = {}) => new Request('http://localhost/api/detect', {
  method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': client || `198.51.100.${ip++}`, ...headers },
  ...(method !== 'GET' ? { body: body === undefined ? JSON.stringify({ text: value }) : body } : {}), signal
});
const providerResponse = (result = answer, finish = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(result) } }] }), { status: 200 });

beforeEach(() => {
  envNames.forEach((name) => delete process.env[name]);
  process.env.DEEPSEEK_API_KEY = 'test-server-secret';
  globalThis.fetch = async () => providerResponse();
  warnings = [];
  console.warn = (...args) => warnings.push(args);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  envNames.forEach((name) => {
    if (previousEnv[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[name];
  });
});

test('endpoint valida método, origem, JSON, tipo e limites antes de acessar provedor', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return providerResponse(); };
  for (const [options, status] of [
    [{ method: 'GET' }, 405], [{ headers: { Origin: 'https://attacker.example' } }, 403],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415], [{ body: '{bad' }, 400],
    [{ body: 'null' }, 400], [{ value: 'curto' }, 400], [{ value: '' }, 400],
    [{ value: 'a'.repeat(50001) }, 413], [{ headers: { 'Content-Length': '999999' } }, 413]
  ]) assert.equal((await detect.fetch(request(options))).status, status);
  assert.equal(calls, 0);
});

test('DeepSeek retorna análise real via JSON e destaca somente posições do original', async () => {
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, headers: options.headers, body: JSON.parse(options.body) };
    return providerResponse();
  };
  const response = await detect.fetch(request());
  const report = await response.json();
  assert.equal(response.status, 200);
  assert.ok(validDetectionReport(report, text));
  assert.equal(report.provider, 'deepseek');
  assert.equal(report.scoreKind, 'model_assessment');
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured.headers.Authorization, 'Bearer test-server-secret');
  assert.equal(captured.body.response_format.type, 'json_object');
  assert.equal(captured.body.model, 'deepseek-flash');
  assert.match(captured.body.messages[0].content, /dados não confiáveis/u);
  assert.match(captured.body.messages[0].content, /Exemplo apenas de formato JSON/u);
  assert.equal(JSON.parse(captured.body.messages[1].content).document, text);
  const segment = segmentDetectionText(text)[1];
  assert.equal(text.slice(report.highlights[0].start, report.highlights[0].end), segment.text);
  assert.equal(JSON.stringify(report).includes('test-server-secret'), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('sem chave não inventa resultado, e configuração seleciona somente provedor autorizado', async () => {
  delete process.env.DEEPSEEK_API_KEY;
  let called = false;
  globalThis.fetch = async () => { called = true; return providerResponse(); };
  const response = await detect.fetch(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'DETECTOR_NOT_CONFIGURED');
  assert.equal(called, false);
  process.env.DEEPSEEK_API_KEY = 'test-server-secret';
  process.env.AI_DETECTOR_PROVIDER = 'gptzero';
  assert.equal((await detect.fetch(request())).status, 503);
});

test('API oficial do GPTZero preserva probabilidades e destaques, inclusive frases repetidas', async () => {
  process.env.GPTZERO_API_KEY = 'test-gptzero-secret';
  const sentence = 'Esta frase aparece várias vezes no documento para testar o destaque correto.';
  const repeated = `${sentence}\n\n${sentence}\n\n${sentence}\n\n${sentence}`;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ documents: [{ document_classification: 'AI_ONLY', confidence_category: 'high',
      class_probabilities: { human: 0.01, mixed: 0.09, ai: 0.9 },
      sentences: [false, true, false, true].map((highlight) => ({ sentence, highlight_sentence_for_ai: highlight }))
    }] }), { status: 200 });
  };
  const report = await (await detect.fetch(request({ value: repeated }))).json();
  assert.ok(validDetectionReport(report, repeated));
  assert.equal(report.provider, 'gptzero');
  assert.deepEqual(report.scores, { human: 0.01, mixed: 0.09, ai: 0.9 });
  assert.equal(report.highlights[0].start, sentence.length + 2);
  assert.equal(report.highlights[1].start, 3 * (sentence.length + 2));
  assert.equal(captured.url, 'https://api.gptzero.me/v2/predict/text');
  assert.equal(captured.options.headers['x-api-key'], 'test-gptzero-secret');
  assert.deepEqual(captured.body, { document: repeated });
  assert.equal(JSON.stringify(report).includes('secret'), false);
});

test('rejeita respostas inválidas, truncadas, scores impossíveis e IDs inexistentes', async () => {
  for (const result of [
    { ...answer, scores: { human: 0.9, mixed: 0.7, ai: 0.1 } },
    { ...answer, scores: { human: 0.9, mixed: 0.7, ai: -0.6 } },
    { ...answer, highlighted_ids: [99999] }, { ...answer, classification: 'ai' },
    { ...answer, confidence: 'certeza' }
  ]) {
    globalThis.fetch = async () => providerResponse(result);
    assert.equal((await detect.fetch(request())).status, 502);
  }
  globalThis.fetch = async () => providerResponse(answer, 'length');
  assert.equal((await detect.fetch(request())).status, 502);
  globalThis.fetch = async () => new Response('not JSON');
  assert.equal((await detect.fetch(request())).status, 502);
});

test('recupera resposta inválida com uma única nova análise validada do mesmo documento', async () => {
  const invalidResponses = [
    () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '' } }] })),
    () => providerResponse(answer, 'length'),
    () => new Response('not JSON'),
    () => providerResponse({ ...answer, scores: { human: 0.9, mixed: 0.7, ai: 0.1 } }),
    () => providerResponse({ ...answer, classification: 'ai' }),
    () => providerResponse({ ...answer, highlighted_ids: [99999] })
  ];
  for (const invalid of invalidResponses) {
    const calls = [];
    globalThis.fetch = async (_, options) => {
      calls.push(options);
      return calls.length === 1 ? invalid() : providerResponse();
    };
    const response = await detect.fetch(request());
    const report = await response.json();
    assert.equal(response.status, 200);
    assert.ok(validDetectionReport(report, text));
    assert.deepEqual(report.scores, answer.scores);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal, calls[1].signal, 'as tentativas compartilham o prazo e cancelamento');
    const retryBody = JSON.parse(calls[1].body);
    assert.match(retryBody.messages[0].content, /Uma tentativa anterior/u);
    assert.equal(JSON.parse(retryBody.messages[1].content).document, text);
  }
  assert.equal(warnings.length, invalidResponses.length);
  assert.equal(JSON.stringify(warnings).includes(text), false);
  assert.equal(JSON.stringify(warnings).includes('test-server-secret'), false);
});

test('segunda resposta inválida encerra recuperação sem inventar relatório ou expor resposta', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return providerResponse({ ...answer, summary: '', private: 'private provider output' });
  };
  const response = await detect.fetch(request());
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.error.code, 'INVALID_PROVIDER_RESPONSE');
  assert.equal(calls, 2);
  assert.equal(body.scores, undefined);
  assert.equal(JSON.stringify([...warnings, body]).includes('private provider output'), false);
  assert.deepEqual(warnings.map(([, metadata]) => metadata.issue), ['summary', 'summary']);
});

test('cancelar a tentativa de recuperação aborta o serviço sem uma terceira chamada', async () => {
  const controller = new AbortController();
  let calls = 0;
  let started;
  const gate = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async (_, options) => {
    calls += 1;
    if (calls === 1) return providerResponse(answer, 'length');
    started();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  const pending = detect.fetch(request({ signal: controller.signal }));
  await gate;
  controller.abort();
  assert.equal((await pending).status, 504);
  assert.equal(calls, 2);
});

test('falhas do provedor são traduzidas sem expor sua resposta', async () => {
  for (const [status, code] of [[401, 'PROVIDER_AUTH_ERROR'], [402, 'PROVIDER_CREDITS_EXHAUSTED'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'PROVIDER_UNAVAILABLE']]) {
    globalThis.fetch = async () => new Response('private provider error with secret', { status });
    const body = await (await detect.fetch(request())).json();
    assert.equal(body.error.code, code);
    assert.equal(JSON.stringify(body).includes('secret'), false);
  }
});

test('cancelamento aborta provedor e duplicatas são bloqueadas durante processamento', async () => {
  const controller = new AbortController();
  let started;
  const gate = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = async (_, options) => {
    started();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  const pending = detect.fetch(request({ signal: controller.signal, client: '198.51.100.200' }));
  await gate;
  assert.equal((await detect.fetch(request({ client: '198.51.100.200' }))).status, 409);
  controller.abort();
  assert.equal((await pending).status, 504);
  globalThis.fetch = async () => providerResponse();
  assert.equal((await detect.fetch(request({ client: '198.51.100.200' }))).status, 200);
});

test('limite de requisições evita repetir análises pagas em excesso', async () => {
  for (let count = 0; count < 8; count += 1) assert.equal((await detect.fetch(request({ client: '198.51.100.201' }))).status, 200);
  assert.equal((await detect.fetch(request({ client: '198.51.100.201' }))).status, 429);
});
