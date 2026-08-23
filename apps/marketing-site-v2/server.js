/* Локальный сервер v2 с чистыми адресами: /services -> services.html, 404 -> 404.html */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 5175;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain',
};

http.createServer((req, res) => {
  const send = (file, code = 200) => {
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500); res.end('error'); return; }
      res.writeHead(code, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  };
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/+$/, '') || '/';
  if (p.includes('..')) { res.writeHead(400); res.end(); return; }
  if (p === '/') p = '/index.html';
  let file = path.join(ROOT, p);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(file);
  if (!path.extname(p) && fs.existsSync(file + '.html')) return send(file + '.html');
  send(path.join(ROOT, '404.html'), 404);
}).listen(PORT, '127.0.0.1', () => console.log('v2 on http://127.0.0.1:' + PORT));
