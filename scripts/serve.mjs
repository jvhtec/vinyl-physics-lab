// Zero-dependency source checkout server. Use http://127.0.0.1:3000/?lab when
// the large upstream /assets and /records folders are intentionally absent.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = +(process.env.PORT || 3000);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.vis': 'application/octet-stream',
};
createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); res.end(); return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const full = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!full.startsWith(root.endsWith(sep) ? root : root + sep)) {
      res.writeHead(403); res.end(); return;
    }
    const info = await stat(full);
    if (!info.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': types[extname(full)] || 'application/octet-stream',
      'Content-Length': info.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') res.end(); else createReadStream(full).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Vinyl Physics Lab: http://127.0.0.1:${port}/?lab`));
