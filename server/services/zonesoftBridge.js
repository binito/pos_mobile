const http = require('http');
const { URL } = require('url');

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://192.168.1.192:8799';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
const BRIDGE_TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT_MS || 8000);

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BRIDGE_URL);
    const payload = body ? JSON.stringify(body) : null;

    const req = http.request(
      url,
      {
        method,
        timeout: BRIDGE_TIMEOUT_MS,
        headers: {
          'X-Bridge-Token': BRIDGE_TOKEN,
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (error) {
            reject(new Error(`Resposta invalida da bridge: ${raw.slice(0, 200)}`));
            return;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.error || `Bridge devolveu ${res.statusCode}`));
          }
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('Timeout a contactar a bridge.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function sendItemsToTable(mesa, items) {
  if (!BRIDGE_TOKEN) {
    return {
      status: 'error',
      lastError: 'BRIDGE_TOKEN nao esta configurado.',
      updatedAt: new Date().toISOString()
    };
  }
  if (!mesa) {
    return {
      status: 'error',
      lastError: 'O pedido nao tem mesa definida.',
      updatedAt: new Date().toISOString()
    };
  }

  const sendable = items.filter((item) => item.code && item.code !== 'MANUAL' && /^\d+$/.test(String(item.code)));
  const skipped = items.filter((item) => !sendable.includes(item));

  const results = [];
  for (const item of sendable) {
    try {
      const result = await request('POST', '/add-item', {
        mesa,
        codigo: Number(item.code),
        qtd: item.qty
      });
      results.push({ code: item.code, name: item.name, ok: true, id: result.id });
    } catch (error) {
      results.push({ code: item.code, name: item.name, ok: false, error: error.message });
    }
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
  return request('GET', `/mesa/${encodeURIComponent(mesa)}`);
}

async function removeItemsFromTable(consumoIds) {
  if (!consumoIds || consumoIds.length === 0) {
    return { ok: true, removed: 0 };
  }
  if (!BRIDGE_TOKEN) {
    return { ok: false, error: 'BRIDGE_TOKEN nao esta configurado.' };
  }
  try {
    return await request('POST', '/remove-items', { ids: consumoIds });
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { sendItemsToTable, getMesaStatus, removeItemsFromTable, BRIDGE_URL };
