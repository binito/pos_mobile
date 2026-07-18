const { HttpError } = require('../middleware/error');
const mssql = require('./mssql');

const CACHE_TTL_MS = Number(process.env.PRODUCTS_CACHE_TTL_MS || 30000);

let cache = { items: [], fetchedAt: 0 };
let inFlight = null;

async function readProducts() {
  const now = Date.now();
  if (cache.items.length > 0 && (now - cache.fetchedAt) < CACHE_TTL_MS) {
    return cache.items;
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = mssql.getProducts()
    .then((items) => {
      cache = { items, fetchedAt: Date.now() };
      inFlight = null;
      return items;
    })
    .catch((error) => {
      inFlight = null;
      if (cache.items.length > 0) {
        console.error('Erro ao atualizar produtos do SQL Server; a usar cache anterior:', error.message);
        return cache.items;
      }
      throw new HttpError(500, `Nao consegui ler produtos do SQL Server: ${error.message}`);
    });

  return inFlight;
}

module.exports = { readProducts };
