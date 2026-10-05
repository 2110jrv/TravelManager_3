import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..');
if (process.cwd().toLowerCase() !== root.toLowerCase()) throw Error('Run from C:\\Codex\\TravelManager_3');
const publicRoot = resolve(root, 'public');
const mime = { '.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml' };
const port = Number(process.env.AV2_PREVIEW_PORT || 5004);
createServer(async (req, res) => {
  try {
    const base = `http://127.0.0.1:${port}`;
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) { res.writeHead(403).end(); return; }
    const url = new URL(req.url, base);
    if (url.pathname === '/v2/local-calendar') {
      // Private connector snapshot is never under public/ and never included in production builds.
      if (req.method !== 'GET' || (req.headers.origin && ![base,`http://localhost:${port}`].includes(req.headers.origin)) || (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))) { res.writeHead(403).end(); return; }
      const snapshot = await readFile(resolve(root, '.av2-private/calendar.json'));
      res.writeHead(200, { 'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff' }).end(snapshot); return;
    }
    let path = decodeURIComponent(url.pathname); if (path.endsWith('/')) path += 'index.html';
    const file = resolve(publicRoot, `.${path}`);
    if (!file.startsWith(publicRoot + sep)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type':mime[extname(file)] || 'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Agenda Viajera 2.0: http://127.0.0.1:${port}/v2/`));
