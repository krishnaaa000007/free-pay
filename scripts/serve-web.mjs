/**
 * Serves the exported web build (`npx expo export --platform web` -> ./dist).
 *
 * The demo runs the mobile app in a browser, and a dev bundler is the wrong thing to have
 * in the loop while presenting: it recompiles, it holds a file watcher open, and a page
 * load can stall behind a rebuild. A prebuilt bundle behind a plain file server starts
 * instantly and cannot change under the presenter.
 *
 * It binds on all interfaces so the two-window demo can use two different origins
 * (http://localhost:8081 and http://127.0.0.1:8081). Different origins mean different
 * localStorage, so the two windows hold genuinely separate sessions, device keys and
 * offline ledgers — the same reason the stage page uses both.
 *
 *   node scripts/serve-web.mjs [--port 8081] [--dir dist]
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const port = Number(arg('port', 8081));
const dir = path.resolve(root, arg('dir', 'dist'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Resolve a URL path to a file inside `dir`, never outside it. */
async function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.resolve(dir, '.' + (decoded === '/' ? '/index.html' : decoded));
  if (target !== dir && !target.startsWith(dir + path.sep)) return null; // path traversal

  // Expo's static export writes one .html per route, so `/(pilgrim)/home` is on disk as
  // `(pilgrim)/home.html`. Fall back to index.html and let the client router take it.
  for (const candidate of [target, `${target}.html`, path.join(target, 'index.html'), path.join(dir, 'index.html')]) {
    try {
      const s = await stat(candidate);
      if (s.isFile()) return candidate;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const file = await resolveFile(req.url ?? '/');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      // A re-export during a demo should be one refresh away, never a stale cached page.
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err));
  }
});

server.listen(port, () => {
  console.log(`Free Pay web build served from ${path.relative(root, dir)}`);
  console.log(`  phone A   http://localhost:${port}`);
  console.log(`  phone B   http://127.0.0.1:${port}   (separate origin = separate wallet)`);
});
