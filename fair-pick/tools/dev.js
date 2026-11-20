// Serves the site as common/tools/serve.js does, with fair-pick's API on
// memory, so that the page can be tried without Cloudflare:
//
//   npm run serve          # http://localhost:8000/fair-pick/
//   PORT=9000 npm run serve
//
// The page asks config.js where its API is; this answers that it is here,
// under /api. Polls last until the server stops. `cd api && npm run dev`
// runs the real Worker in workerd instead, on port 8787.

import { serve } from '../../common/tools/serve.js';
import worker from '../api/src/worker.js';
import { memoryEnv } from '../api/memory.js';

const env = memoryEnv();

async function api(req, res, path) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
  const answer = await worker.fetch(new Request(`http://localhost${path}`, {
    method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  }), env);
  res.writeHead(answer.status, Object.fromEntries(answer.headers));
  res.end(Buffer.from(await answer.arrayBuffer()));
}

const server = await serve({
  async handle(req, res, path) {
    if (path.startsWith('/api/')) {
      await api(req, res, path.slice(4));
      return true;
    }
    if (path === '/fair-pick/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end("export const API_BASE = '/api';\n");
      return true;
    }
    return false;
  },
});

console.log(`fair-pick: http://localhost:${server.address().port}/fair-pick/ (the API is in memory)`);
