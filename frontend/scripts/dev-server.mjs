// Serves src/ directly so you can edit and reload without a build step.
//
// There is no API proxy any more: the app is fully client-side, and the only network
// calls it makes go straight to the Albion Online Data Project from the browser.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const port = 5173;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
  const requestPath = req.url === '/' ? '/index.html' : req.url || '/index.html';
  const filePath = path.join(srcDir, requestPath);
  try {
    await access(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } catch {
    const fallback = path.join(srcDir, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    createReadStream(fallback).pipe(res);
  }
});

server.listen(port, () => {
  console.log(`Frontend dev server running at http://127.0.0.1:${port}`);
});
