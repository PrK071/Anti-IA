import test from 'node:test';
import assert from 'node:assert/strict';
import humanizeApi from '../api/humanize.mjs';

const validPayload = {
  text: 'Em 10/09/2026, Maria confirmou o valor de R$ 25,00.',
  options: {
    processingMode: 'precise',
    writingMode: 'profissional',
    language: 'pt-BR',
    instructions: 'Preserve números e datas.',
    adjustments: {
      formality: 75,
      creativity: 25,
      simplification: 'media',
      length: 'manter',
      preserveTerms: true,
      preserveParagraphs: true
    }
  }
};

function apiRequest({ method = 'POST', body = validPayload, headers = {}, ip = '198.51.100.10' } = {}) {
  const requestHeaders = new Headers({
    'Content-Type': 'application/json',
    'X-Forwarded-For': ip,
    ...headers
  });
  return new Request('https://avatar.example/api/humanize', {
    method,
    headers: requestHeaders,
    body: method === 'GET' ? undefined : JSON.stringify(body)
  });
}

async function json(response) {
  return JSON.parse(await response.text());
}

test('endpoint aceita somente POST', async () => {
  const response = await humanizeApi.fetch(apiRequest({ method: 'GET' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal((await json(response)).error.code, 'METHOD_NOT_ALLOWED');
});

test('endpoint rejeita origem diferente', async () => {
  const response = await humanizeApi.fetch(apiRequest({ headers: { Origin: 'https://attacker.example' }, ip: '198.51.100.11' }));
  assert.equal(response.status, 403);
  assert.equal((await json(response)).error.code, 'ORIGIN_NOT_ALLOWED');
});

test('backend valida texto vazio, limite e opções', async () => {
  const empty = await humanizeApi.fetch(apiRequest({ body: { ...validPayload, text: '   ' }, ip: '198.51.100.12' }));
  assert.equal(empty.status, 400);
  assert.equal((await json(empty)).error.code, 'EMPTY_TEXT');

  const tooLong = await humanizeApi.fetch(apiRequest({ body: { ...validPayload, text: 'a'.repeat(50_001) }, ip: '198.51.100.13' }));
  assert.equal(tooLong.status, 413);
  assert.equal((await json(tooLong)).error.code, 'CHARACTER_LIMIT_EXCEEDED');

  const invalidMode = structuredClone(validPayload);
  invalidMode.options.processingMode = 'inventado';
  const invalid = await humanizeApi.fetch(apiRequest({ body: invalidMode, ip: '198.51.100.14' }));
  assert.equal(invalid.status, 400);
  assert.equal((await json(invalid)).error.code, 'INVALID_PROCESSING_MODE');
});

test('chave ausente retorna erro seguro e não chama provedor', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = globalThis.fetch;
  let called = false;
  delete process.env.DEEPSEEK_API_KEY;
  globalThis.fetch = async () => { called = true; throw new Error('não deveria chamar'); };
  try {
    const response = await humanizeApi.fetch(apiRequest({ ip: '198.51.100.15' }));
    const body = await json(response);
    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'SERVICE_NOT_CONFIGURED');
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('backend chama a API oficial sem expor a chave e retorna o texto', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalModel = process.env.DEEPSEEK_MODEL;
  const originalFetch = globalThis.fetch;
  const secret = 'test-secret-never-return';
  let outbound;
  process.env.DEEPSEEK_API_KEY = secret;
  delete process.env.DEEPSEEK_MODEL;
  globalThis.fetch = async (url, init) => {
    outbound = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: 'Em 10/09/2026, Maria confirmou o valor de R$ 25,00.' } }],
      usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const response = await humanizeApi.fetch(apiRequest({ headers: { Origin: 'https://avatar.example' }, ip: '198.51.100.16' }));
    const raw = await response.text();
    const body = JSON.parse(raw);
    assert.equal(response.status, 200);
    assert.equal(body.status, 'completed');
    assert.equal(body.model, 'deepseek-flash');
    assert.equal(body.output, 'Em 10/09/2026, Maria confirmou o valor de R$ 25,00.');
    assert.equal(raw.includes(secret), false);
    assert.equal(outbound.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(outbound.init.headers.Authorization, `Bearer ${secret}`);
    assert.equal(outbound.body.model, 'deepseek-flash');
    assert.deepEqual(outbound.body.thinking, { type: 'disabled' });
    assert.equal(outbound.body.reasoning_effort, 'none');
    assert.match(outbound.body.messages[1].content, /Modo|máxima fidelidade|Preserve números e datas/i);
    assert.ok(outbound.body.max_tokens <= 16_384);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = originalModel;
  }
});

test('modelo pro só é selecionado por configuração do servidor', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalModel = process.env.DEEPSEEK_MODEL;
  const originalFetch = globalThis.fetch;
  let outboundModel;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-v4-pro';
  globalThis.fetch = async (_url, init) => {
    outboundModel = JSON.parse(init.body).model;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Texto final.' } }] }), { status: 200 });
  };
  try {
    const response = await humanizeApi.fetch(apiRequest({ body: { ...validPayload, options: { ...validPayload.options, model: 'modelo-do-cliente' } }, ip: '198.51.100.17' }));
    assert.equal(response.status, 200);
    assert.equal(outboundModel, 'deepseek-v4-pro');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = originalModel;
  }
});

test('erros do provedor são traduzidos sem vazar detalhes internos', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = 'another-test-secret';
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'provider internal detail' } }), { status: 401 });
  try {
    const response = await humanizeApi.fetch(apiRequest({ ip: '198.51.100.18' }));
    const raw = await response.text();
    const body = JSON.parse(raw);
    assert.equal(response.status, 502);
    assert.equal(body.error.code, 'PROVIDER_AUTH_ERROR');
    assert.equal(raw.includes('provider internal detail'), false);
    assert.equal(raw.includes('another-test-secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('limite, créditos, timeout e resposta inesperada do provedor têm estados próprios', async (t) => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = 'test-key';

  try {
    await t.test('limite de requisições', async () => {
      globalThis.fetch = async () => new Response('{}', { status: 429, headers: { 'Retry-After': '12' } });
      const response = await humanizeApi.fetch(apiRequest({ ip: '198.51.100.19' }));
      assert.equal(response.status, 429);
      assert.equal(response.headers.get('retry-after'), '12');
      assert.equal((await json(response)).error.code, 'PROVIDER_RATE_LIMITED');
    });

    await t.test('créditos insuficientes', async () => {
      globalThis.fetch = async () => new Response('{}', { status: 402 });
      const response = await humanizeApi.fetch(apiRequest({ ip: '198.51.100.20' }));
      assert.equal(response.status, 503);
      assert.equal((await json(response)).error.code, 'PROVIDER_CREDITS_EXHAUSTED');
    });

    await t.test('timeout', async () => {
      globalThis.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
      const response = await humanizeApi.fetch(apiRequest({ ip: '198.51.100.21' }));
      assert.equal(response.status, 504);
      assert.equal((await json(response)).error.code, 'PROVIDER_TIMEOUT');
    });

    await t.test('resposta inesperada', async () => {
      globalThis.fetch = async () => new Response('{invalid', { status: 200 });
      const response = await humanizeApi.fetch(apiRequest({ ip: '198.51.100.22' }));
      assert.equal(response.status, 502);
      assert.equal((await json(response)).error.code, 'INVALID_PROVIDER_RESPONSE');
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test('solicitações idênticas simultâneas são bloqueadas na mesma instância', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  let releaseProvider;
  globalThis.fetch = async () => new Promise((resolve) => {
    releaseProvider = () => resolve(new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: 'Texto final.' } }]
    }), { status: 200 }));
  });

  try {
    const first = humanizeApi.fetch(apiRequest({ ip: '198.51.100.23' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const duplicate = await humanizeApi.fetch(apiRequest({ ip: '198.51.100.23' }));
    assert.equal(duplicate.status, 409);
    assert.equal((await json(duplicate)).error.code, 'DUPLICATE_REQUEST');
    releaseProvider();
    assert.equal((await first).status, 200);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
