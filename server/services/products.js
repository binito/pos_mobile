const fs = require('fs');
const { HttpError } = require('../middleware/error');
const { normalizeHeader, parseNumber, roundMoney } = require('../utils/format');
const { parseDelimitedLine } = require('../utils/csv');

const PRODUCTS_CSV = process.env.PRODUCTS_CSV || '/home/jorge/Vscode/site/Produtos.csv';

let productCache = {
  mtimeMs: 0,
  items: []
};

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

    products.push({ code, name, family, price, vat });
  }

  products.sort((a, b) => {
    const byFamily = a.family.localeCompare(b.family, 'pt');
    if (byFamily !== 0) return byFamily;
    return a.name.localeCompare(b.name, 'pt');
  });

  productCache = { mtimeMs: stat.mtimeMs, items: products };

  return products;
}

module.exports = { readProducts, PRODUCTS_CSV };
