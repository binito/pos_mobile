const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ZONESOFT_ENABLED = process.env.ZONESOFT_ENABLED === '1';
const ZONESOFT_SCRIPT = process.env.ZONESOFT_SCRIPT || path.join(__dirname, '..', '..', 'tools', 'zonesoft_create_order.py');
const ZONESOFT_PYTHON = process.env.ZONESOFT_PYTHON || 'python3';
const ZONESOFT_NIF = process.env.ZONESOFT_NIF;
const ZONESOFT_LOGIN = process.env.ZONESOFT_LOGIN;
const ZONESOFT_PASSWORD = process.env.ZONESOFT_PASSWORD;
const ZONESOFT_ORDER_CLIENT_SEARCH = process.env.ZONESOFT_ORDER_CLIENT_SEARCH || '2';
const ZONESOFT_TIMEOUT_MS = Number(process.env.ZONESOFT_TIMEOUT_MS || 180000);

if (ZONESOFT_ENABLED && (!ZONESOFT_NIF || !ZONESOFT_LOGIN || !ZONESOFT_PASSWORD)) {
  throw new Error('ZONESOFT_NIF, ZONESOFT_LOGIN e ZONESOFT_PASSWORD tem de estar definidos quando ZONESOFT_ENABLED=1.');
}

function runCommand(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function sendOrderToZoneSoft(order) {
  if (!ZONESOFT_ENABLED) {
    return order;
  }

  if (order.payment !== 'paid' || order.zonesoft?.document) {
    return order;
  }

  if ((order.items || []).some((item) => !item.code || item.code === 'MANUAL')) {
    return {
      ...order,
      zonesoft: {
        status: 'error',
        lastError: 'Existem produtos manuais/sem codigo ZoneSoft.',
        updatedAt: new Date().toISOString()
      }
    };
  }

  const tempFile = path.join(os.tmpdir(), `pos-mobile-zonesoft-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tempFile, `${JSON.stringify(order)}\n`, 'utf8');

  try {
    const { stdout } = await runCommand(ZONESOFT_PYTHON, [ZONESOFT_SCRIPT, tempFile], {
      timeout: ZONESOFT_TIMEOUT_MS,
      env: {
        ...process.env,
        ZONESOFT_NIF,
        ZONESOFT_LOGIN,
        ZONESOFT_PASSWORD,
        ZONESOFT_ORDER_CLIENT_SEARCH
      }
    });
    const result = JSON.parse(String(stdout).trim().split('\n').pop() || '{}');
    if (!result.ok || !result.document) {
      throw new Error(result.error || 'ZoneSoft nao devolveu numero de encomenda.');
    }
    return {
      ...order,
      zonesoft: {
        status: 'sent',
        document: result.document,
        sentAt: new Date().toISOString()
      }
    };
  } catch (error) {
    const rawError = String(error.stderr || error.stdout || error.message || 'Erro ZoneSoft').trim();
    let message = rawError;
    try {
      const parsed = JSON.parse(rawError.split('\n').pop());
      message = parsed.error || message;
    } catch (parseError) {
      // Keep original message.
    }
    return {
      ...order,
      zonesoft: {
        status: 'error',
        lastError: message.slice(0, 500),
        updatedAt: new Date().toISOString()
      }
    };
  } finally {
    fs.rm(tempFile, { force: true }, () => {});
  }
}

module.exports = { sendOrderToZoneSoft, ZONESOFT_ENABLED };
