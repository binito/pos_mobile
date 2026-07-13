const http = require('http');
const auth = require('./middleware/auth');
const { readOrders } = require('./services/orders');
const { ZONESOFT_ENABLED } = require('./services/zonesoft');
const { handleApi, sendJson, sendText } = require('./routes/api');
const { serveStatic } = require('./routes/static');

function requireAuth(req, res, url) {
  const result = auth.requireAuth(req, res, url);
  if (result === true) {
    return true;
  }
  if (result.status) {
    sendJson(res, result.status, { error: result.error });
    return false;
  }
  res.writeHead(302, { Location: result.redirect });
  res.end();
  return false;
}

function createServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    try {
      if (url.pathname === '/healthz') {
        const orders = readOrders();
        sendJson(res, 200, {
          ok: true,
          service: 'pos-mobile-orders',
          orders: orders.length,
          zonesoftEnabled: ZONESOFT_ENABLED
        });
        return;
      }

      if (!requireAuth(req, res, url)) {
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }

      if (url.pathname === '/login') {
        url.pathname = '/login.html';
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, 'Metodo nao permitido.');
        return;
      }

      serveStatic(req, res, url);
    } catch (error) {
      console.error('Erro no pedido HTTP:', error);
      const status = error.status || 500;
      sendJson(res, status, {
        error: error.message || 'Erro interno.'
      });
    }
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 120000;

  return server;
}

module.exports = { createServer };
