import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { createChatGPTPlan, protectedStore, PlanError } from '../server/chatgpt-plan.mjs';
import { validatePayload, buildMessages } from '../api/humanize.mjs';
import { buildDetectionMessages, parseModelDetection } from '../api/detect.mjs';
import { validateDetectionText, segmentDetectionText } from '../js/detection-report.js';
import { jsonResponse, errorResponse, getRequestId, parseRequestBody } from '../server/http.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

export function createLocalServer(plan) {
  const sessions = new Set();
  let selectedModel;
  let busy = false;
  return createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    outgoing.on('close', () => { if (!outgoing.writableEnded) controller.abort(); });
    let requestId;
    try {
      const address = outgoing.socket.localAddress;
      const port = outgoing.socket.localPort;
      const origin = `http://127.0.0.1:${port}`;
      if (address !== '127.0.0.1' || incoming.headers.host !== `127.0.0.1:${port}`) { outgoing.writeHead(403).end(); return; }
      const url = new URL(incoming.url, origin);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
      const hasBody = !['GET', 'HEAD'].includes(incoming.method);
      const request = new Request(url, { method: incoming.method, headers, signal: controller.signal,
        ...(hasBody ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
      requestId = getRequestId(request);
      const reply = async (response) => {
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      };
      let browserSession = /(?:^|;\s*)avatar_local=([a-zA-Z0-9_-]+)/u.exec(incoming.headers.cookie || '')?.[1];
      if (url.pathname === '/api/chatgpt/session' && request.method === 'GET') {
        if (!sessions.has(browserSession)) {
          browserSession = randomBytes(32).toString('base64url');
          if (sessions.size >= 16) sessions.delete(sessions.values().next().value);
          sessions.add(browserSession);
        }
        return reply(jsonResponse(200, { ...plan.status(), selectedModel }, { 'Set-Cookie': `avatar_local=${browserSession}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800` }));
      }
      if (url.pathname === '/auth/callback' && request.method === 'GET') {
        await plan.callback(url, browserSession);
        selectedModel = undefined;
        return reply(new Response('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Anti IA — ChatGPT conectado</title><body style="font:18px system-ui;background:#111116;color:#eee;padding:48px"><h1>Login concluído</h1><p>Volte à janela do Anti IA Local. Antes de processar textos, desative o uso de créditos para Anti IA Local em <a style="color:#b892ff" href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener">Gerenciar uso</a>.</p><p>Você pode fechar esta aba.</p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }));
      }
      if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'POST') return reply(errorResponse(405, requestId, 'METHOD_NOT_ALLOWED', 'Utilize POST.'));
        if (headers.get('origin') !== origin || !sessions.has(browserSession)) return reply(errorResponse(403, requestId, 'ORIGIN_NOT_ALLOWED', 'Abra o Anti IA pelo atalho local.'));
        if (!headers.get('content-type')?.includes('application/json')) return reply(errorResponse(415, requestId, 'UNSUPPORTED_MEDIA_TYPE', 'Envie JSON.'));
        const parsed = await parseRequestBody(request, requestId);
        if (parsed.response) return reply(parsed.response);
        if (busy && url.pathname.startsWith('/api/chatgpt/')) throw new PlanError('BUSY', 'Aguarde o processamento terminar antes de alterar a conexão ou modelo.', 409);
        if (url.pathname === '/api/chatgpt/login') return reply(jsonResponse(200, { authorizationUrl: plan.startLogin(`${origin}/auth/callback`, browserSession) }));
        if (url.pathname === '/api/chatgpt/disconnect') {
          if (busy) throw new PlanError('BUSY', 'Aguarde o processamento terminar antes de desconectar.', 409);
          await plan.disconnect(); selectedModel = undefined;
          return reply(jsonResponse(200, plan.status()));
        }
        if (url.pathname === '/api/chatgpt/enable') {
          const models = await plan.listModels();
          plan.acknowledgeCreditsDisabled(parsed.payload?.creditsDisabled);
          selectedModel = models[0].slug;
          return reply(jsonResponse(200, { ...plan.status(), selectedModel }));
        }
        if (url.pathname === '/api/chatgpt/model') {
          const model = parsed.payload?.model;
          if (!plan.status().models.some((item) => item.slug === model)) throw new PlanError('INVALID_MODEL', 'Selecione um modelo disponível.', 400);
          selectedModel = model;
          return reply(jsonResponse(200, { selectedModel }));
        }
        if (!['/api/humanize', '/api/detect'].includes(url.pathname)) return reply(errorResponse(404, requestId, 'NOT_FOUND', 'Recurso indisponível.'));
        if (busy) throw new PlanError('BUSY', 'Já há um texto em processamento. Aguarde.', 409);
        const detection = url.pathname === '/api/detect';
        if (detection && typeof parsed.payload?.text !== 'string') throw new PlanError('INVALID_BODY', 'Envie o texto para análise.', 400);
        const validated = detection ? validateDetectionText(parsed.payload?.text || '') : validatePayload(parsed.payload);
        if (detection && !validated.valid) return reply(errorResponse(400, requestId, validated.code, validated.message));
        if (!detection && validated.error) return reply(errorResponse(400, requestId, ...validated.error));
        busy = true;
        try {
          const text = detection ? parsed.payload.text : validated.value.text;
          const segments = detection ? segmentDetectionText(text) : [];
          const messages = detection ? buildDetectionMessages(text, segments) : buildMessages(validated.value);
          const model = selectedModel;
          const output = await plan.complete(messages, model, AbortSignal.any([controller.signal, AbortSignal.timeout(110_000)]));
          if (!detection) return reply(jsonResponse(200, { status: 'completed', requestId, model, output }));
          let result;
          try { result = parseModelDetection({ choices: [{ finish_reason: 'stop', message: { content: output } }] }, segments); }
          catch { throw new PlanError('INVALID_PROVIDER_RESPONSE', 'O modelo não produziu uma análise válida. Tente novamente.'); }
          return reply(jsonResponse(200, { status: 'completed', requestId, provider: 'chatgpt', model,
            scoreKind: 'model_assessment', analyzedAt: new Date().toISOString(), wordCount: validated.counts.words, ...result }));
        } finally { busy = false; }
      }
      const publicPath = /^\/(?:index\.html|config\.js|js\/|css\/|vendor\/)/u.test(url.pathname) || url.pathname === '/';
      const filename = resolve(root, `.${url.pathname === '/' ? '/index.html' : url.pathname}`);
      if (!publicPath || !filename.startsWith(`${root}${sep}`) || !['GET', 'HEAD'].includes(request.method)) { outgoing.writeHead(404).end(); return; }
      let bytes;
      try { bytes = await readFile(filename); } catch { outgoing.writeHead(404).end(); return; }
      if (filename.endsWith('index.html')) {
        let html = bytes.toString('utf8').replace('<title>Anti IA', '<title>Anti IA Local').replace('</head>', '<link rel="stylesheet" href="/css/local-chatgpt.css"></head>');
        html = html.replace('<main', '<section id="chatgptConnection" class="chatgpt-connection" aria-labelledby="chatgptConnectionTitle"></section><main');
        html = html.replace('DEEPSEEK</span>', 'CHATGPT · PLANO</span>').replace('IA via conexão segura', 'ChatGPT · versão local')
          .replace('O Anti IA usa o modelo DeepSeek configurado no servidor.', 'A versão local do Anti IA usa o modelo escolhido na sua conta ChatGPT.')
          .replace('Configure o serviço no ambiente da Vercel e humanize seu texto.', 'Entre com ChatGPT, configure sua cota e revise seu texto.')
          .replace('Integração segura com IA via servidor', 'Local · usa sua cota do ChatGPT');
        html = html.replace('</body>', '<script type="module" src="/js/local-chatgpt.js"></script></body>');
        bytes = Buffer.from(html);
      } else if (filename.endsWith(`${sep}config.js`)) {
        bytes = Buffer.from(bytes.toString('utf8').replace('Object.freeze({', 'Object.freeze({ requestTimeoutMs: 120_000,'));
      }
      outgoing.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      outgoing.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (outgoing.destroyed) return;
      const response = errorResponse(error instanceof PlanError ? error.status : controller.signal.aborted || error.name === 'TimeoutError' ? 504 : 502,
        requestId, error instanceof PlanError ? error.code : 'LOCAL_SERVICE_ERROR', error instanceof PlanError ? error.message : 'Não foi possível concluir a operação local. Tente novamente.');
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = createChatGPTPlan({ store: protectedStore(resolve(root, '.local', 'chatgpt.bin')) });
  await plan.init();
  const server = createLocalServer(plan);
  server.on('error', () => { console.error('Não foi possível abrir o Anti IA Local. A porta pode estar em uso.'); process.exitCode = 1; });
  server.listen(3187, '127.0.0.1', () => console.info('Anti IA Local: http://127.0.0.1:3187 — utiliza somente a cota do ChatGPT autorizada pelo usuário.'));
}
