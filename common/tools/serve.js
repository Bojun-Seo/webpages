// Serves this repository as GitHub Pages serves the site pages.yml builds
// from it: index.html at /, each directory's site/ under the directory's
// name, common/site/ among them at /common/. A page finds what it shares at
// ../common/ either way.
//
//   cd <page> && npm run serve        # http://localhost:8000/<page>/
//   PORT=9000 npm run serve
//
// A page with more to serve, such as an API, imports `serve` and answers
// those requests itself first.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// The file a URL path names, or null: / is the index, /<name>/... a file in
// <name>/site/, a path ending in / its index.html, and nothing outside.
async function fileOf(path) {
  if (path === '/' || path === '/index.html') return resolve(ROOT, 'index.html');
  const match = /^\/([^/]+)\/(.*)$/.exec(path);
  if (!match || match[1].startsWith('.')) return null;
  const site = resolve(ROOT, match[1], 'site');
  const file = resolve(site, match[2] === '' || match[2].endsWith('/') ? `${match[2]}index.html` : match[2]);
  if (!file.startsWith(site + sep)) return null;
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

// Starts the server on `port`; `handle(req, res, path)` may answer a request
// first, and says so by returning true.
export function serve({ port = Number(process.env.PORT) || 8000, handle } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (handle && await handle(req, res, path)) return;
      // /<name> without the slash: the page's own links are relative to /<name>/.
      if (/^\/[^/.]+$/.test(path) && await fileOf(`${path}/`)) {
        res.writeHead(301, { location: `${path}/` }).end();
        return;
      }
      const file = await fileOf(path);
      if (!file) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  return new Promise((done) => server.listen(port, () => done(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [page = ''] = process.argv.slice(2);
  const server = await serve();
  console.log(`http://localhost:${server.address().port}/${page ? `${page}/` : ''}`);
}
