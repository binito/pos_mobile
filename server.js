const http = require('http');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PRODUCTS_CSV = process.env.PRODUCTS_CSV || '/home/jorge/Vscode/site/Produtos.csv';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const ORDERS_BACKUP_FILE = path.join(DATA_DIR, 'orders.json.bak');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ZONESOFT_SCRIPT = process.env.ZONESOFT_SCRIPT || path.join(__dirname, 'tools', 'zonesoft_create_order.py');
const ZONESOFT_PYTHON = process.env.ZONESOFT_PYTHON || '/home/jorge/web_scrapper/venv/bin/python';
const ZONESOFT_NIF = process.env.ZONESOFT_NIF || '745058248';
const ZONESOFT_LOGIN = process.env.ZONESOFT_LOGIN || 'binito';
const ZONESOFT_PASSWORD = process.env.ZONESOFT_PASSWORD || 'cathie';
const ZONESOFT_ORDER_CLIENT_SEARCH = process.env.ZONESOFT_ORDER_CLIENT_SEARCH || '2';
const ZONESOFT_ENABLED = process.env.ZONESOFT_ENABLED === '1';
const ZONESOFT_TIMEOUT_MS = Number(process.env.ZONESOFT_TIMEOUT_MS || 180000);
const MAX_BODY_BYTES = 1024 * 1024;
const AUTH_USER = process.env.POS_AUTH_USER || 'jorge';
const AUTH_PASS = process.env.POS_AUTH_PASS || 'cathie';
const AUTH_SECRET = process.env.POS_AUTH_SECRET || crypto.randomBytes(32).toString('base64url');
const AUTH_COOKIE = 'pos_auth';
const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const STATUS_VALUES = new Set(['open', 'preparing', 'ready', 'delivered', 'cancelled']);
const PAYMENT_VALUES = new Set(['pending', 'paid']);

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

let productCache = {
  mtimeMs: 0,
  items: []
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, '[]\n', 'utf8');
  }
}

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

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function signAuth(expiry) {
  return crypto
    .createHmac('sha256', AUTH_SECRET)
    .update(`${AUTH_USER}.${expiry}`)
    .digest('base64url');
}

function makeAuthToken() {
  const expiry = Date.now() + AUTH_MAX_AGE_SECONDS * 1000;
  return `${expiry}.${signAuth(expiry)}`;
}

function isAuthenticated(req) {
  const token = parseCookies(req)[AUTH_COOKIE];
  if (!token) return false;
  const [expiryText, signature] = String(token).split('.');
  const expiry = Number(expiryText);
  if (!Number.isFinite(expiry) || Date.now() > expiry || !signature) return false;
  const expected = signAuth(expiry);
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function authCookie(token, req) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE_SECONDS}${secure}`;
}

function clearAuthCookie() {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function sanitizeNext(value) {
  const next = String(value || '/');
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/api/')) {
    return '/';
  }
  return next;
}

function isPublicPath(url) {
  return [
    '/login',
    '/login.html',
    '/api/login',
    '/manifest.json',
    '/icon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/app.js',
    '/sw.js',
    '/styles.css'
  ].includes(url.pathname);
}

function requireAuth(req, res, url) {
  if (isAuthenticated(req) || isPublicPath(url)) {
    return true;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 401, { error: 'Login necessario.' });
    return false;
  }

  const next = encodeURIComponent(url.pathname + url.search);
  res.writeHead(302, { Location: `/login?next=${next}` });
  res.end();
  return false;
}

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function parseDelimitedLine(line, delimiter = ';') {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseNumber(value) {
  const cleaned = String(value || '')
    .replace(/[€%\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function readProducts() {
  let stat;
  try {
    stat = fs.statSync(PRODUCTS_CSV);
  } catch (error) {
    throw new HttpError(500, `Nao consegui ler o ficheiro de produtos: ${PRODUCTS_CSV}`);
  }

  if (productCache.items.length > 0 && productCache.mtimeMs === stat.mtimeMs) {
    return productCache.items;
  }

  const raw = fs.readFileSync(PRODUCTS_CSV, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '');
  const headerIndex = lines.findIndex((line) => {
    const normalized = normalizeHeader(line);
    return normalized.includes('codigo') && normalized.includes('descricao') && normalized.includes('pvp1');
  });

  if (headerIndex === -1) {
    throw new HttpError(500, 'O CSV de produtos nao tem as colunas esperadas.');
  }

  const header = parseDelimitedLine(lines[headerIndex]).map(normalizeHeader);
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  const required = ['codigo', 'descricao', 'familia', 'pvp1'];
  const missing = required.filter((name) => index[name] === undefined);

  if (missing.length > 0) {
    throw new HttpError(500, `O CSV de produtos nao tem: ${missing.join(', ')}`);
  }

  const seen = new Set();
  const products = [];

  for (const line of lines.slice(headerIndex + 1)) {
    const cells = parseDelimitedLine(line);
    const code = String(cells[index.codigo] || '').trim();
    const name = String(cells[index.descricao] || '').trim();
    const family = String(cells[index.familia] || 'Outros').trim() || 'Outros';
    const price = roundMoney(parseNumber(cells[index.pvp1]));
    const vat = index.iva !== undefined ? parseNumber(cells[index.iva]) : 0;

    if (!code || !name) {
      continue;
    }

    const key = `${code}:${name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    products.push({
      code,
      name,
      family,
      price,
      vat
    });
  }

  products.sort((a, b) => {
    const byFamily = a.family.localeCompare(b.family, 'pt');
    if (byFamily !== 0) return byFamily;
    return a.name.localeCompare(b.name, 'pt');
  });

  productCache = {
    mtimeMs: stat.mtimeMs,
    items: products
  };

  return products;
}

function readOrders() {
  ensureDataFiles();
  const raw = fs.readFileSync(ORDERS_FILE, 'utf8').trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    try {
      const backup = fs.readFileSync(ORDERS_BACKUP_FILE, 'utf8').trim();
      const parsedBackup = backup ? JSON.parse(backup) : [];
      if (Array.isArray(parsedBackup)) {
        console.error(`Ficheiro de pedidos corrompido; carreguei backup ${ORDERS_BACKUP_FILE}.`);
        return parsedBackup;
      }
    } catch (backupError) {
      console.error('Falha ao carregar backup dos pedidos:', backupError);
    }
    throw new HttpError(500, 'O ficheiro de pedidos esta corrompido e o backup nao carregou.');
  }
}

function writeOrders(orders) {
  ensureDataFiles();
  const tmpFile = `${ORDERS_FILE}.tmp`;
  if (fs.existsSync(ORDERS_FILE)) {
    fs.copyFileSync(ORDERS_FILE, ORDERS_BACKUP_FILE);
  }
  fs.writeFileSync(tmpFile, `${JSON.stringify(orders, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpFile, ORDERS_FILE);
}

function runCommand(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function sendOrderToZoneSoft(order) {
  if (!ZONESOFT_ENABLED) {
    return order;
  }

  if (order.payment !== 'paid' || order.zonesoft?.document) {
    return order;
  }

  if ((order.items || []).some((item) => !item.code || item.code === 'MANUAL')) {
    return {
      ...order,
      zonesoft: {
        status: 'error',
        lastError: 'Existem produtos manuais/sem codigo ZoneSoft.',
        updatedAt: new Date().toISOString()
      }
    };
  }

  const tempFile = path.join(os.tmpdir(), `pos-mobile-zonesoft-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tempFile, `${JSON.stringify(order)}\n`, 'utf8');

  try {
    const { stdout } = await runCommand(ZONESOFT_PYTHON, [ZONESOFT_SCRIPT, tempFile], {
      timeout: ZONESOFT_TIMEOUT_MS,
      env: {
        ...process.env,
        ZONESOFT_NIF,
        ZONESOFT_LOGIN,
        ZONESOFT_PASSWORD,
        ZONESOFT_ORDER_CLIENT_SEARCH
      }
    });
    const result = JSON.parse(String(stdout).trim().split('\n').pop() || '{}');
    if (!result.ok || !result.document) {
      throw new Error(result.error || 'ZoneSoft nao devolveu numero de encomenda.');
    }
    return {
      ...order,
      zonesoft: {
        status: 'sent',
        document: result.document,
        sentAt: new Date().toISOString()
      }
    };
  } catch (error) {
    const rawError = String(error.stderr || error.stdout || error.message || 'Erro ZoneSoft').trim();
    let message = rawError;
    try {
      const parsed = JSON.parse(rawError.split('\n').pop());
      message = parsed.error || message;
    } catch (parseError) {
      // Keep original message.
    }
    return {
      ...order,
      zonesoft: {
        status: 'error',
        lastError: message.slice(0, 500),
        updatedAt: new Date().toISOString()
      }
    };
  } finally {
    fs.rm(tempFile, { force: true }, () => {});
  }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function nextOrderId(orders) {
  const prefix = `P${localDateKey()}`;
  const lastNumber = orders.reduce((max, order) => {
    if (!String(order.id || '').startsWith(prefix)) {
      return max;
    }
    const suffix = Number(String(order.id).split('-')[1]);
    return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
  }, 0);

  return `${prefix}-${String(lastNumber + 1).padStart(3, '0')}`;
}

function safeString(value, maxLength = 250) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeDueAt(value) {
  const trimmed = safeString(value, 40);
  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeItems(payloadItems, products) {
  if (!Array.isArray(payloadItems) || payloadItems.length === 0) {
    throw new HttpError(400, 'Adiciona pelo menos um produto ao pedido.');
  }

  const byCode = new Map(products.map((product) => [product.code, product]));
  const byKey = new Map();

  for (const item of payloadItems) {
    const code = safeString(item.code, 40);
    const quantity = Math.round(Number(item.qty ?? item.quantity));
    const repeatQuantity = Math.round(Number(item.repeatQty ?? item.roundQty ?? quantity));

    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 999) {
      throw new HttpError(400, 'Existe uma quantidade invalida no pedido.');
    }
    if (!Number.isFinite(repeatQuantity) || repeatQuantity < 1 || repeatQuantity > 999) {
      throw new HttpError(400, 'Existe uma quantidade de rodada invalida no pedido.');
    }

    let normalized;
    if (code && byCode.has(code)) {
      const product = byCode.get(code);
      normalized = {
        code: product.code,
        name: product.name,
        family: product.family,
        vat: product.vat,
        unitPrice: product.price,
        qty: quantity,
        repeatQty: repeatQuantity
      };
    } else {
      const name = safeString(item.name, 120);
      const unitPrice = roundMoney(Number(item.unitPrice ?? item.price));
      if (!name || !Number.isFinite(unitPrice) || unitPrice < -999 || unitPrice > 9999) {
        throw new HttpError(400, 'Existe um produto manual invalido no pedido.');
      }
      normalized = {
        code: code || 'MANUAL',
        name,
        family: safeString(item.family, 80) || 'Manual',
        vat: Number(item.vat) || 0,
        unitPrice,
        qty: quantity,
        repeatQty: repeatQuantity
      };
    }

    const key = `${normalized.code}:${normalized.name}:${normalized.unitPrice}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.qty += normalized.qty;
      existing.repeatQty += normalized.repeatQty;
    } else {
      byKey.set(key, normalized);
    }
  }

  return Array.from(byKey.values()).map((item) => ({
    ...item,
    qty: Math.min(item.qty, 999),
    repeatQty: Math.min(item.repeatQty, 999),
    lineTotal: roundMoney(item.qty * item.unitPrice)
  }));
}

function normalizeOrderPayload(payload, existing = null) {
  const products = readProducts();
  const items = normalizeItems(payload.items, products);
  const total = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const now = new Date().toISOString();
  const status = STATUS_VALUES.has(payload.status) ? payload.status : existing?.status || 'open';
  const payment = PAYMENT_VALUES.has(payload.payment) ? payload.payment : existing?.payment || 'pending';

  return {
    id: existing?.id || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    zonesoft: existing?.zonesoft || null,
    customer: {
      name: safeString(payload.customer?.name, 120),
      phone: safeString(payload.customer?.phone, 40)
    },
    dueAt: normalizeDueAt(payload.dueAt),
    status,
    payment,
    notes: safeString(payload.notes, 1000),
    items,
    total
  };
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

function orderSort(a, b) {
  return String(b.createdAt).localeCompare(String(a.createdAt));
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildOrdersCsv(orders) {
  const headers = [
    'Pedido',
    'Criado',
    'Entrega',
    'Cliente',
    'Telefone',
    'Estado',
    'Pagamento',
    'Codigo',
    'Produto',
    'Familia',
    'Qtd',
    'Preco unitario',
    'Total linha',
    'Total pedido',
    'Notas'
  ];

  const rows = [headers];
  for (const order of orders.sort(orderSort)) {
    for (const item of order.items || []) {
      rows.push([
        order.id,
        order.createdAt,
        order.dueAt || '',
        order.customer?.name || '',
        order.customer?.phone || '',
        order.status,
        order.payment,
        item.code,
        item.name,
        item.family,
        item.qty,
        item.unitPrice.toFixed(2).replace('.', ','),
        item.lineTotal.toFixed(2).replace('.', ','),
        order.total.toFixed(2).replace('.', ','),
        order.notes || ''
      ]);
    }
  }

  return `\uFEFF${rows.map((row) => row.map(escapeCsv).join(';')).join('\n')}\n`;
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

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const payload = await parseBody(req);
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (username !== AUTH_USER || password !== AUTH_PASS) {
      throw new HttpError(401, 'Credenciais invalidas.');
    }
    res.setHeader('Set-Cookie', authCookie(makeAuthToken(), req));
    sendJson(res, 200, { ok: true, next: sanitizeNext(payload.next) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    res.setHeader('Set-Cookie', clearAuthCookie());
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    sendJson(res, 200, { authenticated: isAuthenticated(req) });
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
    order.id = nextOrderId(orders);
    order = await sendOrderToZoneSoft(order);
    orders.push(order);
    writeOrders(orders);
    sendJson(res, 201, { order });
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
      }, {
        'Cache-Control': 'no-store'
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

function shutdown(signal) {
  console.log(`Recebido ${signal}; a fechar servidor HTTP.`);
  server.close((error) => {
    if (error) {
      console.error('Erro ao fechar servidor:', error);
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Timeout no shutdown; a sair.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  console.error('uncaughtException:', error);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  shutdown('unhandledRejection');
});

ensureDataFiles();
server.listen(PORT, HOST, () => {
  console.log(`POS mobile a correr em http://${HOST}:${PORT}`);
  console.log(`Produtos: ${PRODUCTS_CSV}`);
  console.log(`Pedidos: ${ORDERS_FILE}`);
});
