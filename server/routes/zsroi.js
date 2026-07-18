const fs = require('fs');
const path = require('path');
const { HttpError } = require('../middleware/error');
const zsroi = require('../middleware/zsroi');
const { readOrders, writeOrders, STATUS_VALUES } = require('../services/orders');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const MENU_FILE = path.join(DATA_DIR, 'zsroi-menu.json');

let posOnline = true;

const ORDER_STATUS_MAP = {
  accept: 'preparing',
  decline: 'cancelled',
  ready: 'ready',
  delivered: 'delivered',
  pickedup: 'delivered'
};

function sendJson(res, status, payload) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function requireZsroiToken(req) {
  if (!zsroi.isValidToken(req.headers['authorization'])) {
    throw new HttpError(401, 'Token invalido.');
  }
}

async function handleZsroi(req, res, url, parseBody) {
  if (req.method === 'POST' && url.pathname === '/api/zsroi/login') {
    const payload = await parseBody(req);
    if (!zsroi.validateAppCredentials(payload.app_store_username, payload.app_store_secret)) {
      throw new HttpError(401, 'Credenciais invalidas.');
    }
    sendJson(res, 200, { access_token: zsroi.issueToken(), expires_in: zsroi.TOKEN_TTL_SECONDS });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/zsroi/menu') {
    requireZsroiToken(req);
    const payload = await parseBody(req);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MENU_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    sendJson(res, 204);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/zsroi/order-status') {
    requireZsroiToken(req);
    const payload = await parseBody(req);
    const orderId = String(payload.order_id || '');
    const orders = readOrders();
    const order = orders.find((entry) => entry.id === orderId || entry.zonesoft?.document === orderId);
    if (!order) {
      throw new HttpError(404, 'Pedido nao encontrado.');
    }
    const mapped = ORDER_STATUS_MAP[payload.status];
    if (mapped && STATUS_VALUES.has(mapped)) {
      order.status = mapped;
      order.updatedAt = new Date().toISOString();
      writeOrders(orders);
    }
    sendJson(res, 204);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/zsroi/pos-status') {
    requireZsroiToken(req);
    sendJson(res, 200);
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/zsroi/pos-status/closing') {
    requireZsroiToken(req);
    posOnline = true;
    sendJson(res, 204);
    return true;
  }

  if (req.method === 'PUT' && url.pathname === '/api/zsroi/pos-status/closing') {
    requireZsroiToken(req);
    posOnline = false;
    sendJson(res, 204);
    return true;
  }

  throw new HttpError(404, 'Endpoint ZSROI nao encontrado.');
}

module.exports = { handleZsroi, isPosOnline: () => posOnline };
