// Serves the page and its API from this machine, the API on memory, so
// that the page can be tried without Cloudflare:
//
//   npm run serve          # http://localhost:8000
//   PORT=9000 npm run serve
//
// The page asks config.js where its API is; this answers that it is here,
// under /api. Polls last until the server stops. `cd api && npm run dev`
// runs the real Worker in workerd instead, on port 8787.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../api/src/worker.js';
import { memoryEnv } from '../api/memory.js';

const SITE = fileURLToPath(new URL('../site', import.meta.url));
const PORT = Number(process.env.PORT) || 8000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const env = memoryEnv();

async function api(req, res, path) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
  const answer = await worker.fetch(new Request(`http://localhost${path}`, {
    method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  }), env);
  res.writeHead(answer.status, Object.fromEntries(answer.headers));
  res.end(Buffer.from(await answer.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (path.startsWith('/api/')) {
      await api(req, res, path.slice(4));
      return;
    }
    if (path === '/config.js') {
      res.writeHead(200, { 'content-type': TYPES['.js'] });
      res.end("export const API_BASE = '/api';\n");
      return;
    }
    const file = resolve(SITE, `.${path.endsWith('/') ? `${path}index.html` : path}`);
    if (!file.startsWith(SITE + sep)) throw new Error('outside the site');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    if (!res.headersSent) res.writeHead(error.code === 'ENOENT' || error.message === 'outside the site' ? 404 : 500);
    res.end();
  }
});

server.listen(PORT, () => console.log(`fair-pick: http://localhost:${PORT}/ (the API is in memory)`));
