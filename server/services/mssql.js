const sql = require('mssql');

const REQUIRED_SCHEMA = {
  produtos: ['codigo', 'descricao', 'precovenda', 'iva', 'prodstock', 'familia'],
  familias: ['codigo', 'descricao'],
  mapamesas: ['numeroobjecto', 'estado'],
  consumo: [
    'id', 'id2', 'mesa', 'lugar', 'codigo', 'descricao', 'qtd', 'valor', 'iva', 'preco',
    'desconto', 'menuidx', 'idobs', 'obs', 'suspenso', 'impressora', 'impstatus',
    'qtdstock', 'prodstock', 'listseparado', 'stkupd', 'podeapagar', 'hideqtd',
    'posto', 'empid', 'datahora', 'armazem', 'origem', 'sync', 'codprom', 'lote',
    'uid_caracteristica', 'uid_propriedade', 'tipo', 'prodorigem', 'ordempedido',
    'saidastatus', 'edicao', 'addon', 'complementarOrigem', 'total_dif',
    'valor_unitario_deposito_sdr'
  ]
};

const POSTO = Number(process.env.ZONESOFT_POSTO || 1);
const EMPID = Number(process.env.ZONESOFT_EMPID || 1);

function buildConfig() {
  const rawServer = process.env.MSSQL_SERVER || 'localhost';
  const [server, instanceName] = rawServer.split('\\');
  const port = process.env.MSSQL_PORT ? Number(process.env.MSSQL_PORT) : null;

  return {
    server,
    database: process.env.MSSQL_DATABASE,
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    // Se houver uma porta fixa (recomendado), liga diretamente a ela e ignora
    // o nome da instancia - evita depender do servico SQL Server Browser.
    ...(port ? { port } : {}),
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      ...(!port && instanceName ? { instanceName } : {})
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
  };
}

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(buildConfig()).connect();
    poolPromise.catch(() => {
      poolPromise = null;
    });
  }
  return poolPromise;
}

async function checkSchema() {
  const problems = [];
  try {
    const pool = await getPool();
    for (const [table, cols] of Object.entries(REQUIRED_SCHEMA)) {
      const result = await pool.request().query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}'`
      );
      if (result.recordset.length === 0) {
        problems.push(`Tabela '${table}' nao encontrada.`);
        continue;
      }
      const existing = new Set(result.recordset.map((r) => r.COLUMN_NAME));
      for (const col of cols) {
        if (!existing.has(col)) {
          problems.push(`Coluna '${table}.${col}' nao encontrada.`);
        }
      }
    }
  } catch (error) {
    problems.push(`Nao foi possivel ligar ao SQL Server: ${error.message}`);
  }
  return problems;
}

async function addItem(mesa, codigo, qtd) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const prodResult = await new sql.Request(transaction)
      .input('codigo', sql.Int, codigo)
      .query('SELECT descricao, precovenda, iva, prodstock FROM dbo.produtos WHERE codigo = @codigo');

    if (prodResult.recordset.length === 0) {
      await transaction.rollback();
      return { ok: false, error: `Produto ${codigo} nao encontrado` };
    }

    const { descricao, precovenda, iva, prodstock } = prodResult.recordset[0];
    const preco = Number(precovenda);
    const ivaNum = Number(iva);
    const valor = Math.round(preco * qtd * 10000) / 10000;

    const idResult = await new sql.Request(transaction).query(
      'SELECT ISNULL(MAX(id), 0) + 1 AS newId FROM dbo.consumo WITH (TABLOCKX, HOLDLOCK)'
    );
    const newId = idResult.recordset[0].newId;

    await new sql.Request(transaction)
      .input('id', sql.Int, newId)
      .input('mesa', sql.Int, mesa)
      .input('codigo', sql.Int, codigo)
      .input('descricao', sql.VarChar(255), descricao)
      .input('qtd', sql.Decimal(19, 4), qtd)
      .input('valor', sql.Decimal(19, 4), valor)
      .input('iva', sql.Decimal(19, 4), ivaNum)
      .input('preco', sql.Decimal(19, 4), preco)
      .input('prodstock', sql.Int, prodstock)
      .input('posto', sql.Int, POSTO)
      .input('empid', sql.Int, EMPID)
      .query(`
        INSERT INTO dbo.consumo (
          id, id2, mesa, lugar, codigo, descricao, qtd, valor, iva, preco,
          desconto, menuidx, idobs, obs, suspenso, impressora, impstatus,
          qtdstock, prodstock, listseparado, stkupd, podeapagar, hideqtd,
          posto, empid, datahora, armazem, origem, sync, codprom, lote,
          uid_caracteristica, uid_propriedade, tipo, prodorigem, ordempedido,
          saidastatus, edicao, addon, complementarOrigem, total_dif,
          valor_unitario_deposito_sdr
        ) VALUES (
          @id, 0, @mesa, 0, @codigo, @descricao, @qtd, @valor, @iva, @preco,
          0, 0, 0, '', 0, 0, 0,
          @qtd, @prodstock, 0, 1, 0, NULL,
          @posto, @empid, GETDATE(), 0, @posto, 0, 0, '',
          0, 0, 0, 0, 0,
          0, 0, '', 0, 0,
          0
        )
      `);

    // Marca a mesa como ocupada no mapa de mesas do ZoneSoft. O ZoneSoft
    // repoe estado=0 quando a conta e paga pela via normal, mas nunca volta
    // a por estado=2 quando somos nos a inserir artigos por SQL - sem isto
    // a mesa fica com itens mas aparece "livre" no mapa e a equipa nao a ve.
    await new sql.Request(transaction)
      .input('mesa', sql.Int, mesa)
      .query('UPDATE dbo.mapamesas SET estado = 2 WHERE numeroobjecto = @mesa AND tipoobjecto = 0 AND estado <> 2');

    await transaction.commit();
    return { ok: true, id: newId, descricao, valor };
  } catch (error) {
    await transaction.rollback();
    return { ok: false, error: error.message };
  }
}

async function getProducts() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT p.codigo, p.descricao, p.precovenda, p.iva, f.descricao AS familia
    FROM dbo.produtos p
    LEFT JOIN dbo.familias f ON f.codigo = p.familia
    WHERE p.codigo > 0 AND p.descricao IS NOT NULL AND p.descricao <> ''
    ORDER BY f.descricao, p.descricao
  `);
  return result.recordset.map((row) => ({
    code: String(row.codigo),
    name: row.descricao,
    family: row.familia || 'Outros',
    price: Math.round(Number(row.precovenda) * 100) / 100,
    vat: Number(row.iva) || 0
  }));
}

async function getMesa(mesa) {
  const pool = await getPool();
  const result = await pool.request()
    .input('mesa', sql.Int, mesa)
    .query('SELECT id, codigo, descricao, qtd, valor, datahora FROM dbo.consumo WHERE mesa = @mesa ORDER BY id');

  const items = result.recordset.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    descricao: r.descricao,
    qtd: Number(r.qtd),
    valor: Number(r.valor),
    datahora: r.datahora
  }));

  return {
    ok: true,
    mesa,
    items,
    total: Math.round(items.reduce((sum, i) => sum + i.valor, 0) * 100) / 100
  };
}

async function getFreeTables() {
  const pool = await getPool();
  const result = await pool.request().query(
    'SELECT numeroobjecto FROM dbo.mapamesas WHERE tipoobjecto = 0 AND estado = 0 ORDER BY numeroobjecto'
  );
  return { ok: true, mesas: result.recordset.map((r) => r.numeroobjecto) };
}

async function removeItems(ids) {
  if (!ids || ids.length === 0) {
    return { ok: true, removed: 0 };
  }
  try {
    const pool = await getPool();

    const lookup = pool.request();
    const lookupPlaceholders = ids.map((id, i) => {
      lookup.input(`id${i}`, sql.Int, id);
      return `@id${i}`;
    });
    const mesasResult = await lookup.query(
      `SELECT DISTINCT mesa FROM dbo.consumo WHERE id IN (${lookupPlaceholders.join(',')})`
    );
    const affectedMesas = mesasResult.recordset.map((r) => r.mesa);

    const request = pool.request();
    const placeholders = ids.map((id, i) => {
      request.input(`id${i}`, sql.Int, id);
      return `@id${i}`;
    });
    const result = await request.query(`DELETE FROM dbo.consumo WHERE id IN (${placeholders.join(',')})`);

    for (const mesa of affectedMesas) {
      const countResult = await pool.request()
        .input('mesa', sql.Int, mesa)
        .query('SELECT COUNT(*) AS n FROM dbo.consumo WHERE mesa = @mesa');
      if (countResult.recordset[0].n === 0) {
        await pool.request()
          .input('mesa', sql.Int, mesa)
          .query('UPDATE dbo.mapamesas SET estado = 0 WHERE numeroobjecto = @mesa AND tipoobjecto = 0 AND estado <> 0');
      }
    }

    return { ok: true, removed: result.rowsAffected[0] };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { getPool, checkSchema, addItem, getMesa, removeItems, getProducts, getFreeTables, REQUIRED_SCHEMA };
