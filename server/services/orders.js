const fs = require('fs');
const path = require('path');
const { HttpError } = require('../middleware/error');
const { safeString, roundMoney } = require('../utils/format');
const { readProducts } = require('./products');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const ORDERS_BACKUP_FILE = path.join(DATA_DIR, 'orders.json.bak');

const STATUS_VALUES = new Set(['open', 'preparing', 'ready', 'delivered', 'cancelled']);
const PAYMENT_VALUES = new Set(['pending', 'paid']);

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, '[]\n', 'utf8');
  }
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

  const mesaRaw = payload.mesa ?? existing?.mesa;
  const mesa = mesaRaw === null || mesaRaw === undefined || mesaRaw === ''
    ? null
    : Math.round(Number(mesaRaw));

  return {
    id: existing?.id || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    zonesoft: existing?.zonesoft || null,
    tableSync: existing?.tableSync || null,
    mesa: Number.isFinite(mesa) && mesa > 0 ? mesa : null,
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

function orderSort(a, b) {
  return String(b.createdAt).localeCompare(String(a.createdAt));
}

module.exports = {
  readOrders,
  writeOrders,
  nextOrderId,
  normalizeOrderPayload,
  normalizeItems,
  normalizeDueAt,
  orderSort,
  STATUS_VALUES,
  PAYMENT_VALUES,
  ORDERS_FILE,
  ORDERS_BACKUP_FILE
};
