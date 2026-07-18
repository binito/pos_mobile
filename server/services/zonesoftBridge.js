const mssql = require('./mssql');

let schemaOk = null;

async function ensureSchemaChecked() {
  if (schemaOk === null) {
    const problems = await mssql.checkSchema();
    schemaOk = problems.length === 0;
    if (!schemaOk) {
      console.error('Aviso: esquema do SQL Server incompativel, funcionalidade de mesas desativada:');
      problems.forEach((p) => console.error(`  - ${p}`));
    }
  }
  return schemaOk;
}

async function sendItemsToTable(mesa, items) {
  if (!mesa) {
    return {
      status: 'error',
      lastError: 'O pedido nao tem mesa definida.',
      updatedAt: new Date().toISOString()
    };
  }

  const ok = await ensureSchemaChecked();
  if (!ok) {
    return {
      status: 'error',
      lastError: 'Esquema do SQL Server incompativel; a funcionalidade de mesas esta desativada. Ve os logs do servidor.',
      updatedAt: new Date().toISOString()
    };
  }

  const sendable = items.filter((item) => item.code && item.code !== 'MANUAL' && /^\d+$/.test(String(item.code)));
  const skipped = items.filter((item) => !sendable.includes(item));

  const results = [];
  for (const item of sendable) {
    const result = await mssql.addItem(mesa, Number(item.code), item.qty);
    results.push({
      code: item.code,
      name: item.name,
      ok: result.ok,
      id: result.id,
      error: result.error
    });
  }

  const failed = results.filter((entry) => !entry.ok);
  const status = failed.length === 0 ? (skipped.length > 0 ? 'partial' : 'sent') : 'error';

  return {
    status,
    mesa,
    sentAt: new Date().toISOString(),
    results,
    skipped: skipped.map((item) => ({ code: item.code, name: item.name })),
    lastError: failed.length > 0 ? failed.map((f) => `${f.name}: ${f.error}`).join('; ') : null
  };
}

async function getMesaStatus(mesa) {
  const ok = await ensureSchemaChecked();
  if (!ok) {
    return { ok: false, error: 'Esquema do SQL Server incompativel.' };
  }
  return mssql.getMesa(mesa);
}

async function removeItemsFromTable(consumoIds) {
  if (!consumoIds || consumoIds.length === 0) {
    return { ok: true, removed: 0 };
  }
  const ok = await ensureSchemaChecked();
  if (!ok) {
    return { ok: false, error: 'Esquema do SQL Server incompativel.' };
  }
  return mssql.removeItems(consumoIds);
}

module.exports = { sendItemsToTable, getMesaStatus, removeItemsFromTable };
