import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAuthorship } from '../js/detectors.js';
import { segmentDetectionText } from '../js/detection-report.js';

const text = 'Um documento para analisar com todos os caracteres e parágrafos preservados. '.repeat(5);
const report = { status: 'completed', provider: 'deepseek', model: 'deepseek-flash', scoreKind: 'model_assessment',
  classification: 'mixed', confidence: 'low', scores: { human: 0.2, mixed: 0.7, ai: 0.1 }, summary: 'Indícios mistos.',
  wordCount: 55, analyzedAt: '2026-10-10T23:00:00Z', highlights: [{ start: 0, end: 20, reason: 'Indício.' }] };

test('cliente envia o texto ao endpoint interno e valida o relatório', async () => {
  const previousFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => { captured = { url, init }; return new Response(JSON.stringify(report)); };
  try {
    assert.deepEqual(await analyzeAuthorship(text), report);
    assert.equal(captured.url, '/api/detect');
    assert.deepEqual(JSON.parse(captured.init.body), { text });
    assert.equal(captured.init.credentials, 'same-origin');
    globalThis.fetch = async () => new Response(JSON.stringify({ ...report, highlights: [{ start: 0, end: 99999, reason: 'Invalid' }] }));
    assert.equal((await analyzeAuthorship(text)).error.code, 'INVALID_RESPONSE');
    globalThis.fetch = async () => new Response('', { status: 404 });
    assert.match((await analyzeAuthorship(text)).error.message, /npm run dev/u);
  } finally { globalThis.fetch = previousFetch; }
});

test('segmentação mantém offsets Unicode e cobre documentos longos sem truncar', () => {
  const value = ('Ação com 👋 e acentos.\n\n').repeat(500);
  const segments = segmentDetectionText(value);
  assert.ok(segments.length <= 200);
  assert.equal(segments.map((item) => item.text).join(''), value);
  for (const item of segments) assert.equal(value.slice(item.start, item.end), item.text);
});

test('cancelamento do cliente aborta a chamada', async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async (_, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  try {
    const pending = analyzeAuthorship(text, { signal: controller.signal });
    controller.abort();
    assert.equal((await pending).status, 'cancelled');
  } finally { globalThis.fetch = previousFetch; }
});
