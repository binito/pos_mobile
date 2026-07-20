const FREQUENT_FAMILY = '__frequent__';
const FREQUENT_LABEL = 'Frequentes';
const FREQUENT_LIMIT = 12;
const STARTER_FREQUENT_CODES = [
  '100001',
  '100057',
  '100003',
  '100006',
  '100030',
  '100056',
  '100016',
  '100045',
  '100022',
  '100047',
  '100005',
  '100085'
];

const state = {
  products: [],
  orders: [],
  freeTables: [],
  selectedFamily: FREQUENT_FAMILY,
  cart: [],
  editingId: null,
  activeTab: 'new',
  viewMode: 'grouped',
  expandedGroups: new Set()
};

const paymentLabels = {
  pending: 'Pendente',
  paid: 'Pago'
};

const money = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR'
});

const els = {};

document.addEventListener('DOMContentLoaded', () => {
  collectElements();
  bindEvents();
  loadInitialData();
  registerServiceWorker();
});

function collectElements() {
  [
    'syncStatus',
    'screen-new',
    'screen-orders',
    'formTitle',
    'customerName',
    'mesaNumber',
    'productSearch',
    'productCount',
    'familyChips',
    'productsGrid',
    'productsEmpty',
    'cartPanel',
    'cartTitle',
    'cartMeta',
    'cartItems',
    'cartTotal',
    'paymentSelect',
    'saveOrderButton',
    'clearCartButton',
    'newOrderButton',
    'closeCartButton',
    'manualName',
    'manualPrice',
    'manualQty',
    'addManualButton',
    'orderSearch',
    'ordersList',
    'ordersEmpty',
    'cartBackdrop',
    'cartDock',
    'openCartButton',
    'dockCount',
    'dockTotal',
    'toast',
    'btnViewIndividual',
    'btnViewGrouped',
    'freeTablesContainer',
    'freeTablesList',
    'activeCustomersContainer',
    'activeCustomersList'
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  els.productSearch.addEventListener('input', renderProducts);
  els.familyChips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-family]');
    if (!button) return;
    state.selectedFamily = button.dataset.family;
    renderFamilies();
    renderProducts();
  });

  els.productsGrid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-add-product]');
    if (!button) return;
    const product = state.products.find((entry) => entry.code === button.dataset.addProduct);
    if (product) {
      addProduct(product);
    }
  });

  els.cartItems.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cart-action]');
    if (!button) return;
    const key = button.dataset.key;
    const action = button.dataset.cartAction;
    if (action === 'inc') updateCartQty(key, 1);
    if (action === 'dec') updateCartQty(key, -1);
    if (action === 'remove') removeCartItem(key);
  });

  els.saveOrderButton.addEventListener('click', saveOrder);
  els.clearCartButton.addEventListener('click', clearCart);
  els.newOrderButton.addEventListener('click', resetOrderForm);
  els.addManualButton.addEventListener('click', addManualProduct);
  els.openCartButton.addEventListener('click', openCartSheet);
  els.closeCartButton.addEventListener('click', closeCartSheet);
  els.cartBackdrop.addEventListener('click', closeCartSheet);

  els.orderSearch.addEventListener('input', renderOrders);
  
  els.btnViewIndividual.addEventListener('click', () => {
    state.viewMode = 'individual';
    els.btnViewIndividual.classList.add('is-active');
    els.btnViewGrouped.classList.remove('is-active');
    renderOrders();
  });

  els.btnViewGrouped.addEventListener('click', () => {
    state.viewMode = 'grouped';
    els.btnViewGrouped.classList.add('is-active');
    els.btnViewIndividual.classList.remove('is-active');
    renderOrders();
  });

  els.ordersList.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit-order]');
    const copyButton = event.target.closest('[data-copy-order]');
    const deleteButton = event.target.closest('[data-delete-order]');
    const toggleGroupButton = event.target.closest('[data-toggle-group]');
    const deleteGroupButton = event.target.closest('[data-delete-group]');

    if (editButton) editOrder(editButton.dataset.editOrder);
    if (copyButton) duplicateOrder(copyButton.dataset.copyOrder);
    if (deleteButton) deleteOrder(deleteButton.dataset.deleteOrder);
    
    if (toggleGroupButton) {
      const key = toggleGroupButton.dataset.toggleGroup;
      if (state.expandedGroups.has(key)) {
        state.expandedGroups.delete(key);
      } else {
        state.expandedGroups.add(key);
      }
      renderOrders();
    }
    
    if (deleteGroupButton) {
      const orderIds = JSON.parse(deleteGroupButton.dataset.orderIds);
      const customerName = deleteGroupButton.dataset.customerName;
      deleteGroupOrders(orderIds, customerName);
    }
  });

  els.ordersList.addEventListener('change', (event) => {
    const paymentSelect = event.target.closest('[data-order-payment]');
    const groupPaymentSelect = event.target.closest('[data-group-payment]');
    
    if (paymentSelect) {
      patchOrder(paymentSelect.dataset.orderPayment, { payment: paymentSelect.value });
    }
    if (groupPaymentSelect) {
      const orderIds = JSON.parse(groupPaymentSelect.dataset.orderIds);
      patchGroupOrders(orderIds, { payment: groupPaymentSelect.value });
    }
  });

  els.activeCustomersList.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-select-customer]');
    if (!chip) return;
    const name = chip.dataset.selectCustomer;
    const mesa = chip.dataset.selectMesa;
    els.customerName.value = name;
    if (mesa) {
      els.mesaNumber.value = mesa;
    }
    showToast(mesa ? `Cliente "${name}" selecionado (Mesa ${mesa}).` : `Cliente "${name}" selecionado.`);
  });

  els.freeTablesList.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-select-mesa]');
    if (!chip) return;
    els.mesaNumber.value = chip.dataset.selectMesa;
    showToast(`Mesa ${chip.dataset.selectMesa} selecionada.`);
  });
}

async function loadInitialData() {
  setSync('A carregar');
  try {
    const [productsPayload, ordersPayload] = await Promise.all([
      apiGet('/api/products'),
      apiGet('/api/orders')
    ]);

    state.products = productsPayload.products || [];
    state.orders = ordersPayload.orders || [];
    renderAll();
    setSync(`${state.products.length} produtos`);
  } catch (error) {
    setSync('Erro', true);
    showToast(error.message, 'error');
  }
  loadFreeTables();
}

async function loadFreeTables() {
  try {
    const payload = await apiGet('/api/mesas-livres');
    state.freeTables = payload.ok ? (payload.mesas || []) : [];
  } catch (error) {
    state.freeTables = [];
  }
  renderFreeTables();
}

async function loadOrders() {
  const payload = await apiGet('/api/orders');
  state.orders = payload.orders || [];
  renderProducts();
  renderOrders();
}

async function apiGet(url) {
  const response = await fetch(url, { cache: 'no-store' });
  return parseApiResponse(response);
}

async function parseApiResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new Error('Login necessário.');
  }
  if (!response.ok) {
    throw new Error(payload.error || 'Erro no servidor.');
  }
  return payload;
}

function renderAll() {
  renderFamilies();
  renderProducts();
  renderCart();
  renderOrders();
  renderFreeTables();
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  });
  els['screen-new'].classList.toggle('is-active', tab === 'new');
  els['screen-orders'].classList.toggle('is-active', tab === 'orders');
  closeCartSheet();

  if (tab === 'orders') {
    renderOrders();
    loadOrders().catch(() => {});
  }

  if (tab === 'new') {
    loadFreeTables();
  }
}

function renderFamilies() {
  const families = [
    { value: FREQUENT_FAMILY, label: FREQUENT_LABEL },
    { value: 'Todos', label: 'Todos' },
    ...Array.from(new Set(state.products.map((product) => product.family).filter(Boolean)))
      .map((family) => ({ value: family, label: family }))
  ];
  els.familyChips.innerHTML = families.map((family) => `
    <button class="family-chip ${family.value === state.selectedFamily ? 'is-active' : ''}" type="button" data-family="${escapeHtml(family.value)}">
      ${escapeHtml(family.label)}
    </button>
  `).join('');
}

function renderProducts() {
  const query = normalizeText(els.productSearch.value);
  const sourceProducts = state.selectedFamily === FREQUENT_FAMILY ? getFrequentProducts() : state.products;
  const products = sourceProducts.filter((product) => {
    const matchesFamily = state.selectedFamily === FREQUENT_FAMILY || state.selectedFamily === 'Todos' || product.family === state.selectedFamily;
    const haystack = normalizeText(`${product.code} ${product.name} ${product.family}`);
    return matchesFamily && (!query || haystack.includes(query));
  });

  els.productCount.textContent = `${products.length} produto${products.length === 1 ? '' : 's'}`;
  els.productsEmpty.hidden = products.length > 0;
  els.productsGrid.innerHTML = products.map((product) => {
    const current = state.cart.find((item) => item.code === product.code && !item.manual);
    return `
      <article class="product-card">
        <div class="product-info">
          <strong>${escapeHtml(product.name)}</strong>
          <span>${escapeHtml(product.family)} · ${escapeHtml(product.code)}</span>
        </div>
        <div class="product-action">
          ${current ? `<span class="qty-pill">${current.qty}</span>` : ''}
          <span class="price">${formatMoney(product.price)}</span>
          <button class="icon-button add-product" type="button" data-add-product="${escapeHtml(product.code)}" aria-label="Adicionar ${escapeHtml(product.name)}"><span class="add-symbol">+</span><span class="add-label">Adicionar</span></button>
        </div>
      </article>
    `;
  }).join('');
}

function getFrequentProducts() {
  const byCode = new Map(state.products.map((product) => [product.code, product]));
  const scores = new Map();

  for (const order of state.orders) {
    for (const item of order.items || []) {
      if (!item.code || item.code === 'MANUAL' || !byCode.has(item.code)) {
        continue;
      }
      scores.set(item.code, (scores.get(item.code) || 0) + Number(item.qty || 1));
    }
  }

  const orderedCodes = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1] || byCode.get(a[0]).name.localeCompare(byCode.get(b[0]).name, 'pt'))
    .map(([code]) => code);

  for (const code of STARTER_FREQUENT_CODES) {
    if (byCode.has(code) && !orderedCodes.includes(code)) {
      orderedCodes.push(code);
    }
  }

  return orderedCodes
    .slice(0, FREQUENT_LIMIT)
    .map((code) => byCode.get(code))
    .filter(Boolean);
}

function addProduct(product) {
  const existing = state.cart.find((item) => item.code === product.code && !item.manual);
  if (existing) {
    existing.qty += 1;
  } else {
    state.cart.push({
      key: product.code,
      code: product.code,
      name: product.name,
      family: product.family,
      vat: product.vat,
      unitPrice: product.price,
      qty: 1,
      manual: false
    });
  }

  renderCart();
  renderProducts();
}

function addManualProduct() {
  const name = els.manualName.value.trim();
  const price = parseDecimal(els.manualPrice.value);
  const qty = Math.max(1, Math.round(Number(els.manualQty.value || 1)));

  if (!name || !Number.isFinite(price)) {
    showToast('Indica nome e preço do produto manual.', 'error');
    return;
  }

  state.cart.push({
    key: `manual-${Date.now()}`,
    code: 'MANUAL',
    name,
    family: 'Manual',
    vat: 0,
    unitPrice: roundMoney(price),
    qty,
    manual: true
  });

  els.manualName.value = '';
  els.manualPrice.value = '';
  els.manualQty.value = '1';
  renderCart();
  showToast('Produto manual adicionado.');
}

function updateCartQty(key, delta) {
  const item = state.cart.find((entry) => entry.key === key);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    removeCartItem(key);
    return;
  }
  renderCart();
  renderProducts();
}

function removeCartItem(key) {
  state.cart = state.cart.filter((entry) => entry.key !== key);
  renderCart();
  renderProducts();
}

function clearCart() {
  state.cart = [];
  renderCart();
  renderProducts();
}

function renderCart() {
  const totalQty = state.cart.reduce((sum, item) => sum + item.qty, 0);
  const total = cartTotal();
  els.formTitle.textContent = state.editingId ? `Editar ${state.editingId}` : 'Novo pedido';
  els.cartTitle.textContent = state.editingId ? `Editar ${state.editingId}` : 'Pedido atual';
  els.cartMeta.textContent = totalQty > 0 ? `${totalQty} artigo${totalQty === 1 ? '' : 's'}` : 'Sem produtos';
  els.cartTotal.textContent = formatMoney(total);
  els.dockCount.textContent = `${totalQty} artigo${totalQty === 1 ? '' : 's'}`;
  els.dockTotal.textContent = formatMoney(total);
  els.cartDock.hidden = totalQty === 0;
  els.saveOrderButton.disabled = totalQty === 0;

  if (state.cart.length === 0) {
    els.cartItems.innerHTML = '<div class="cart-empty">Toca no + dos produtos para começar.</div>';
    return;
  }

  els.cartItems.innerHTML = state.cart.map((item) => `
    <div class="cart-item">
      <div class="cart-item-main">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${formatMoney(item.unitPrice)} · ${escapeHtml(item.family)}</span>
      </div>
      <div class="stepper" aria-label="Quantidade de ${escapeHtml(item.name)}">
        <button type="button" data-cart-action="dec" data-key="${escapeHtml(item.key)}">-</button>
        <span>${item.qty}</span>
        <button type="button" data-cart-action="inc" data-key="${escapeHtml(item.key)}">+</button>
      </div>
      <strong class="line-total">${formatMoney(item.qty * item.unitPrice)}</strong>
      <button class="icon-button remove-button" type="button" data-cart-action="remove" data-key="${escapeHtml(item.key)}" aria-label="Remover ${escapeHtml(item.name)}">x</button>
    </div>
  `).join('');
}

function cartTotal() {
  return roundMoney(state.cart.reduce((sum, item) => sum + item.qty * item.unitPrice, 0));
}

async function persistOrder() {
  const customerName = els.customerName.value.trim();
  if (!customerName) {
    throw new Error('Indica o nome do cliente.');
  }
  if (state.cart.length === 0) {
    throw new Error('Adiciona pelo menos um produto.');
  }

  const payload = {
    customer: {
      name: customerName
    },
    mesa: els.mesaNumber.value ? Number(els.mesaNumber.value) : null,
    payment: els.paymentSelect.value,
    items: state.cart.map((item) => ({
      code: item.manual ? '' : item.code,
      name: item.name,
      family: item.family,
      vat: item.vat,
      unitPrice: item.unitPrice,
      qty: item.qty,
      repeatQty: item.repeatQty || item.qty
    }))
  };

  const url = state.editingId ? `/api/orders/${encodeURIComponent(state.editingId)}` : '/api/orders';
  const method = state.editingId ? 'PUT' : 'POST';
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await parseApiResponse(response);
  await loadOrders();
  return data.order;
}

async function saveOrder() {
  if (!els.customerName.value.trim()) {
    showToast('Indica o nome do cliente.', 'error');
    els.customerName.focus();
    return;
  }
  if (state.cart.length === 0) {
    showToast('Adiciona pelo menos um produto.', 'error');
    return;
  }

  const wasEditing = Boolean(state.editingId);
  els.saveOrderButton.disabled = true;
  setSync('A guardar');

  try {
    const order = await persistOrder();
    resetOrderForm();
    switchTab('orders');

    if (order.mesa) {
      await sendOrderToTable(order.id);
      loadFreeTables();
    } else {
      showToast(wasEditing ? 'Pedido atualizado.' : `Pedido ${order.id} guardado.`);
      setSync('Atualizado');
    }
  } catch (error) {
    showToast(error.message, 'error');
    setSync('Erro', true);
  } finally {
    els.saveOrderButton.disabled = state.cart.length === 0;
  }
}

async function sendOrderToTable(orderId, items) {
  const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/send-to-table`, {
    method: 'POST',
    headers: items ? { 'Content-Type': 'application/json' } : undefined,
    body: items ? JSON.stringify({ items }) : undefined
  });
  const data = await parseApiResponse(response);
  state.orders = state.orders.map((entry) => (entry.id === orderId ? data.order : entry));
  renderOrders();

  const sync = data.order.tableSync;
  if (sync?.status === 'sent') {
    showToast(`Enviado para a mesa ${sync.mesa}.`);
    setSync('Enviado para mesa');
  } else if (sync?.status === 'partial') {
    showToast(`Enviado com avisos: ${sync.lastError || 'alguns artigos nao foram enviados'}.`, 'error');
    setSync('Enviado com avisos', true);
  } else {
    showToast(sync?.lastError || 'Falha ao enviar para a mesa.', 'error');
    setSync('Erro', true);
  }
  return data.order;
}

function resetOrderForm() {
  state.editingId = null;
  state.cart = [];
  els.customerName.value = '';
  els.mesaNumber.value = '';
  els.paymentSelect.value = 'pending';
  closeCartSheet();
  renderCart();
  renderProducts();
}

function renderOrders() {
  renderActiveCustomers();
  const filtered = getFilteredOrders();

  els.btnViewIndividual.classList.toggle('is-active', state.viewMode === 'individual');
  els.btnViewGrouped.classList.toggle('is-active', state.viewMode === 'grouped');

  if (state.viewMode === 'grouped') {
    renderOrderList(buildGroupedOrderListItems(filtered));
    return;
  }

  renderOrderList(filtered.map((order) => ({ type: 'individual', key: order.id, data: order })));
}

function getFilteredOrders() {
  const query = normalizeText(els.orderSearch.value);
  return state.orders.filter((order) => !query || orderSearchText(order).includes(query));
}

function orderSearchText(order) {
  return normalizeText([
    order.id,
    order.customer?.name,
    order.items?.map((item) => item.name).join(' ')
  ].join(' '));
}

function buildGroupedOrderListItems(orders) {
  const { groups, ungrouped } = groupOrdersByName(orders);
  const listItems = [
    ...groups.map((group) => ({
      type: 'group',
      key: group.key,
      latestDate: group.orders[0] ? new Date(group.orders[0].createdAt) : new Date(0),
      data: group
    })),
    ...ungrouped.map((order) => ({
      type: 'individual',
      key: `individual-${order.id}`,
      latestDate: new Date(order.createdAt),
      data: order
    }))
  ];

  return listItems.sort((a, b) => b.latestDate - a.latestDate);
}

function renderOrderList(listItems) {
  els.ordersEmpty.hidden = listItems.length > 0;
  els.ordersList.innerHTML = listItems.map(renderOrderListItem).join('');
}

function renderOrderListItem(item) {
  if (item.type === 'group') {
    return renderGroupOrderCard(item.data);
  }
  return renderIndividualOrderCard(item.data);
}

function renderGroupOrderCard(group) {
  const isExpanded = state.expandedGroups.has(group.key);
  const orderIds = group.orders.map((order) => order.id);
  const orderIdsAttr = escapeHtml(JSON.stringify(orderIds));
  const statusText = group.payment === 'paid' ? 'Pago' : 'Pendente';
  const paidClass = group.payment === 'paid' ? ' is-paid' : '';

  return `
    <article class="order-card group-card${paidClass}" data-group-key="${escapeHtml(group.key)}">
      <div class="order-card-head">
        <div class="group-title">
          <strong>👤 ${escapeHtml(group.customerName)} <span class="group-badge">${group.orders.length} ${group.orders.length === 1 ? 'pedido' : 'pedidos'}</span>${mesaBadge(group.orders[0]?.mesa)}</strong>
          <span>Conta conjunta (${statusText}) · Último: ${formatDate(group.orders[0].createdAt)}</span>
        </div>
      </div>
      <p class="order-items">${escapeHtml(orderItemsSummary(group.items))}</p>
      <div class="order-meta">
        <div class="group-totals">
          Total do grupo: <strong>${formatMoney(group.total)}</strong>
        </div>
      </div>
      <div class="order-card-actions">
        <select data-group-payment="${escapeHtml(group.key)}" data-order-ids="${orderIdsAttr}" aria-label="Pagamento do grupo ${escapeHtml(group.customerName)}">
          ${paymentOptions(group.payment)}
        </select>
        <button class="secondary-button" type="button" data-toggle-group="${escapeHtml(group.key)}">
          ${isExpanded ? 'Ocultar' : 'Ver pedidos'}
        </button>
        <button class="danger-button" type="button" data-delete-group="${escapeHtml(group.key)}" data-order-ids="${orderIdsAttr}" data-customer-name="${escapeHtml(group.customerName)}">
          Eliminar
        </button>
      </div>
      ${isExpanded ? renderGroupOrderDetails(group) : ''}
    </article>
  `;
}

function renderGroupOrderDetails(group) {
  return `
    <div class="group-details-list">
      <h4>Pedidos individuais de ${escapeHtml(group.customerName)}:</h4>
      ${group.orders.map(renderSubOrderCard).join('')}
    </div>
  `;
}

function renderSubOrderCard(order) {
  const paidClass = order.payment === 'paid' ? ' is-paid' : '';

  return `
    <div class="sub-order-card${paidClass}">
      <div class="sub-order-header">
        <strong>${escapeHtml(order.id)}${mesaBadge(order.mesa)}</strong>
        <span>${formatDate(order.createdAt)}</span>
      </div>
      <p class="order-items">${escapeHtml(orderItemsSummary(order.items))}</p>
      <div class="sub-order-footer">
        <strong>${formatMoney(order.total)}</strong>
        <div class="sub-order-actions">
          ${orderActionButtons(order, { compact: true })}
        </div>
      </div>
    </div>
  `;
}

function renderIndividualOrderCard(order) {
  const paidClass = order.payment === 'paid' ? ' is-paid' : '';

  return `
    <article class="order-card${paidClass}">
      <div class="order-card-head">
        <div>
          <strong>${escapeHtml(order.customer?.name || 'Sem cliente')}${mesaBadge(order.mesa)}</strong>
          <span>${escapeHtml(order.id)} · ${formatDate(order.createdAt)}</span>
        </div>
      </div>
      <p class="order-items">${escapeHtml(orderItemsSummary(order.items))}</p>
      <div class="order-meta">
        <strong>${formatMoney(order.total)}</strong>
        ${zoneSoftStatus(order)}
      </div>
      <div class="order-card-actions">
        ${orderPaymentSelect(order)}
        ${orderActionButtons(order)}
      </div>
    </article>
  `;
}

function orderItemsSummary(items = []) {
  return items.map((item) => `${item.qty}x ${item.name}`).join(', ');
}

function orderPaymentSelect(order) {
  return `
    <select data-order-payment="${escapeHtml(order.id)}" aria-label="Pagamento de ${escapeHtml(order.id)}">
      ${paymentOptions(order.payment)}
    </select>
  `;
}

function orderActionButtons(order, { compact = false } = {}) {
  const compactClass = compact ? ' compact-btn' : '';
  const copyText = compact ? 'Rodada' : 'Adicionar rodada';

  return `
    <button class="secondary-button${compactClass}" type="button" data-edit-order="${escapeHtml(order.id)}">Editar</button>
    <button class="ghost-button${compactClass}" type="button" data-copy-order="${escapeHtml(order.id)}">${copyText}</button>
    <button class="danger-button${compactClass}" type="button" data-delete-order="${escapeHtml(order.id)}">Eliminar</button>
  `;
}

function groupOrdersByName(orders) {
  const groups = {};
  const ungrouped = [];

  for (const order of orders) {
    const rawName = order.customer?.name || '';
    const name = rawName.trim();
    if (!name) {
      ungrouped.push(order);
      continue;
    }

    const key = `${name.toLowerCase()}_${order.payment}`;
    if (!groups[key]) {
      groups[key] = {
        key,
        customerName: name,
        payment: order.payment,
        orders: [],
        total: 0,
        items: []
      };
    }
    groups[key].orders.push(order);
    groups[key].total += Number(order.total || 0);
  }

  for (const key in groups) {
    const group = groups[key];
    group.orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    if (group.orders.length > 0) {
      group.customerName = group.orders[0].customer?.name?.trim() || group.customerName;
    }

    const itemMap = new Map();
    for (const order of group.orders) {
      for (const item of order.items || []) {
        const itemKey = item.code && item.code !== 'MANUAL' ? `code-${item.code}` : `manual-${item.name}`;
        if (!itemMap.has(itemKey)) {
          itemMap.set(itemKey, {
            code: item.code,
            name: item.name,
            family: item.family,
            vat: item.vat,
            unitPrice: item.unitPrice,
            qty: 0,
            lineTotal: 0
          });
        }
        const existing = itemMap.get(itemKey);
        existing.qty += Number(item.qty || 0);
        existing.lineTotal += Number(item.lineTotal || (item.qty * item.unitPrice) || 0);
      }
    }
    group.items = Array.from(itemMap.values());
    group.total = roundMoney(group.total);
  }

  return {
    groups: Object.values(groups),
    ungrouped
  };
}

async function patchGroupOrders(orderIds, patch) {
  const sendingToZoneSoft = patch.payment === 'paid';
  if (sendingToZoneSoft) {
    showToast('A enviar pedidos para ZoneSoft...');
  }
  setSync('A atualizar');
  try {
    for (const orderId of orderIds) {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const data = await parseApiResponse(response);
      state.orders = state.orders.map((order) => order.id === orderId ? data.order : order);
    }
    renderOrders();
    showToast('Pedidos do grupo atualizados.');
    setSync('Atualizado');
  } catch (error) {
    showToast(error.message, 'error');
    await loadOrders().catch(() => {});
    setSync('Erro', true);
  }
}

async function deleteGroupOrders(orderIds, customerName) {
  if (!window.confirm(`Eliminar todos os ${orderIds.length} pedidos de ${customerName}?`)) {
    return;
  }
  setSync('A eliminar');
  try {
    for (const orderId of orderIds) {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
        method: 'DELETE'
      });
      await parseApiResponse(response);
      state.orders = state.orders.filter((entry) => entry.id !== orderId);
    }
    renderOrders();
    renderProducts();
    showToast('Pedidos do grupo eliminados.');
    setSync('Atualizado');
  } catch (error) {
    showToast(error.message, 'error');
    await loadOrders().catch(() => {});
    setSync('Erro', true);
  }
}

function paymentOptions(current) {
  return Object.entries(paymentLabels).map(([value, label]) => (
    `<option value="${value}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`
  )).join('');
}

async function patchOrder(orderId, patch) {
  const sendingToZoneSoft = patch.payment === 'paid';
  try {
    if (sendingToZoneSoft) {
      showToast('A enviar para ZoneSoft...');
    }
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    const data = await parseApiResponse(response);
    state.orders = state.orders.map((order) => order.id === orderId ? data.order : order);
    renderOrders();
    showToast(zoneSoftMessage(data.order) || 'Pedido atualizado.');
  } catch (error) {
    showToast(error.message, 'error');
    await loadOrders().catch(() => {});
  }
}

function zoneSoftStatus(order) {
  if (!order.zonesoft) {
    return '';
  }
  if (order.zonesoft.status === 'sent' && order.zonesoft.document) {
    return `<span class="muted">ZoneSoft: ${escapeHtml(order.zonesoft.document)}</span>`;
  }
  if (order.zonesoft.status === 'error') {
    return `<span class="muted">ZoneSoft: erro</span>`;
  }
  return '';
}

function zoneSoftMessage(order) {
  if (order.zonesoft?.status === 'sent' && order.zonesoft.document) {
    return `Encomenda ${order.zonesoft.document} criada no ZoneSoft.`;
  }
  if (order.zonesoft?.status === 'error') {
    return `Pedido pago, mas falhou ZoneSoft: ${order.zonesoft.lastError || 'erro desconhecido'}`;
  }
  return '';
}

async function deleteOrder(orderId) {
  const order = state.orders.find((entry) => entry.id === orderId);
  const label = order?.customer?.name ? `${order.customer.name} (${orderId})` : orderId;
  if (!window.confirm(`Eliminar pedido ${label}?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE'
    });
    const data = await parseApiResponse(response);
    state.orders = state.orders.filter((entry) => entry.id !== orderId);
    renderOrders();
    renderProducts();
    if (data.tableRemoval && !data.tableRemoval.ok) {
      showToast(`Pedido eliminado, mas falhou remover da mesa: ${data.tableRemoval.error || 'erro desconhecido'}.`, 'error');
    } else {
      showToast('Pedido eliminado.');
    }
  } catch (error) {
    showToast(error.message, 'error');
    await loadOrders().catch(() => {});
  }
}

function editOrder(orderId) {
  const order = state.orders.find((entry) => entry.id === orderId);
  if (!order) return;

  state.editingId = order.id;
  fillOrderForm(order);
  switchTab('new');
  openCartSheet();
}

async function duplicateOrder(orderId) {
  const order = state.orders.find((entry) => entry.id === orderId);
  if (!order) return;

  const roundItems = (order.items || [])
    .filter((item) => item.code && item.code !== 'MANUAL')
    .map((item) => ({
      code: item.code,
      name: item.name,
      qty: Number(item.repeatQty || 1)
    }));

  const payload = {
    customer: {
      name: order.customer?.name || ''
    },
    mesa: order.mesa || null,
    payment: order.payment || 'pending',
    items: (order.items || []).map((item) => ({
      code: item.code === 'MANUAL' ? '' : item.code,
      name: item.name,
      family: item.family,
      vat: item.vat,
      unitPrice: item.unitPrice,
      qty: Math.min(Number(item.qty || 1) + Number(item.repeatQty || 1), 999),
      repeatQty: Number(item.repeatQty || 1)
    }))
  };

  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await parseApiResponse(response);
    state.orders = state.orders.map((entry) => entry.id === orderId ? data.order : entry);
    renderOrders();
    renderProducts();

    if (order.mesa && roundItems.length > 0) {
      await sendOrderToTable(orderId, roundItems);
    } else {
      showToast('Quantidade atualizada no pedido.');
    }
  } catch (error) {
    showToast(error.message, 'error');
    await loadOrders().catch(() => {});
  }
}

function fillOrderForm(order) {
  els.customerName.value = order.customer?.name || '';
  els.mesaNumber.value = order.mesa || '';
  els.paymentSelect.value = paymentLabels[order.payment] ? order.payment : 'pending';
  state.cart = (order.items || []).map((item, index) => {
    const product = state.products.find((entry) => entry.code === item.code);
    return {
      key: product ? product.code : `manual-${order.id || 'copy'}-${index}`,
      code: product ? product.code : item.code || 'MANUAL',
      name: product ? product.name : item.name,
      family: product ? product.family : item.family || 'Manual',
      vat: product ? product.vat : item.vat || 0,
      unitPrice: product ? product.price : item.unitPrice,
      qty: item.qty,
      repeatQty: item.repeatQty || item.qty || 1,
      manual: !product
    };
  });
  renderCart();
  renderProducts();
}

function openCartSheet() {
  document.body.classList.add('cart-open');
  els.cartBackdrop.hidden = false;
}

function closeCartSheet() {
  document.body.classList.remove('cart-open');
  els.cartBackdrop.hidden = true;
}

function setSync(text, isError = false) {
  els.syncStatus.textContent = text;
  els.syncStatus.classList.toggle('is-error', isError);
}

function showToast(message, type = 'ok') {
  els.toast.textContent = message;
  els.toast.className = `toast is-visible ${type === 'error' ? 'is-error' : 'is-ok'}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove('is-visible');
  }, 2800);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function formatMoney(value) {
  return money.format(Number(value) || 0);
}

function mesaBadge(mesa) {
  if (!mesa) return '';
  return `<span class="mesa-badge" style="display:inline-block;background:#ffd60a;color:#1a1a1a;font-weight:700;padding:2px 10px;border-radius:999px;margin-left:8px;font-size:0.85em;">🍽️ Mesa ${escapeHtml(String(mesa))}</span>`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function toDatetimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function parseDecimal(value) {
  const normalized = String(value || '').replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderFreeTables() {
  if (!state.freeTables.length) {
    els.freeTablesContainer.hidden = true;
    els.freeTablesList.innerHTML = '';
    return;
  }

  els.freeTablesContainer.hidden = false;
  els.freeTablesList.innerHTML = state.freeTables.map((mesa) => `
    <button class="active-customer-chip" type="button" data-select-mesa="${escapeHtml(String(mesa))}">
      Mesa ${escapeHtml(String(mesa))}
    </button>
  `).join('');
}

function renderActiveCustomers() {
  const pendingOrders = state.orders.filter((order) => order.payment === 'pending' && order.customer?.name?.trim());
  const nameMap = new Map();
  
  for (const order of pendingOrders) {
    const name = order.customer.name.trim();
    const nameLower = name.toLowerCase();
    const date = new Date(order.createdAt);
    const entry = nameMap.get(nameLower) || { name, date, mesa: null };
    if (date > entry.date) {
      entry.date = date;
      entry.name = name;
    }
    if (order.mesa) {
      entry.mesa = order.mesa;
    }
    nameMap.set(nameLower, entry);
  }

  const sortedNames = Array.from(nameMap.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'pt'));

  if (sortedNames.length === 0) {
    els.activeCustomersContainer.hidden = true;
    els.activeCustomersList.innerHTML = '';
    return;
  }

  els.activeCustomersContainer.hidden = false;
  els.activeCustomersList.innerHTML = sortedNames.map((item) => `
    <button class="active-customer-chip" type="button" data-select-customer="${escapeHtml(item.name)}" data-select-mesa="${item.mesa || ''}">
      ${escapeHtml(item.name)}${item.mesa ? ` (Mesa ${escapeHtml(String(item.mesa))})` : ''}
    </button>
  `).join('');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js?v=20260720-1').catch(() => {});
  }
}
