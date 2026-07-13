/**
 * Parsing de ficheiros CSV
 */

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
  for (const order of orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))) {
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

  return `﻿${rows.map((row) => row.map(escapeCsv).join(';')).join('\n')}\n`;
}

module.exports = {
  parseDelimitedLine,
  escapeCsv,
  buildOrdersCsv
};