import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createRouterService } from './settings.mjs';
import { panelHTML, TOOL_NAMES } from './mcp.mjs';
import { isMain } from './shared.mjs';

export function createPreview({ service = createRouterService(), port = 0 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const nonce = randomBytes(24).toString('hex');
  const limit = 40 * 1024;
  const server = createServer(async (request, response) => {
    const origin = server.url;
    const expectedHost = new URL(origin).host;
    const send = (status, data) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(data));
    };
    if (request.headers.host !== expectedHost || (request.headers.origin && request.headers.origin !== origin)) return send(403, { error: 'This preview is available only from its local origin.' });
    if (request.method === 'GET' && request.url === '/') {
      const config = JSON.stringify({ nonce });
      const html = panelHTML().replace('</head>', `<script>window.__ROUTER_PREVIEW__=${config};</script></head>`);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      return response.end(html);
    }
    if (request.method !== 'POST' || request.url !== '/rpc') return send(404, { error: 'Not found.' });
    const supplied = request.headers['x-router-nonce'];
    const matches = typeof supplied === 'string' && Buffer.byteLength(supplied) === Buffer.byteLength(nonce) && timingSafeEqual(Buffer.from(supplied), Buffer.from(nonce));
    if (request.headers.origin !== origin || !matches) return send(403, { error: 'Invalid preview request.' });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) return send(415, { error: 'Send JSON.' });
    if (Number(request.headers['content-length']) > limit) return send(413, { error: 'Request is too large.' });
    let body;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > limit) return send(413, { error: 'Request is too large.' });
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return send(400, { error: 'Invalid JSON.' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['name', 'args'].includes(key)) || !TOOL_NAMES.includes(body.name)) return send(400, { error: 'Invalid Router request.' });
    try { send(200, await service.call(body.name, body.args ?? {})); }
    catch (error) { send(400, { error: error.message || 'Router request failed.' }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  Object.defineProperty(server, 'url', { get() {
    const address = server.address();
    return address && typeof address === 'object' ? `http://127.0.0.1:${address.port}` : null;
  } });
  server.listen(port, '127.0.0.1');
  return server;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--port')) { console.error('Usage: node preview.mjs [--port 0]'); process.exitCode = 1; }
  else {
    try {
      const server = createPreview({ port: args.length ? Number(args[1]) : 0 });
      server.on('listening', () => console.log(server.url));
      server.on('error', () => { console.error('Router preview could not start on the local loopback address.'); process.exitCode = 1; });
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
