import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import detect from '../api/detect.mjs';
import humanize from '../api/humanize.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
const root = resolve('.');
const port = Number(process.env.PORT || 3000);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const routes = { '/api/detect': detect, '/api/humanize': humanize };

createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  outgoing.on('close', () => { if (!outgoing.writableEnded) controller.abort(); });
  try {
    const url = new URL(incoming.url, `http://${incoming.headers.host || `127.0.0.1:${port}`}`);
    if (Object.hasOwn(routes, url.pathname)) {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
      }
      const hasBody = !['GET', 'HEAD'].includes(incoming.method);
      const request = new Request(url, { method: incoming.method, headers, signal: controller.signal,
        ...(hasBody ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
      const response = await routes[url.pathname].fetch(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const publicPath = /^\/(?:dist\/)?(?:index\.html|config\.js|js\/|css\/|vendor\/)/u.test(url.pathname)
      || url.pathname === '/' || url.pathname === '/dist/';
    const filename = resolve(root, `.${url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname}`);
    if (!publicPath || !filename.startsWith(`${root}${sep}`) || !['GET', 'HEAD'].includes(incoming.method)) {
      outgoing.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(filename);
      outgoing.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream' });
      outgoing.end(incoming.method === 'HEAD' ? undefined : bytes);
    } catch {
      outgoing.writeHead(404).end();
    }
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify({ status: 'error', error: { code: 'SERVER_ERROR', message: 'Não foi possível processar a solicitação.' } }));
  }
}).listen(port, '127.0.0.1', () => {
  console.info(`Anti IA disponível em http://127.0.0.1:${port}`);
  if (!process.env.DEEPSEEK_API_KEY && !process.env.GPTZERO_API_KEY) {
    console.info('Para ativar a análise, configure DEEPSEEK_API_KEY ou GPTZERO_API_KEY no arquivo .env e reinicie o servidor.');
  }
});
