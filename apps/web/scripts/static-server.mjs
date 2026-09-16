#!/usr/bin/env node
/**
 * Minimal static file server for storybook-static, used only by the visual
 * regression harness (playwright.config.ts). Not a dependency worth adding
 * a package for — this is ~30 lines and has no configuration surface to get
 * wrong.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = process.argv[2] ?? 'storybook-static';
const port = Number(process.argv[3] ?? 6007);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

createServer(async (req, res) => {
  const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  let filePath = join(root, requestPath === '/' ? '/index.html' : requestPath);

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) filePath = join(filePath, 'index.html');
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(port, () => {
  console.log(`Serving ${root} on http://localhost:${port}`);
});
