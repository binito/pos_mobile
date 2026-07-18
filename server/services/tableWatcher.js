const { readOrders, writeOrders } = require('./orders');
const { getMesaStatus } = require('./zonesoftBridge');

const CHECK_INTERVAL_MS = Number(process.env.TABLE_WATCH_INTERVAL_MS || 30000);

async function checkOpenTables() {
  const orders = readOrders();
  const candidates = orders.filter((order) =>
    order.payment === 'pending' &&
    order.mesa &&
    order.tableSync &&
    (order.tableSync.status === 'sent' || order.tableSync.status === 'partial')
  );

  if (candidates.length === 0) {
    return;
  }

  const mesaStatusCache = new Map();
  let changed = false;

  for (const order of candidates) {
    if (!mesaStatusCache.has(order.mesa)) {
      try {
        const status = await getMesaStatus(order.mesa);
        mesaStatusCache.set(order.mesa, status);
      } catch (error) {
        console.error(`tableWatcher: erro ao verificar mesa ${order.mesa}: ${error.message}`);
        mesaStatusCache.set(order.mesa, null);
      }
    }

    const status = mesaStatusCache.get(order.mesa);
    if (status && status.ok && Array.isArray(status.items) && status.items.length === 0) {
      order.payment = 'paid';
      order.updatedAt = new Date().toISOString();
      order.tableSync = {
        ...order.tableSync,
        status: 'closed',
        closedAt: new Date().toISOString()
      };
      changed = true;
      console.log(`tableWatcher: mesa ${order.mesa} ficou livre, pedido ${order.id} marcado como pago.`);
    }
  }

  if (changed) {
    writeOrders(orders);
  }
}

function startTableWatcher() {
  setInterval(() => {
    checkOpenTables().catch((error) => {
      console.error('tableWatcher: erro inesperado:', error);
    });
  }, CHECK_INTERVAL_MS);
}

module.exports = { startTableWatcher, checkOpenTables };
