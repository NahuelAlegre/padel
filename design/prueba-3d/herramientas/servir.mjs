// Servidor estático mínimo para ver la prueba en local (las páginas usan fetch, que no anda con file://).
// Uso: node design/prueba-3d/herramientas/servir.mjs [puerto] [carpeta]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2] || 4330);
const root = resolve(process.argv[3] || here);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.bin', '.svg']);

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403).end(); return; }
    await stat(file);
    let body = await readFile(file);
    const ext = extname(file).toLowerCase();
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    // gzip como lo haría un hosting real (GitHub Pages comprime texto y binarios genéricos)
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body, { level: 9 });
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers).end(body);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
  }
}).listen(port, '127.0.0.1', () => console.log(`Prueba 3D en http://127.0.0.1:${port}/  (carpeta ${root})`));
