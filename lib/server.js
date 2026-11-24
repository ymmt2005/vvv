// @ts-check
// A local HTTP server for the player page. It serves the runtime, one movie
// directory and the cached fonts, and accepts the rendered output by POST.

import { createServer } from 'node:http';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT } from './assets.js';

const RUNTIME = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'runtime');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};

/** Movie files that may be absent; the server answers 204 for them instead of 404. */
const OPTIONAL = new Set(['/movie/voice/manifest.json', '/movie/music.json']);

/**
 * Resolve a URL path segment inside root. Returns null when it escapes root,
 * and undefined when it is not valid percent-encoding (such as a bare "%").
 * @param {string} root @param {string} rel
 * @returns {string | null | undefined}
 */
export function inside(root, rel) {
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return undefined;
  }
  const p = resolve(root, `.${sep}${decoded}`);
  return p === root || p.startsWith(root + sep) ? p : null;
}

/** Write the request body to dest through a temporary file, so a failed upload never leaves a truncated file. */
async function saveUpload(req, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  await new Promise((ok, fail) => {
    const ws = createWriteStream(part);
    req.on('error', fail);
    ws.on('error', fail);
    ws.on('finish', ok);
    req.pipe(ws);
  }).catch(async (e) => {
    await rm(part, { force: true });
    throw e;
  });
  await rename(part, dest);
}

/**
 * Start the server on 127.0.0.1. Requests must name localhost or 127.0.0.1 in their Host header,
 * so a web page cannot reach it through DNS rebinding.
 * @param {{ movieDir: string, port?: number }} o
 * @returns {Promise<{ url: string, setOutput: (path: string) => void, close: () => Promise<void> }>}
 */
export async function startServer(o) {
  const movieDir = resolve(o.movieDir);
  /** @type {string | null} */
  let output = null;
  let port = 0;
  const server = createServer((req, res) => {
    const host = req.headers.host ?? '';
    if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) { res.writeHead(403).end('forbidden host'); return; }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/__output') {
      if (!output) { res.writeHead(409).end('no output path is set'); return; }
      saveUpload(req, output).then(
        () => res.writeHead(200).end('ok'),
        (e) => res.writeHead(500).end(`cannot write ${output}: ${e.message}`),
      );
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    /** @type {string | null | undefined} */
    let file = null;
    if (url.pathname === '/' || url.pathname === '/index.html') file = join(RUNTIME, 'player.html');
    else if (url.pathname.startsWith('/runtime/')) file = inside(RUNTIME, url.pathname.slice('/runtime/'.length));
    else if (url.pathname.startsWith('/movie/')) file = inside(movieDir, url.pathname.slice('/movie/'.length));
    else if (url.pathname.startsWith('/fonts/')) file = inside(FONT.dir, url.pathname.slice('/fonts/'.length));
    if (file === undefined) { res.writeHead(400).end('bad percent-encoding in the path'); return; }
    let st = null;
    try { st = file ? statSync(file) : null; } catch { st = null; }
    if (!file || !st?.isFile()) {
      // A movie without narration has no voice manifest, and one without music has no music.json;
      // say so without a 404 in the page's console.
      if (OPTIONAL.has(url.pathname)) { res.writeHead(204, { 'cache-control': 'no-store' }).end(); return; }
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(o.port ?? 0, '127.0.0.1', () => r(undefined)));
  port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  return {
    url: `http://localhost:${port}/`,
    setOutput: (p) => { output = resolve(p); },
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r(undefined)); }),
  };
}
