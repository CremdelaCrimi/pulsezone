// Tiny static file server for local testing:  node tools/serve.mjs [port]
// (localhost counts as a secure context, so WebXR and Web Bluetooth APIs are allowed.)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2]) || 8080;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  // Test helper: the page POSTs a canvas snapshot (data URL) and we save it to .snapshots/.
  if (req.method === 'POST' && req.url.startsWith('/__snapshot')) {
    const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'snap').replace(/[^\w-]/g, '');
    let body = '';
    for await (const chunk of req) body += chunk;
    const dir = join(root, '.snapshots');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name + '.png'), Buffer.from(body.split(',')[1] || '', 'base64'));
    res.writeHead(200).end('saved');
    return;
  }
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`PulseZone at http://localhost:${port}/  (bridge: /bridge.html)`));
