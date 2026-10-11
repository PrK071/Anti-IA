import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatGPTPlan, protectedStore, verifyIdentity } from '../server/chatgpt-plan.mjs';
import { generateKeyPair, SignJWT } from 'jose';
import { createLocalServer } from '../scripts/local.mjs';

const model = { slug: 'account-model', display_name: 'Modelo da conta', visibility: 'list' };

test('identidade exige assinatura, emissor, audiência, validade e nonce corretos', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const sign = (overrides = {}) => new SignJWT({ sub: 'account', nonce: 'expected-nonce', ...overrides }).setProtectedHeader({ alg: 'RS256' })
    .setIssuer(overrides.iss || 'https://auth.openai.com').setAudience(overrides.aud || 'issued-client').setIssuedAt().setExpirationTime(overrides.exp || '5m').sign(privateKey);
  const valid = await sign();
  assert.equal((await verifyIdentity(valid, 'issued-client', 'expected-nonce', publicKey)).sub, 'account');
  for (const overrides of [{ iss: 'https://evil.example' }, { aud: 'other-client' }, { exp: 1 }, { nonce: 'wrong-nonce' }]) {
    await assert.rejects(verifyIdentity(await sign(overrides), 'issued-client', 'expected-nonce', publicKey));
  }
  const differentKeys = await generateKeyPair('RS256');
  await assert.rejects(verifyIdentity(valid, 'issued-client', 'expected-nonce', differentKeys.publicKey));
});
function harness({ scope = 'openid chatgpt.tokens.use.direct', stream, expired = false } = {}) {
  let saved = expired ? { host_id: 'urn:uuid:fixed-host', client_id: 'issued-client', subject: 'account', email: 'test@example.com',
    access_token: 'expired-access', refresh_token: 'test-refresh', expires_at: 0, scopes: scope.split(' ') } : null;
  const calls = [];
  let expectedNonce;
  const tokens = () => ({ access_token: 'test-access', refresh_token: 'test-refresh', id_token: 'test-id', token_type: 'Bearer', expires_in: 3600, scope });
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth/token')) return Response.json(tokens());
    if (url.endsWith('/models')) return Response.json({ models: [model, { ...model, slug: 'hidden', visibility: 'hidden' }] });
    if (url.endsWith('/responses')) return new Response(stream || 'data: {"type":"response.output_text.delta","delta":"Texto revisado."}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    throw new Error('unexpected destination');
  };
  const plan = createChatGPTPlan({ fetcher, store: { load: async () => saved, save: async (value) => { saved = structuredClone(value); } },
    verify: async (_, clientId, nonce) => { assert.equal(clientId, 'issued-client'); if (nonce !== undefined) assert.equal(nonce, expectedNonce); return { sub: 'account', email: 'test@example.com' }; } });
  async function connect() {
    await plan.init();
    const auth = new URL(plan.startLogin('http://127.0.0.1:3187/auth/callback', 'browser-session'));
    expectedNonce = auth.searchParams.get('nonce');
    const callback = new URL('http://127.0.0.1:3187/auth/callback');
    callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'one-time-code', client_id: 'issued-client' });
    await plan.callback(callback, 'browser-session');
    return { auth, callback };
  }
  return { plan, calls, connect, get saved() { return saved; } };
}

test('login oficial usa PKCE, nonce, host persistente e client emitido sem expor credenciais', async () => {
  const h = harness();
  const { auth, callback } = await h.connect();
  assert.equal(auth.origin, 'https://auth.openai.com');
  assert.equal(auth.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(auth.searchParams.get('redirect_uri'), 'http://127.0.0.1:3187/auth/callback');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('code_challenge').length, 43);
  const exchange = h.calls[0].options.body;
  assert.equal(exchange.get('client_id'), 'issued-client');
  assert.equal(exchange.get('code'), 'one-time-code');
  assert.ok(exchange.get('code_verifier').length >= 43);
  const status = JSON.stringify(h.plan.status());
  for (const secret of ['test-access', 'test-refresh', 'test-id', 'one-time-code']) assert.equal(status.includes(secret), false);
  await assert.rejects(h.plan.callback(callback, 'browser-session'), { code: 'INVALID_LOGIN_STATE' });
  const returning = new URL(h.plan.startLogin('http://127.0.0.1:4000/auth/callback', 'browser-session'));
  assert.equal(returning.searchParams.get('client_id'), 'issued-client');
  assert.equal(returning.searchParams.get('ext_agent_host_id'), auth.searchParams.get('ext_agent_host_id'));
});

test('callback de outra sessão, estado incorreto e troca de client são rejeitados antes da troca', async () => {
  const h = harness();
  await h.plan.init();
  const auth = new URL(h.plan.startLogin('http://127.0.0.1:3187/auth/callback', 'browser-session'));
  const callback = new URL('http://127.0.0.1:3187/auth/callback');
  callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'code', client_id: 'issued-client' });
  await assert.rejects(h.plan.callback(callback, 'other-session'), { code: 'INVALID_LOGIN_STATE' });
  callback.searchParams.set('state', 'wrong');
  await assert.rejects(h.plan.callback(callback, 'browser-session'), { code: 'INVALID_LOGIN_STATE' });
  assert.equal(h.calls.length, 0);
});

test('login sem permissão de plano não autoriza inferência nem a confirmação de custo', async () => {
  const h = harness({ scope: 'openid profile email' });
  await h.connect();
  assert.equal(h.plan.status().connected, false);
  assert.throws(() => h.plan.acknowledgeCreditsDisabled(true), { code: 'COST_GUARD_REQUIRED' });
  await assert.rejects(h.plan.listModels(), { code: 'CHATGPT_NOT_CONNECTED' });
  assert.equal(h.calls.filter((call) => call.url.endsWith('/responses')).length, 0);
});

test('reescrita exige confirmação de créditos desativados, modelo da conta e conclusão do stream', async () => {
  const h = harness();
  await h.connect();
  await h.plan.listModels();
  await assert.rejects(h.plan.complete([], model.slug), { code: 'COST_GUARD_REQUIRED' });
  h.plan.acknowledgeCreditsDisabled(true);
  await assert.rejects(h.plan.complete([], 'invented-model'), { code: 'INVALID_MODEL' });
  const output = await h.plan.complete([{ role: 'system', content: 'Preserve os dados.' }, { role: 'user', content: 'Documento' }], model.slug);
  assert.equal(output, 'Texto revisado.');
  const call = h.calls.find((item) => item.url.endsWith('/responses'));
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(call.options.body);
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.instructions, 'Preserve os dados.');
  assert.deepEqual(body.input, [{ role: 'user', content: 'Documento' }]);
  assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'store', 'stream']);
  assert.deepEqual(h.plan.status().models, [{ slug: model.slug, name: model.display_name }]);
});

test('limite após saída parcial pausa chamadas sem resultado parcial, retry ou provedor pago', async () => {
  const h = harness({ stream: 'data: {"type":"response.output_text.delta","delta":"Saída parcial"}\n\ndata: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n' });
  await h.connect(); await h.plan.listModels(); h.plan.acknowledgeCreditsDisabled(true);
  await assert.rejects(h.plan.complete([], model.slug), { code: 'PLAN_LIMIT_REACHED' });
  await assert.rejects(h.plan.complete([], model.slug), { code: 'PLAN_LIMIT_REACHED' });
  assert.equal(h.calls.filter((call) => call.url.endsWith('/responses')).length, 1);
  assert.ok(h.calls.every((call) => call.url.startsWith('https://auth.openai.com/') || call.url.startsWith('https://api.openai.com/v1/')));
  assert.equal(h.plan.status().quotaReached, true);
});

test('stream interrompido ou explicitamente incompleto nunca aplica resultado', async () => {
  for (const stream of ['data: {"type":"response.output_text.delta","delta":"parcial"}\n\n', 'data: {"type":"response.incomplete","response":{"status":"incomplete"}}\n\n']) {
    const h = harness({ stream });
    await h.connect(); await h.plan.listModels(); h.plan.acknowledgeCreditsDisabled(true);
    await assert.rejects(h.plan.complete([], model.slug), { code: 'INCOMPLETE_RESPONSE' });
  }
});

test('refresh rotativo é serializado e desconexão elimina o acesso', async () => {
  const h = harness({ expired: true });
  await h.plan.init();
  await Promise.all([h.plan.listModels(), h.plan.listModels()]);
  assert.equal(h.calls.filter((call) => call.url.endsWith('/oauth/token')).length, 1);
  assert.equal(h.calls[0].options.body.get('grant_type'), 'refresh_token');
  assert.equal(h.calls[0].options.body.get('client_id'), 'issued-client');
  await h.plan.disconnect();
  assert.equal(h.plan.status().connected, false);
  assert.equal(h.saved.access_token, undefined);
  assert.equal(h.saved.refresh_token, undefined);
});

test('DPAPI protege o arquivo de sessão e permite recuperar somente no usuário Windows', { skip: process.platform !== 'win32' }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'avatar-plan-'));
  const filename = join(folder, 'session.bin');
  try {
    const store = protectedStore(filename);
    const value = { access_token: 'fixture-access-not-a-real-secret', host_id: 'fixture-host' };
    await store.save(value);
    assert.deepEqual(await store.load(), value);
    assert.equal((await readFile(filename)).includes(Buffer.from(value.access_token)), false);
  } finally { await unlink(filename); await rmdir(folder); }
});

test('servidor local isola origem, bloqueia arquivos privados e disponibiliza a interface local', async () => {
  const h = harness(); await h.plan.init();
  const server = createLocalServer(h.plan);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${origin}/api/chatgpt/session`);
    const cookie = session.headers.get('set-cookie').split(';')[0];
    assert.equal((await session.json()).app, 'avatar-chatgpt-local');
    const html = await (await fetch(origin)).text();
    assert.match(html, /id="chatgptConnection"/u);
    assert.match(html, /CHATGPT · PLANO/u);
    assert.match(await (await fetch(`${origin}/config.js`)).text(), /requestTimeoutMs: 120_000/u);
    for (const path of ['/.local/chatgpt.bin', '/.env', '/package.json', '/server/chatgpt-plan.mjs']) assert.equal((await fetch(`${origin}${path}`)).status, 404);
    assert.equal((await fetch(`${origin}/api/chatgpt/login`, { method: 'POST', headers: { Origin: 'https://evil.example', Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const login = await fetch(`${origin}/api/chatgpt/login`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(login.status, 200);
    assert.equal(new URL((await login.json()).authorizationUrl).searchParams.get('redirect_uri'), `${origin}/auth/callback`);
    const invalidText = await fetch(`${origin}/api/detect`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"text":1}' });
    assert.equal(invalidText.status, 400);
    assert.equal(h.calls.length, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('reescrita pelo servidor exige a confirmação de custo e entrega o contrato esperado pelo editor', async () => {
  const h = harness(); await h.connect();
  const server = createLocalServer(h.plan);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${origin}/api/chatgpt/session`);
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const post = (path, payload) => fetch(`${origin}${path}`, { method: 'POST',
      headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const payload = { text: 'Documento para revisão.', options: { processingMode: 'precise', writingMode: 'academico', language: 'pt-BR',
      adjustments: { formality: 80, creativity: 20, simplification: 'baixa', length: 'manter', preserveTerms: true, preserveParagraphs: true } } };
    assert.equal((await post('/api/humanize', payload)).status, 403);
    assert.equal(h.calls.filter((call) => call.url.endsWith('/responses')).length, 0);
    const enabled = await post('/api/chatgpt/enable', { creditsDisabled: true });
    assert.equal(enabled.status, 200);
    const rewritten = await post('/api/humanize', payload);
    assert.equal(rewritten.status, 200);
    const result = await rewritten.json();
    assert.equal(result.status, 'completed');
    assert.equal(result.output, 'Texto revisado.');
    assert.equal(result.model, model.slug);
    assert.equal(typeof result.requestId, 'string');
    assert.equal(h.calls.filter((call) => call.url.endsWith('/responses')).length, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
