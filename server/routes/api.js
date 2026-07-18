const { HttpError } = require('../middleware/error');
const auth = require('../middleware/auth');
const { sanitizeNext } = require('../utils/format');
const { buildOrdersCsv } = require('../utils/csv');
const { readProducts, PRODUCTS_CSV } = require('../services/products');
const {
  readOrders,
  writeOrders,
  nextOrderId,
  normalizeOrderPayload,
  findMesaConflict,
  orderSort,
  STATUS_VALUES,
  PAYMENT_VALUES
} = require('../services/orders');
const { sendOrderToZoneSoft } = require('../services/zonesoft');
const { sendItemsToTable } = require('../services/zonesoftBridge');

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Pedido demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new HttpError(400, 'JSON invalido.'));
      }
    });

    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const payload = await parseBody(req);
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (!auth.validateCredentials(username, password)) {
      throw new HttpError(401, 'Credenciais invalidas.');
    }
    res.setHeader('Set-Cookie', auth.authCookie(auth.makeAuthToken(), req));
    sendJson(res, 200, { ok: true, next: sanitizeNext(payload.next) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    res.setHeader('Set-Cookie', auth.clearAuthCookie());
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    sendJson(res, 200, { authenticated: auth.isAuthenticated(req) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/products') {
    sendJson(res, 200, {
      source: PRODUCTS_CSV,
      products: readProducts()
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    sendJson(res, 200, {
      orders: readOrders().sort(orderSort)
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/export.csv') {
    const csv = buildOrdersCsv(readOrders());
    sendText(res, 200, csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="pedidos-clientes.csv"',
      'Cache-Control': 'no-store'
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/orders') {
    const payload = await parseBody(req);
    const orders = readOrders();
    let order = normalizeOrderPayload(payload);
    const conflict = findMesaConflict(orders, order.mesa, order.customer?.name, null);
    if (conflict) {
      throw new HttpError(409, `A mesa ${order.mesa} já está atribuída a ${conflict.customer?.name || 'outro cliente'}.`);
    }
    order.id = nextOrderId(orders);
    order = await sendOrderToZoneSoft(order);
    orders.push(order);
    writeOrders(orders);
    sendJson(res, 201, { order });
    return;
  }

  const sendToTableMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/send-to-table$/);
  if (sendToTableMatch && req.method === 'POST') {
    const orderId = decodeURIComponent(sendToTableMatch[1]);
    const orders = readOrders();
    const index = orders.findIndex((order) => order.id === orderId);
    if (index === -1) {
      throw new HttpError(404, 'Pedido nao encontrado.');
    }
    const order = orders[index];
    if (!order.mesa) {
      throw new HttpError(400, 'Este pedido nao tem mesa definida.');
    }
    const tableSync = await sendItemsToTable(order.mesa, order.items);
    order.tableSync = tableSync;
    order.updatedAt = new Date().toISOString();
    orders[index] = order;
    writeOrders(orders);
    sendJson(res, 200, { order });
    return;
  }

  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && req.method === 'PUT') {
    const orderId = decodeURIComponent(orderMatch[1]);
    const payload = await parseBody(req);
    const orders = readOrders();
    const index = orders.findIndex((order) => order.id === orderId);
    if (index === -1) {
      throw new HttpError(404, 'Pedido nao encontrado.');
    }
    let order = normalizeOrderPayload(payload, orders[index]);
    const conflict = findMesaConflict(orders, order.mesa, order.customer?.name, orderId);
    if (conflict) {
      throw new HttpError(409, `A mesa ${order.mesa} já está atribuída a ${conflict.customer?.name || 'outro cliente'}.`);
    }
    order.id = orders[index].id;
    order = await sendOrderToZoneSoft(order);
    orders[index] = order;
    writeOrders(orders);
    sendJson(res, 200, { order });
    return;
  }

  if (orderMatch && req.method === 'PATCH') {
    const orderId = decodeURIComponent(orderMatch[1]);
    const payload = await parseBody(req);
    const orders = readOrders();
    const order = orders.find((entry) => entry.id === orderId);
    if (!order) {
      throw new HttpError(404, 'Pedido nao encontrado.');
    }
    if (payload.status && STATUS_VALUES.has(payload.status)) {
      order.status = payload.status;
    }
    if (payload.payment && PAYMENT_VALUES.has(payload.payment)) {
      order.payment = payload.payment;
    }
    order.updatedAt = new Date().toISOString();
    if (order.payment === 'paid' && !order.zonesoft?.document) {
      const synced = await sendOrderToZoneSoft(order);
      Object.assign(order, synced);
    }
    writeOrders(orders);
    sendJson(res, 200, { order });
    return;
  }

  if (orderMatch && req.method === 'DELETE') {
    const orderId = decodeURIComponent(orderMatch[1]);
    const orders = readOrders();
    const nextOrders = orders.filter((order) => order.id !== orderId);
    if (nextOrders.length === orders.length) {
      throw new HttpError(404, 'Pedido nao encontrado.');
    }
    writeOrders(nextOrders);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: 'Endpoint nao encontrado.' });
}

module.exports = { handleApi, sendJson, sendText, parseBody };
