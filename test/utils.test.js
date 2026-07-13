const test = require('node:test');
const assert = require('node:assert/strict');
const { roundMoney, normalizeHeader, safeString, parseNumber, sanitizeNext } = require('../server/utils/format');
const { parseDelimitedLine, escapeCsv, buildOrdersCsv } = require('../server/utils/csv');

test('roundMoney rounds to 2 decimals', () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(3.1), 3.1);
});

test('normalizeHeader strips accents and case', () => {
  assert.equal(normalizeHeader('  Descrição '), 'descricao');
});

test('safeString trims and truncates', () => {
  assert.equal(safeString('  hello  ', 3), 'hel');
  assert.equal(safeString(null), '');
});

test('parseNumber handles pt-PT number formats', () => {
  assert.equal(parseNumber('1.234,56€'), 1234.56);
  assert.equal(parseNumber(''), 0);
});

test('sanitizeNext rejects unsafe redirects', () => {
  assert.equal(sanitizeNext('/orders'), '/orders');
  assert.equal(sanitizeNext('//evil.com'), '/');
  assert.equal(sanitizeNext('/api/orders'), '/');
  assert.equal(sanitizeNext('http://evil.com'), '/');
});

test('parseDelimitedLine handles quoted delimiters', () => {
  assert.deepEqual(parseDelimitedLine('a;"b;c";d'), ['a', 'b;c', 'd']);
});

test('escapeCsv quotes values with special chars', () => {
  assert.equal(escapeCsv('a;b'), '"a;b"');
  assert.equal(escapeCsv('plain'), 'plain');
});

test('buildOrdersCsv produces a row per item', () => {
  const csv = buildOrdersCsv([
    {
      id: 'P1',
      createdAt: '2026-01-01T00:00:00.000Z',
      customer: { name: 'Ana', phone: '' },
      status: 'open',
      payment: 'pending',
      total: 3.6,
      items: [{ code: '1', name: 'Cafe', family: 'Cafetaria', qty: 2, unitPrice: 1.8, lineTotal: 3.6 }]
    }
  ]);
  assert.match(csv, /Cafe/);
  assert.match(csv, /Pedido/);
});
