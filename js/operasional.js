import { catalogRequest, orderRequest } from './api.js';
import { rupiah, durasi, tanggal, tanggalWaktu, escapeHtml } from './format.js';
import { ikon, pasangIkon } from './ikon.js';

const $ = (selector) => document.querySelector(selector);
const state = { services: [], customers: [], orders: [], expenses: [], selected: null, receipt: null, lastSavedOrderId: null };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const safe = escapeHtml;
const labels = { baru: 'Antre', diproses: 'Diproses', selesai: 'Siap diambil', diambil: 'Selesai', dibatalkan: 'Dibatalkan', belum_bayar: 'Belum bayar', dp: 'DP', lunas: 'Lunas' };
const label = (value) => labels[value] || value || '—';
const payload = (object) => ({ method: 'POST', body: JSON.stringify(object) });
const fail = (id, message, retry) => {
  const element = $(id);
  element.hidden = false;
  element.className = 'api-state error';
  element.innerHTML = `<span>${safe(message)}</span> <button type="button">Coba lagi</button>`;
  element.querySelector('button').addEventListener('click', retry);
};
const info = (id, message) => {
  const element = $(id);
  element.hidden = !message;
  element.className = 'api-state';
  element.textContent = message;
};
const showError = (selector, message, field) => {
  const element = $(selector);
  element.textContent = message;
  element.hidden = false;
  field?.focus();
};
const clearError = (selector) => { $(selector).hidden = true; };
const setBusy = (form, busy) => { form.querySelectorAll('button').forEach((button) => { button.disabled = busy; }); };
const intValue = (field, allowZero = false) => {
  const raw = field.value.trim();
  const number = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(number) && (allowZero ? number >= 0 : number > 0) ? number : null;
};
const quantityValue = (field, unit) => {
  const raw = field.value.trim();
  const valid = unit === 'kg' ? /^(?:\d+(?:[.,]\d{1,3})?|[.,]\d{1,3})$/.test(raw) : /^\d+$/.test(raw);
  const value = Number(raw.replace(',', '.'));
  return valid && Number.isFinite(value) && value > 0 ? value : null;
};
const selectOptions = (items, placeholder, valueKey, labelKey) => `<option value="">${placeholder}</option>` + items.map((item) => `<option value="${safe(item[valueKey])}">${safe(item[labelKey])}</option>`).join('');

function showPage() {
  const selected = document.querySelector(`[data-page="${CSS.escape(location.hash.slice(1) || 'dashboard')}"]`) ? (location.hash.slice(1) || 'dashboard') : 'dashboard';
  document.querySelectorAll('.operasional-view').forEach((section) => { section.hidden = section.dataset.page !== selected; });
  document.querySelectorAll('.operasional-nav a').forEach((link) => {
    link.classList.toggle('active', link.dataset.view === selected);
    link.setAttribute('aria-current', link.dataset.view === selected ? 'page' : 'false');
  });
  $('#mobile-view').value = selected;
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', showPage);
$('#mobile-view').addEventListener('change', (event) => { location.hash = event.target.value; });
showPage();

function renderServices() {
  $('#operasional-services').innerHTML = state.services.map((item) => `<article class="operasional-service-card"><span class="operasional-service-icon" aria-hidden="true">${ikon(item.category === 'express' ? 'timer' : item.category === 'setrika' ? 'shirt' : 'washing-machine')}</span><h2>${safe(item.name)}</h2><p>${safe(item.description)}</p><div class="service-values"><div><span>Per kg</span><strong>${rupiah(item.price_kg)}</strong></div><div><span>Per item</span><strong>${rupiah(item.price_item)}</strong></div></div><p>${item.active ? 'Aktif' : 'Nonaktif'} · ${durasi(item.duration_minutes)}</p><button class="table-link" type="button" data-edit-service="${safe(item.id)}">Ubah layanan →</button></article>`).join('');
  $('#operasional-price-rows').innerHTML = state.services.map((item) => `<tr><th scope="row">${safe(item.name)}</th><td>${item.supported_units.includes('kg') ? rupiah(item.price_kg) : '—'}</td><td>${item.supported_units.includes('item') ? rupiah(item.price_item) : '—'}</td><td>${durasi(item.duration_minutes)}</td></tr>`).join('');
  document.querySelectorAll('#order-items [data-order-item]').forEach((row) => {
    const select = row.querySelector('.order-service-select');
    const current = select.value;
    select.innerHTML = selectOptions(state.services.filter((item) => item.active), 'Pilih layanan', 'id', 'name');
    if (state.services.some((item) => item.id === current && item.active)) select.value = current;
    updateUnits(row);
  });
}
async function loadServices() {
  state.services = []; renderServices(); info('#services-state', 'Memuat layanan dari Catalog API…');
  try {
    state.services = (await catalogRequest('/api/services?include_inactive=true')).services;
    renderServices(); info('#services-state', state.services.length ? '' : 'Belum ada layanan. Tambahkan melalui formulir di atas.');
  } catch (error) { fail('#services-state', error.message, loadServices); }
}
function resetServiceForm() {
  $('#service-form').reset(); $('#service-edit-id').value = ''; $('#service-form-title').textContent = 'Tambah layanan';
  $('#service-submit').textContent = 'Simpan layanan'; $('#service-cancel').hidden = true; clearError('#service-form-error');
}
$('#service-cancel').addEventListener('click', resetServiceForm);
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit-service]'); if (!button) return;
  const item = state.services.find((entry) => entry.id === button.dataset.editService); if (!item) return;
  $('#service-edit-id').value = item.id; $('#service-name').value = item.name; $('#service-category').value = item.category;
  $('#service-description').value = item.description; $('#service-price-kg').value = item.price_kg;
  $('#service-price-item').value = item.price_item; $('#service-duration').value = item.duration_minutes;
  $('#service-unit-kg').checked = item.supported_units.includes('kg'); $('#service-unit-item').checked = item.supported_units.includes('item');
  $('#service-active').checked = item.active; $('#service-form-title').textContent = 'Ubah layanan';
  $('#service-submit').textContent = 'Simpan perubahan'; $('#service-cancel').hidden = false;
  $('#service-form').scrollIntoView({ behavior: 'smooth' }); $('#service-name').focus();
});
$('#service-form').addEventListener('submit', async (event) => {
  event.preventDefault(); clearError('#service-form-error');
  const name = $('#service-name').value.trim(), category = $('#service-category').value.trim();
  const priceKg = intValue($('#service-price-kg')), priceItem = intValue($('#service-price-item')), duration = intValue($('#service-duration'));
  const units = ['kg', 'item'].filter((unit) => $(`#service-unit-${unit}`).checked);
  if (!name || !category || !priceKg || !priceItem || !duration || !units.length) return showError('#service-form-error', 'Isi nama, kategori, harga dan durasi positif, serta pilih minimal satu satuan.', !name ? $('#service-name') : undefined);
  const data = { name, category, description: $('#service-description').value.trim(), price_kg: priceKg, price_item: priceItem, duration_minutes: duration, supported_units: units, active: $('#service-active').checked };
  const id = $('#service-edit-id').value; const form = $('#service-form'); setBusy(form, true);
  try {
    await catalogRequest(id ? `/api/services/${encodeURIComponent(id)}` : '/api/services', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) });
    resetServiceForm(); await loadServices();
  } catch (error) { showError('#service-form-error', error.message); }
  finally { setBusy(form, false); }
});

function renderCustomers() {
  const query = $('#customer-search').value.trim().toLowerCase();
  const rows = state.customers.filter((item) => `${item.name} ${item.whatsapp}`.toLowerCase().includes(query));
  $('#customer-rows').innerHTML = rows.map((item) => `<tr><th scope="row">${safe(item.id.slice(0, 8))}</th><td>${safe(item.name)}</td><td>${safe(item.whatsapp)}</td><td><button class="table-link" type="button" data-edit-customer="${safe(item.id)}">Ubah →</button></td></tr>`).join('');
  $('#customer-count').textContent = `${rows.length} pelanggan`;
  $('#customer-empty').hidden = rows.length > 0;
  const current = $('#operasional-customer').value;
  $('#operasional-customer').innerHTML = selectOptions(state.customers, 'Pilih pelanggan', 'id', 'name');
  if (state.customers.some((item) => item.id === current)) $('#operasional-customer').value = current;
}
$('#customer-search').addEventListener('input', renderCustomers);
async function loadCustomers() {
  state.customers = []; renderCustomers(); info('#customers-state', 'Memuat pelanggan dari Order API…');
  try { state.customers = (await orderRequest('/api/customers')).customers; renderCustomers(); info('#customers-state', state.customers.length ? '' : 'Belum ada pelanggan. Tambahkan melalui formulir di atas.'); }
  catch (error) { fail('#customers-state', error.message, loadCustomers); }
}
function resetCustomerForm() {
  $('#customer-form').reset(); $('#customer-edit-id').value = ''; $('#customer-form-title').textContent = 'Tambah pelanggan';
  $('#customer-submit').textContent = 'Simpan pelanggan'; $('#customer-cancel').hidden = true; clearError('#customer-form-error');
}
$('#customer-cancel').addEventListener('click', resetCustomerForm);
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit-customer]'); if (!button) return;
  const item = state.customers.find((entry) => entry.id === button.dataset.editCustomer); if (!item) return;
  $('#customer-edit-id').value = item.id; $('#customer-name-pos').value = item.name; $('#customer-whatsapp').value = item.whatsapp;
  $('#customer-contact').value = item.additional_contact || ''; $('#customer-form-title').textContent = 'Ubah pelanggan';
  $('#customer-submit').textContent = 'Simpan perubahan'; $('#customer-cancel').hidden = false;
  $('#customer-form').scrollIntoView({ behavior: 'smooth' }); $('#customer-name-pos').focus();
});
$('#customer-form').addEventListener('submit', async (event) => {
  event.preventDefault(); clearError('#customer-form-error');
  const name = $('#customer-name-pos').value.trim(), whatsapp = $('#customer-whatsapp').value.trim();
  if (!name) return showError('#customer-form-error', 'Isi nama pelanggan.', $('#customer-name-pos'));
  if (!/^(?:\+62|62|0)8\d{8,12}$/.test(whatsapp.replace(/[\s().-]/g, ''))) return showError('#customer-form-error', 'Nomor WhatsApp harus nomor Indonesia yang valid, misalnya 081234567890.', $('#customer-whatsapp'));
  const data = { name, whatsapp, additional_contact: $('#customer-contact').value.trim() };
  const id = $('#customer-edit-id').value, form = $('#customer-form'); setBusy(form, true);
  try { await orderRequest(id ? `/api/customers/${encodeURIComponent(id)}` : '/api/customers', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) }); resetCustomerForm(); await loadCustomers(); }
  catch (error) { showError('#customer-form-error', error.message); }
  finally { setBusy(form, false); }
});

function updateUnits(row) {
  const service = state.services.find((item) => item.id === row.querySelector('.order-service-select').value);
  const unitSelect = row.querySelector('.order-unit-select');
  unitSelect.querySelectorAll('option').forEach((option) => { option.disabled = !!service && !service.supported_units.includes(option.value); });
  if (service && !service.supported_units.includes(unitSelect.value)) unitSelect.value = service.supported_units[0];
}
const orderItems = $('#order-items');
let nextItemId = 1;
orderItems.addEventListener('change', (event) => {
  const row = event.target.closest('[data-order-item]');
  if (!row) return;
  if (event.target.matches('.order-service-select')) updateUnits(row);
  if (event.target.matches('.order-unit-select')) row.querySelector('.order-quantity-input').value = '';
});
orderItems.addEventListener('click', (event) => {
  if (event.target.matches('.order-remove-item')) event.target.closest('[data-order-item]').remove();
});
$('#add-order-item').addEventListener('click', () => {
  if (orderItems.querySelectorAll('[data-order-item]').length >= 50) return;
  const row = orderItems.querySelector('[data-order-item]').cloneNode(true);
  const suffix = ++nextItemId;
  row.querySelectorAll('[id]').forEach((control) => {
    const label = row.querySelector(`label[for="${control.id}"]`);
    if (label) label.htmlFor = `${control.id}-${suffix}`;
    control.id = `${control.id}-${suffix}`;
  });
  row.querySelector('.order-service-select').value = '';
  row.querySelector('.order-unit-select').value = 'kg';
  row.querySelector('.order-quantity-input').value = '';
  row.querySelector('.order-remove-item').hidden = false;
  orderItems.appendChild(row);
  row.querySelector('.order-service-select').focus();
});
const freshClientId = () => { $('#client-order-id').value = crypto.randomUUID(); };
freshClientId();
$('#operasional-date').value = today(); $('#operasional-date').max = today();
function renderSummary(order) {
  state.lastSavedOrderId = order.id;
  $('#summary-customer').textContent = order.customer_name;
  $('#summary-service').textContent = order.items.map((item) => item.service_name).join(' + ');
  $('#summary-date').textContent = tanggal(order.ordered_at);
  $('#summary-quantity').textContent = order.items.map((item) => `${Number(item.quantity).toLocaleString('id-ID')} ${item.unit}`).join(' + ');
  $('#summary-unit-price').textContent = order.items.map((item) => `${rupiah(item.unit_price)}/${item.unit}`).join(' + ');
  $('#summary-estimate').textContent = tanggalWaktu(order.expected_completed_at);
  $('#summary-payment').textContent = label(order.payment_status);
  $('#summary-total').textContent = rupiah(order.total);
  $('#summary-empty').hidden = true; $('#summary-content').hidden = false; $('#summary-saved').hidden = false;
}
$('#operasional-order-form').addEventListener('submit', async (event) => {
  event.preventDefault(); clearError('#operasional-form-error');
  const customerId = $('#operasional-customer').value, discount = intValue($('#operasional-discount'), true);
  const date = $('#operasional-date').value;
  if (!customerId) return showError('#operasional-form-error', 'Pilih pelanggan. Tambahkan pelanggan terlebih dahulu bila daftar kosong.', $('#operasional-customer'));
  const items = [];
  for (const [index, row] of [...orderItems.querySelectorAll('[data-order-item]')].entries()) {
    const serviceField = row.querySelector('.order-service-select');
    const unit = row.querySelector('.order-unit-select').value;
    const quantityField = row.querySelector('.order-quantity-input');
    const quantity = quantityValue(quantityField, unit);
    if (!serviceField.value) return showError('#operasional-form-error', `Pilih layanan aktif untuk item ${index + 1}.`, serviceField);
    if (!quantity) return showError('#operasional-form-error', unit === 'kg'
      ? `Jumlah kg item ${index + 1} harus positif, maksimal tiga angka di belakang koma.`
      : `Jumlah item ${index + 1} harus bilangan bulat positif.`, quantityField);
    items.push({ service_id: serviceField.value, unit, quantity });
  }
  if (discount === null) return showError('#operasional-form-error', 'Diskon harus bilangan bulat nol atau lebih.', $('#operasional-discount'));
  if (!date || date > today()) return showError('#operasional-form-error', 'Tanggal masuk harus hari ini atau sebelumnya.', $('#operasional-date'));
  const data = { client_order_id: $('#client-order-id').value, customer_id: customerId, items, discount, note: $('#operasional-note').value.trim() };
  if (date < today()) data.ordered_at = `${date}T12:00:00+07:00`;
  const form = $('#operasional-order-form'); setBusy(form, true);
  try {
    const response = await orderRequest('/api/orders', payload(data));
    renderSummary(response.order);
    form.reset();
    orderItems.querySelectorAll('[data-order-item]:not(:first-child)').forEach((row) => row.remove());
    freshClientId();
    $('#operasional-date').value = today();
    updateUnits(orderItems.querySelector('[data-order-item]'));
    await Promise.all([loadOrders(), loadDashboard()]);
  } catch (error) { showError('#operasional-form-error', error.message); }
  finally { setBusy(form, false); }
});

const statusBadge = (status) => `<span class="status-badge ${safe(status)}">${safe(label(status))}</span>`;
const paymentBadge = (status) => `<span class="payment-badge ${status === 'lunas' ? 'paid' : 'unpaid'}">${safe(label(status))}</span>`;
function orderCells(order, compact) {
  const button = `<button type="button" class="table-link" data-order="${safe(order.id)}">Lihat detail →</button>`;
  const service = safe(order.item_summary || '—');
  if (compact) return `<tr><th scope="row">${safe(order.id.slice(0, 8))}</th><td>${safe(order.customer_name)}</td><td>${service}</td><td>${safe(order.quantity_summary || '—')}</td><td>${statusBadge(order.status)}</td><td>${button}</td></tr>`;
  return `<tr><th scope="row">${safe(order.id.slice(0, 8))}</th><td>${tanggal(order.ordered_at)}</td><td>${safe(order.customer_name)}</td><td>${service}</td><td>${rupiah(order.total)}</td><td>${statusBadge(order.status)}</td><td>${paymentBadge(order.payment_status)}</td><td>${button}</td></tr>`;
}
function renderOrders() {
  const query = $('#order-search').value.trim().toLowerCase(), filter = $('#order-filter').value;
  const rows = state.orders.filter((order) => (filter === 'all' || order.status === filter) && `${order.id} ${order.customer_name}`.toLowerCase().includes(query));
  $('#order-rows').innerHTML = rows.map((order) => orderCells(order, false)).join('');
  $('#order-empty').hidden = rows.length > 0;
  $('#dashboard-orders').innerHTML = state.orders.slice(0, 3).map((order) => orderCells(order, true)).join('');
  const current = $('#receipt-order').value;
  $('#receipt-order').innerHTML = selectOptions(state.orders, 'Pilih order', 'id', 'id');
  if (state.orders.some((order) => order.id === current)) $('#receipt-order').value = current;
  if (!$('#receipt-order').value) { state.receipt = null; $('#receipt-paper').innerHTML = ''; $('#print-receipt').disabled = true; info('#receipt-state', 'Pilih order untuk memuat struk.'); }
}
$('#order-search').addEventListener('input', renderOrders); $('#order-filter').addEventListener('change', renderOrders);
async function loadOrders() {
  state.orders = []; renderOrders(); info('#orders-state', 'Memuat order dari Order API…');
  try { state.orders = (await orderRequest('/api/orders')).orders; renderOrders(); info('#orders-state', state.orders.length ? '' : 'Belum ada order yang tersimpan.'); }
  catch (error) { fail('#orders-state', error.message, loadOrders); fail('#receipt-state', error.message, loadOrders); }
}
async function loadDashboard() {
  $('#metric-orders').textContent = '—'; $('#metric-paid').textContent = '—'; $('#metric-expenses').textContent = '—';
  try { const report = await orderRequest(`/api/reports/summary?from=${today()}&to=${today()}`);
    $('#metric-orders').textContent = report.orders.count; $('#metric-paid').textContent = rupiah(report.payments.total); $('#metric-expenses').textContent = rupiah(report.expenses.total);
    info('#dashboard-state', '');
  } catch (error) { $('#metric-orders').textContent = 'Gagal'; $('#metric-paid').textContent = 'Gagal'; $('#metric-expenses').textContent = 'Gagal'; fail('#dashboard-state', error.message, loadDashboard); }
}

const dialog = $('#order-dialog');
function detailRow(name, value) { return `<div class="dialog-detail"><span>${safe(name)}</span><span>${safe(value)}</span></div>`; }
function renderDetail(order) {
  state.selected = order; $('#dialog-id').textContent = `Order ${order.id.slice(0, 8)}`;
  const details = [['Tanggal masuk', tanggalWaktu(order.ordered_at)], ['Pelanggan', order.customer_name], ['WhatsApp', order.customer_whatsapp], ['Status pengerjaan', label(order.status)], ['Perkiraan selesai', tanggalWaktu(order.expected_completed_at)], ['Catatan', order.note || '—']];
  const items = order.items.map((item) => `${item.service_name} · ${Number(item.quantity).toLocaleString('id-ID')} ${item.unit} × ${rupiah(item.unit_price)} = ${rupiah(item.line_total)}`);
  const payments = order.payments.length ? order.payments.map((payment) => `${tanggal(payment.paid_at)} · ${label(payment.method)} · ${rupiah(payment.amount)}`) : ['Belum ada pembayaran'];
  $('#dialog-body').innerHTML = `<div class="dialog-section"><h3>Rincian order</h3>${details.map(([key, value]) => detailRow(key, value)).join('')}${items.map((item) => detailRow('Item', item)).join('')}${detailRow('Subtotal', rupiah(order.subtotal))}${detailRow('Diskon', rupiah(order.discount))}${detailRow('Total', rupiah(order.total))}</div><div class="dialog-section"><h3>Pembayaran · ${safe(label(order.payment_status))}</h3>${payments.map((item) => detailRow('Tercatat', item)).join('')}${detailRow('Sudah dibayar', rupiah(order.paid_amount))}${detailRow('Sisa', rupiah(order.total - order.paid_amount))}</div>`;
  $('#dialog-status').value = order.status;
  $('#payment-amount').max = order.total - order.paid_amount;
  $('#payment-amount').value = '';
  $('#payment-submit').disabled = order.total - order.paid_amount <= 0;
  info('#dialog-state', order.total - order.paid_amount <= 0 ? 'Order ini sudah lunas.' : '');
}
async function openOrder(id) {
  state.selected = null; $('#dialog-id').textContent = 'Memuat order…'; $('#dialog-body').innerHTML = '';
  info('#dialog-state', 'Memuat detail dari Order API…'); if (!dialog.open) dialog.showModal();
  try { renderDetail((await orderRequest(`/api/orders/${encodeURIComponent(id)}`)).order); }
  catch (error) { fail('#dialog-state', error.message, () => openOrder(id)); }
}
document.addEventListener('click', (event) => { const button = event.target.closest('[data-order]'); if (button) openOrder(button.dataset.order); });
$('#close-dialog').addEventListener('click', () => dialog.close()); $('#dialog-close-bottom').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
$('#status-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!state.selected) return; const form = $('#status-form'); setBusy(form, true);
  try { const response = await orderRequest(`/api/orders/${state.selected.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: $('#dialog-status').value }) }); renderDetail(response.order); if (state.lastSavedOrderId === response.order.id) renderSummary(response.order); await loadOrders(); if ($('#receipt-order').value === response.order.id) await loadReceipt(); }
  catch (error) { fail('#dialog-state', error.message, () => openOrder(state.selected.id)); }
  finally { setBusy(form, false); }
});
$('#payment-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (!state.selected) return; const amount = intValue($('#payment-amount'));
  if (!amount) return info('#dialog-state', 'Nominal pembayaran harus bilangan bulat positif.');
  if (amount > state.selected.total - state.selected.paid_amount) return info('#dialog-state', 'Nominal melebihi sisa pembayaran.');
  const form = $('#payment-form'); setBusy(form, true);
  try {
    const response = await orderRequest(`/api/orders/${state.selected.id}/payments`, payload({ amount, method: $('#payment-method').value }));
    renderDetail(response.order); if (state.lastSavedOrderId === response.order.id) renderSummary(response.order); await Promise.all([loadOrders(), loadDashboard(), loadReport()]); if ($('#receipt-order').value === response.order.id) await loadReceipt();
  } catch (error) { fail('#dialog-state', error.message, () => openOrder(state.selected.id)); }
  finally { setBusy(form, false); }
});
$('#dialog-receipt').addEventListener('click', () => { if (!state.selected) return; const id = state.selected.id; dialog.close(); location.hash = 'receipt'; $('#receipt-order').value = id; loadReceipt(); });

function renderExpenses() {
  $('#expense-rows').innerHTML = state.expenses.map((item) => `<tr><th scope="row">${safe(item.id.slice(0, 8))}</th><td>${tanggal(`${item.expense_date}T12:00:00+07:00`)}</td><td>${safe(item.category)}</td><td>${safe(item.description)}</td><td>${rupiah(item.amount)}</td></tr>`).join('');
}
async function loadExpenses() {
  state.expenses = []; renderExpenses(); info('#expenses-state', 'Memuat pengeluaran…');
  try { state.expenses = (await orderRequest('/api/expenses')).expenses; renderExpenses(); info('#expenses-state', state.expenses.length ? '' : 'Belum ada pengeluaran yang tercatat.'); }
  catch (error) { fail('#expenses-state', error.message, loadExpenses); }
}
$('#expense-date').value = today(); $('#expense-date').max = today();
$('#expense-form').addEventListener('submit', async (event) => {
  event.preventDefault(); clearError('#expense-form-error');
  const category = $('#expense-category').value.trim(), description = $('#expense-description').value.trim();
  const amount = intValue($('#expense-amount')), expenseDate = $('#expense-date').value;
  if (!category || !description || !amount || !expenseDate || expenseDate > today()) return showError('#expense-form-error', 'Isi kategori, keterangan, nominal positif, dan tanggal hari ini atau sebelumnya.');
  const form = $('#expense-form'); setBusy(form, true);
  try { await orderRequest('/api/expenses', payload({ category, description, amount, expense_date: expenseDate })); form.reset(); $('#expense-date').value = today(); await Promise.all([loadExpenses(), loadReport(), loadDashboard()]); }
  catch (error) { showError('#expense-form-error', error.message); }
  finally { setBusy(form, false); }
});
$('#report-from').value = `${today().slice(0, 8)}01`; $('#report-to').value = today();
async function loadReport() {
  const from = $('#report-from').value, to = $('#report-to').value;
  if (!from || !to || from > to) return info('#report-state', 'Pilih rentang tanggal yang valid.');
  $('#report-expenses').textContent = '—'; $('#report-payments').textContent = '—'; $('#report-balance').textContent = '—';
  info('#report-state', 'Memuat laporan dari Order API…');
  try { const report = await orderRequest(`/api/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    $('#report-expenses').textContent = rupiah(report.expenses.total); $('#report-payments').textContent = rupiah(report.payments.total); $('#report-balance').textContent = rupiah(report.net_cashflow); info('#report-state', `Laporan ${from} sampai ${to}: ${report.orders.count} order, ${report.expenses.count} pengeluaran.`);
  } catch (error) { fail('#report-state', error.message, loadReport); }
}
$('#report-form').addEventListener('submit', (event) => { event.preventDefault(); loadReport(); });

function receiptRow(name, value, className = '') { return `<div class="receipt-row ${className}"><span>${safe(name)}</span><span>${safe(value)}</span></div>`; }
function renderReceipt(receipt) {
  const order = receipt.order;
  $('#receipt-paper').innerHTML = `<div class="receipt-logo"><strong>${safe(receipt.business_name)}.</strong><span>STRUK ORDER TERSIMPAN</span></div><div class="receipt-title">RINCIAN ORDER</div>${receiptRow('No. order', order.id)}${receiptRow('Tanggal', tanggal(order.ordered_at))}${receiptRow('Pelanggan', order.customer_name)}${receiptRow('Status pengerjaan', label(order.status))}<div class="receipt-rule"></div>${order.items.map((item) => receiptRow(`${item.service_name} · ${Number(item.quantity).toLocaleString('id-ID')} ${item.unit} × ${rupiah(item.unit_price)}`, rupiah(item.line_total))).join('')}<div class="receipt-rule"></div>${receiptRow('Subtotal', rupiah(order.subtotal))}${receiptRow('Diskon', rupiah(order.discount))}${receiptRow('Total', rupiah(order.total), 'receipt-total')}${receiptRow('Dibayar', rupiah(order.paid_amount))}${receiptRow('Sisa', rupiah(order.total - order.paid_amount))}${receiptRow('Status pembayaran', label(order.payment_status))}<div class="receipt-rule"></div><div class="receipt-foot">Struk ini memuat data order dan pembayaran yang tersimpan.</div>`;
  $('#print-receipt').disabled = false;
}
async function loadReceipt() {
  const id = $('#receipt-order').value; state.receipt = null; $('#print-receipt').disabled = true; $('#receipt-paper').innerHTML = '';
  if (!id) return info('#receipt-state', 'Pilih order untuk memuat struk.');
  info('#receipt-state', 'Memuat struk dari Order API…');
  try { const response = await orderRequest(`/api/orders/${encodeURIComponent(id)}/receipt`); state.receipt = response.receipt; renderReceipt(response.receipt); info('#receipt-state', ''); }
  catch (error) { fail('#receipt-state', error.message, loadReceipt); }
}
$('#receipt-order').addEventListener('change', loadReceipt);
$('#print-receipt').addEventListener('click', () => { if (state.receipt) window.print(); });

pasangIkon();
await Promise.all([loadServices(), loadCustomers(), loadOrders(), loadExpenses(), loadReport(), loadDashboard()]);
