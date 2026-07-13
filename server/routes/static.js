const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    sendText(res, 400, 'Caminho invalido.');
    return;
  }

  if (pathname === '/') {
    pathname = '/index.html';
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Acesso negado.');
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendText(res, 404, 'Nao encontrado.');
      return;
    }

    const ext = path.extname(filePath);
    const contentType = pathname === '/manifest.json'
      ? 'application/manifest+json; charset=utf-8'
      : MIME_TYPES[ext] || 'application/octet-stream';
    const cacheControl = path.basename(filePath) === 'sw.js' || ext === '.html'
      ? 'no-store'
      : 'public, max-age=3600';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

module.exports = { serveStatic, sendText, PUBLIC_DIR };
