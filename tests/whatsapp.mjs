import assert from 'node:assert/strict';
import { normalizeWhatsappNumber, whatsappLink } from '../js/konfigurasi.js';

for (const raw of ['0812 3456-7890', '+62 812.3456.7890', '6281234567890']) {
  assert.equal(normalizeWhatsappNumber(raw), '6281234567890');
}
for (const raw of ['0812abc7890', '0812', '+6281234567890?x=1']) {
  assert.equal(normalizeWhatsappNumber(raw), null);
}
const message = 'Nama: Ani & Budi\nCatatan: putih + biru #1 / 2 kg 😊';
const link = new URL(whatsappLink(message));
assert.equal(link.origin, 'https://wa.me');
assert.equal(link.pathname, '/628213194417');
assert.equal(link.searchParams.get('text'), message);
assert.equal([...link.searchParams.keys()].length, 1);
console.log('WhatsApp normalization and message encoding: OK');
