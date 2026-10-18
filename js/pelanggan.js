import { catalogRequest } from './api.js';
import { rupiah, durasi, tanggalInput, escapeHtml } from './format.js';
import { normalizeWhatsappNumber, whatsappLink } from './konfigurasi.js';
import { ikon, pasangIkon } from './ikon.js';

const $ = (selector) => document.querySelector(selector);
const bookingForm = $('#booking-form');
const serviceSelect = $('#service');
const unitSelect = $('#unit');
const quantityInput = $('#quantity');
const dateInput = $('#date');
const error = $('#form-error');
let services = [];

function serviceIcon(service) {
  if (service.category === 'express') return 'timer';
  if (service.category === 'setrika') return 'shirt';
  return 'washing-machine';
}

function serviceLabel(service) {
  if (service.category === 'express') return 'Untuk jadwal padat';
  if (service.category === 'setrika') return 'Rapikan pakaian';
  return 'Perawatan harian';
}

function renderServices() {
  const cards = $('#service-cards');
  cards.innerHTML = services.map((service, index) => `
    <article class="service-card ${index === 1 ? 'featured' : ''}">
      <div class="service-card-top"><span class="service-index">${String(index + 1).padStart(2, '0')}</span><span class="service-icon" aria-hidden="true">${ikon(serviceIcon(service))}</span></div>
      <div class="service-card-main"><span class="service-overline">${serviceLabel(service)}</span><h3>${escapeHtml(service.name)}</h3><p>${escapeHtml(service.description)}</p></div>
      <div class="service-card-bottom"><span class="service-estimate">${ikon('timer')} ${durasi(service.duration_minutes)}</span><strong>${service.supported_units.includes('kg') ? rupiah(service.price_kg) : rupiah(service.price_item)} <small>/ ${service.supported_units.includes('kg') ? 'kg' : 'item'}</small></strong></div>
      <a href="#pesan" class="service-arrow" data-service="${escapeHtml(service.id)}" aria-label="Pilih ${escapeHtml(service.name)}">Pilih Layanan ${ikon('arrow-up-right')}</a>
    </article>`).join('');
  $('#price-rows').innerHTML = services.map((service) => `
    <tr><th scope="row">${escapeHtml(service.name)}</th><td>${service.supported_units.includes('kg') ? rupiah(service.price_kg) : '—'}</td><td>${service.supported_units.includes('item') ? rupiah(service.price_item) : '—'}</td><td>${durasi(service.duration_minutes)}</td></tr>`).join('');
  serviceSelect.innerHTML = services.map((service) => `<option value="${escapeHtml(service.id)}">${escapeHtml(service.name)}</option>`).join('');
  serviceSelect.disabled = services.length === 0;
  bookingForm.querySelector('button[type="submit"]').disabled = services.length === 0;
  syncUnits();
  cards.querySelectorAll('[data-service]').forEach((link) => link.addEventListener('click', () => {
    serviceSelect.value = link.dataset.service;
    syncUnits();
    updateEstimate();
  }));
  updateEstimate();
}

async function loadServices() {
  const state = $('#public-services-state');
  state.className = 'api-state';
  state.textContent = 'Memuat layanan dan harga dari Catalog API…';
  services = [];
  renderServices();
  try {
    const data = await catalogRequest('/api/services');
    services = data.services;
    renderServices();
    state.textContent = services.length ? '' : 'Belum ada layanan aktif. Pemesanan belum tersedia.';
    state.hidden = services.length > 0;
  } catch (requestError) {
    state.hidden = false;
    state.className = 'api-state error';
    state.innerHTML = `<span>${escapeHtml(requestError.message)}</span> <button type="button" id="retry-public-services">Coba lagi</button>`;
    $('#retry-public-services').addEventListener('click', loadServices);
  }
}

$('#contact-whatsapp').href = whatsappLink('Halo Laundry Mr Andy, saya ingin bertanya tentang layanan laundry.');
const menuButton = $('.menu-toggle');
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Tutup menu' : 'Buka menu');
  $('#main-nav').classList.toggle('is-open', open);
});
document.querySelectorAll('.main-nav a').forEach((link) => link.addEventListener('click', () => {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Buka menu');
  $('#main-nav').classList.remove('is-open');
}));

const today = new Date();
const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
dateInput.min = localToday;
dateInput.value = localToday;

function parsedQuantity() {
  const raw = quantityInput.value.trim();
  const pattern = unitSelect.value === 'kg' ? /^(?:\d+(?:[.,]\d{1,3})?|[.,]\d{1,3})$/ : /^\d+$/;
  if (!pattern.test(raw)) return null;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function syncUnits() {
  const service = services.find((item) => item.id === serviceSelect.value);
  unitSelect.querySelectorAll('option').forEach((option) => { option.disabled = !!service && !service.supported_units.includes(option.value); });
  if (service && !service.supported_units.includes(unitSelect.value)) unitSelect.value = service.supported_units[0];
}

function updateEstimate() {
  const unit = unitSelect.value;
  const service = services.find((item) => item.id === serviceSelect.value);
  const quantity = parsedQuantity();
  $('#quantity-suffix').textContent = unit;
  $('#quantity-help').textContent = unit === 'kg'
    ? 'Boleh memakai angka pecahan positif hingga tiga desimal, misalnya 2,5 kg.'
    : 'Isi bilangan bulat positif, misalnya 2 item.';
  $('#estimated-price').textContent = service && quantity
    ? rupiah(Math.round((unit === 'kg' ? service.price_kg : service.price_item) * quantity)) : '—';
  $('#estimate-description').textContent = service && quantity
    ? `${quantity.toLocaleString('id-ID')} ${unit} × ${rupiah(unit === 'kg' ? service.price_kg : service.price_item)} · Estimasi ${durasi(service.duration_minutes)}`
    : 'Pilih layanan dan isi jumlah untuk melihat estimasi.';
}
serviceSelect.addEventListener('change', () => { syncUnits(); updateEstimate(); });
unitSelect.addEventListener('change', () => { quantityInput.value = ''; updateEstimate(); });
quantityInput.addEventListener('input', updateEstimate);

function showError(message, field) {
  error.textContent = message;
  error.hidden = false;
  field?.focus();
}

bookingForm.addEventListener('submit', (event) => {
  event.preventDefault();
  error.hidden = true;
  const service = services.find((item) => item.id === serviceSelect.value);
  const quantity = parsedQuantity();
  const name = $('#customer-name').value.trim();
  const phone = $('#phone').value.trim();
  const normalizedPhone = normalizeWhatsappNumber(phone);
  const notes = $('#notes').value.trim();
  if (!service) return showError('Layanan belum tersedia. Coba muat ulang katalog.', serviceSelect);
  if (!service.supported_units.includes(unitSelect.value)) return showError('Satuan ini tidak didukung layanan.', unitSelect);
  if (!quantity) return showError(unitSelect.value === 'kg'
    ? 'Jumlah kg harus angka positif dengan maksimal tiga desimal.'
    : 'Jumlah item harus bilangan bulat positif.', quantityInput);
  if (!dateInput.value || dateInput.value < localToday) return showError('Pilih tanggal hari ini atau sesudahnya.', dateInput);
  if (!name) return showError('Isi nama Anda.', $('#customer-name'));
  if (!normalizedPhone) return showError('Masukkan nomor WhatsApp Indonesia yang valid, misalnya 081234567890.', $('#phone'));
  const estimate = Math.round(quantity * (unitSelect.value === 'kg' ? service.price_kg : service.price_item));
  const message = [
    'Halo Laundry Mr Andy, saya ingin menanyakan pesanan laundry:', '',
    `Nama: ${name}`, `Nomor WhatsApp: ${normalizedPhone}`, `Layanan: ${service.name}`,
    `Perhitungan: ${unitSelect.value === 'kg' ? 'Kilogram (kg)' : 'Satuan (item)'}`,
    `Jumlah: ${quantity.toLocaleString('id-ID')} ${unitSelect.value}`,
    `Tanggal yang diinginkan: ${tanggalInput(dateInput.value)}`,
    `Estimasi pengerjaan: ${durasi(service.duration_minutes)}`,
    `Harga acuan: ${rupiah(unitSelect.value === 'kg' ? service.price_kg : service.price_item)} per ${unitSelect.value}`,
    `Estimasi harga acuan: ${rupiah(estimate)}`, `Catatan: ${notes || '-'}`, '',
    'Mohon konfirmasi harga akhir, jadwal, dan cara pembayarannya. Terima kasih.',
  ].join('\n');
  window.open(whatsappLink(message), '_blank', 'noopener,noreferrer');
});

pasangIkon();
loadServices();
