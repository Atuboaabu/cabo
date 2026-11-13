/**
 * CABO frontend-only development server.
 * Serves files on :5173 and proxies only explicitly allowed auth routes to
 * FastAPI (:8000 by default). Cookie headers are relayed without parsing.
 * Never prints request bodies, passwords or verification codes.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 5173);
const backend = new URL(process.env.CABO_BACKEND_URL || 'http://localhost:8000');
if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password ||
    backend.search || backend.hash || backend.pathname !== '/') {
  throw Error('CABO_BACKEND_URL must be an http(s) origin without credentials');
}
// Explicit route/method allowlist; not a general reverse proxy.
const routes = new Map([
  ['/auth/verification-codes', 'POST'],
  ['/auth/register', 'POST'],
  ['/auth/login', 'POST'],
  ['/auth/me', 'GET'],
  ['/auth/logout', 'POST'],
  ['/auth/refresh', 'POST']
]);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function fail(res, code, message) {
  res.writeHead(code, { ...noStore, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 'DEV_PROXY_ERROR', detail: message }));
}
const server = createServer(async (req, res) => {
  let path;
  try { path = new URL(req.url, 'http://localhost').pathname; }
  catch { fail(res, 400, 'Invalid path'); return; }
  if (routes.has(path)) {
    const allowedMethod=routes.get(path);
    if (req.method !== allowedMethod) { fail(res, 405, allowedMethod+' required'); return; }
    const headers = { Accept: 'application/json' };
    if (req.headers.cookie) headers.Cookie = req.headers.cookie;
    // Pass through the real browser Origin for state-changing requests.
    // Missing Origin is intentionally left missing for backend validation.
    if (allowedMethod === 'POST' && req.headers.origin) headers.Origin = req.headers.origin;
    let body;
    if (allowedMethod === 'POST') {
      headers['Content-Type'] = 'application/json';
      const chunks=[];
      let size=0;
      for await (const part of req) {
        size+=part.length;
        if (size>65536) { fail(res,413,'Request too large');return; }
        chunks.push(part);
      }
      body=Buffer.concat(chunks);
    }
    try {
      const upstream=await fetch(new URL(path,backend),{
        method:allowedMethod,
        headers,
        ...(body===undefined?{}:{body}),
        redirect:'manual',
        signal:AbortSignal.timeout(15000)
      });
      const responseHeaders={
        ...noStore,
        'Content-Type':upstream.headers.get('content-type')||'application/json'
      };
      // Headers.get('set-cookie') can join independent cookies incorrectly.
      // Node >= 20 exposes each cookie separately via getSetCookie().
      const cookies=upstream.headers.getSetCookie();
      if(cookies.length)responseHeaders['Set-Cookie']=cookies;
      const payload=Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status,responseHeaders);
      res.end(upstream.status===204?undefined:payload);
    }catch{
      // Never log request/response headers, bodies or session credentials.
      fail(res,503,'FastAPI auth service unavailable');
    }
    return;
  }
  if (!['GET','HEAD'].includes(req.method)) { fail(res,405,'GET required');return; }
  let relative;
  try { relative=decodeURIComponent(path==='/'?'/index.html':path); }
  catch { fail(res,400,'Invalid path');return; }
  const full=resolve(frontendRoot, '.'+relative);
  if (!(full===frontendRoot || full.startsWith(frontendRoot+sep))) { fail(res,403,'Forbidden');return; }
  try {
    if (!(await stat(full)).isFile()) throw Error('Not a file');
    let bytes=await readFile(full);
    if (relative==='/index.html') {
      // Development-only: direct browser API calls use this same-origin proxy.
      const html=bytes.toString().replace(
        '<script type="module" src="/src/app.js"></script>',
        '<script>window.CABO_API_BASE_URL = window.CABO_API_BASE_URL || window.location.origin;</script><script type="module" src="/src/app.js"></script>'
      );
      bytes=Buffer.from(html);
    }
    res.writeHead(200,{...noStore,'Content-Type':mime[extname(full)]||'application/octet-stream'});
    res.end(req.method==='HEAD'?undefined:bytes);
  } catch { fail(res,404,'Not found'); }
});
server.listen(port, '127.0.0.1',()=>console.info(`CABO frontend: http://localhost:${port} (auth proxy -> ${backend.origin})`));
