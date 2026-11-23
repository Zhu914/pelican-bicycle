// Builds a single self-contained dist/index.html (CSS + JS inlined, no runtime dependencies).
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');
const debug = process.argv.includes('--debug');
const portArg = process.argv.find((a) => a.startsWith('--port='));
const port = portArg ? Number(portArg.split('=')[1]) : 8787;

async function bundle() {
  const t0 = performance.now();
  const result = await build({
    entryPoints: [join(src, 'main.js')],
    bundle: true,
    minify: !debug,
    sourcemap: debug ? 'inline' : false,
    format: 'iife',
    target: ['es2020'],
    write: false,
    legalComments: 'inline',
    logLevel: 'silent',
    define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  });
  // "</script" inside the bundle would terminate the inline script element.
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = await readFile(join(src, 'style.css'), 'utf8');
  let html = await readFile(join(src, 'index.html'), 'utf8');
  html = html.replace('/*__CSS__*/', () => css.trim()).replace('/*__JS__*/', () => js);
  await mkdir(dist, { recursive: true });
  await writeFile(join(dist, 'index.html'), html);
  console.log(`built dist/index.html  ${(html.length / 1024).toFixed(1)} KB  (${(performance.now() - t0).toFixed(0)} ms)${debug ? '  [debug]' : ''}`);
}

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
  createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(join(dist, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(dist + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  }).listen(port, '127.0.0.1', () => console.log(`serving ${dist} at http://127.0.0.1:${port}/`));
}

await bundle();
if (process.argv.includes('--serve')) {
  serve();
  let timer = null;
  watch(src, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => bundle().catch((e) => console.error(String(e.message))), 80);
  });
}
