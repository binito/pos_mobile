const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-mobile-test-'));
process.env.DATA_DIR = dataDir;
process.env.PRODUCTS_CSV = path.join(dataDir, 'products.csv');
fs.writeFileSync(
  process.env.PRODUCTS_CSV,
  'Codigo;Descricao;Familia;PVP1;IVA\n100001;CAFE;CAFETARIA;0,90;13\n',
  'utf8'
);

const orders = require('../server/services/orders');

test('nextOrderId starts at 001 for a fresh day', () => {
  assert.match(orders.nextOrderId([]), /^P\d{8}-001$/);
});

test('nextOrderId increments based on existing orders today', () => {
  const todayId = orders.nextOrderId([]);
  const prefix = todayId.split('-')[0];
  const existing = [{ id: `${prefix}-005` }];
  assert.equal(orders.nextOrderId(existing), `${prefix}-006`);
});

test('normalizeOrderPayload builds totals from manual items', () => {
  const payload = {
    customer: { name: 'Cliente Teste', phone: '' },
    items: [{ name: 'Produto Manual', unitPrice: 2.5, qty: 2 }]
  };
  const order = orders.normalizeOrderPayload(payload);
  assert.equal(order.total, 5);
  assert.equal(order.items[0].code, 'MANUAL');
  assert.equal(order.status, 'open');
  assert.equal(order.payment, 'pending');
});

test('normalizeOrderPayload rejects empty items', () => {
  assert.throws(() => orders.normalizeOrderPayload({ items: [] }), /Adiciona pelo menos um produto/);
});

test('writeOrders + readOrders round-trip', () => {
  const sample = [{ id: 'P1', createdAt: '2026-01-01T00:00:00.000Z' }];
  orders.writeOrders(sample);
  assert.deepEqual(orders.readOrders(), sample);
});

test('readOrders falls back to backup when main file is corrupt', () => {
  fs.writeFileSync(orders.ORDERS_FILE, '{not json', 'utf8');
  fs.writeFileSync(orders.ORDERS_BACKUP_FILE, '[{"id":"backup"}]', 'utf8');
  assert.deepEqual(orders.readOrders(), [{ id: 'backup' }]);
});

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
