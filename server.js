import http from 'node:http';
import { stat, realpath, readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const appRoot = path.dirname(fileURLToPath(import.meta.url));
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
const rootFiles = new Set(['index.html', 'manifest.json', 'favicon.svg', 'favicon.ico', 'sw.js', 'precache-manifest.js', 'app.js', 'db.js', 'fsrs.js', 'sync.js', 'anki.js', 'style.css']);
const publicDirectories = new Set(['js', 'css', 'icons', 'vendor', 'assets']);
export function createStaticServer({ rootDir = appRoot } = {}) {
  const baseDir = path.resolve(rootDir);
  return http.createServer(async (req, res) => {
    const reply = (status, text) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text); };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); reply(405, 'Method not allowed'); return; }
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
      catch { reply(400, 'Invalid URL'); return; }
      if (pathname.includes('\0') || pathname.includes('\\')) { reply(400, 'Invalid path'); return; }
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      const parts = name.split('/');
      if (parts.some(part => part.startsWith('.')) || (!rootFiles.has(name) && !publicDirectories.has(parts[0]))) { reply(404, 'Not found'); return; }
      const ext = path.extname(name).toLowerCase();
      if (!MIME_TYPES[ext]) { reply(404, 'Not found'); return; }
      const resolvedPath = path.resolve(baseDir, name);
      if (!resolvedPath.startsWith(baseDir + path.sep)) { reply(403, 'Forbidden'); return; }
      let actualPath;
      try { actualPath = await realpath(resolvedPath); }
      catch { reply(404, 'Not found'); return; }
      if (!actualPath.startsWith(baseDir + path.sep)) { reply(403, 'Forbidden'); return; }
      const info = await stat(actualPath);
      if (!info.isFile()) { reply(404, 'Not found'); return; }
      const etag = `"${info.size}-${Math.trunc(info.mtimeMs)}"`;
      const headers = { 'Content-Type': MIME_TYPES[ext], 'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Cache-Control': name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', ETag: etag };
      if (name === 'index.html') headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://api.github.com https://gist.githubusercontent.com https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(actualPath);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      console.error('Static request failed:', error.message);
      if (!res.headersSent) reply(500, 'Unable to serve request'); else res.destroy();
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv.slice(2).find(value => /^\d+$/.test(value)) || 8081);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  const rootDir = !process.argv.includes('--dev') && existsSync(path.join(appRoot, 'dist/index.html')) ? path.join(appRoot, 'dist') : appRoot;
  const server = createStaticServer({ rootDir });
  server.listen(port, '127.0.0.1', () => console.log(`anamnesis at http://127.0.0.1:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
