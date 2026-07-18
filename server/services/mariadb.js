const mysql = require('mysql2/promise');

const MARIADB_HOST = process.env.MARIADB_HOST || 'localhost';
const MARIADB_PORT = Number(process.env.MARIADB_PORT || 3306);
const MARIADB_USER = process.env.MARIADB_USER || 'pos_catalog';
const MARIADB_PASSWORD = process.env.MARIADB_PASSWORD || '';
const MARIADB_DATABASE = process.env.MARIADB_DATABASE || 'zonesoft_catalog';

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: MARIADB_HOST,
      port: MARIADB_PORT,
      user: MARIADB_USER,
      password: MARIADB_PASSWORD,
      database: MARIADB_DATABASE,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0
    });
  }
  return pool;
}

async function readProductsFromDb() {
  const [rows] = await getPool().query(`
    SELECT p.codigo, p.descricao, p.precovenda, p.iva, f.descricao AS familia
    FROM produtos p
    LEFT JOIN familias f ON f.codigo = p.familia
    WHERE p.codigo > 0 AND p.descricao IS NOT NULL AND p.descricao <> ''
    ORDER BY f.descricao, p.descricao
  `);

  return rows.map((row) => ({
    code: String(row.codigo),
    name: row.descricao,
    family: row.familia || 'Outros',
    price: Math.round(Number(row.precovenda) * 100) / 100,
    vat: Number(row.iva) || 0
  }));
}

module.exports = { readProductsFromDb };
