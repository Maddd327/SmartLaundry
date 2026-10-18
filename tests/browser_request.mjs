import assert from 'node:assert/strict';

if (process.env.E2E_ALLOW_WRITES !== '1') throw new Error('Set E2E_ALLOW_WRITES=1 hanya untuk database uji.');

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const pub = process.env.PUBLIC_URL || 'http://127.0.0.1:8080';
const admin = process.env.ADMIN_URL || 'http://127.0.0.1:8081';
const browser = await chromium.launch({ headless: true });
try {
  const adminPage = await browser.newPage();
  await adminPage.goto(admin + '/operasional.html#orders');
  await adminPage.locator('#order-rows').waitFor();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(pub + '/');
  await page.locator('#service option').nth(2).waitFor({ state: 'attached' });
  await page.locator('#service').selectOption('regular');
  await page.locator('#quantity').fill('2,5');
  await page.locator('#customer-name').fill('Pelanggan Website Uji');
  await page.locator('#phone').fill('081234567811');
  await page.locator('#notes').fill('Pisahkan pakaian warna');
  await page.locator('#booking-form button[type=submit]').click();
  assert.equal(await page.locator('#review-dialog').evaluate(el => el.open), true);
  await page.locator('#review-confirm').click();
  await page.locator('#request-code').getByText(/^[0-9a-f-]{36}$/).waitFor();
  const code = await page.locator('#request-code').innerText();
  assert.equal(await page.locator('#request-total').innerText(), 'Rp15.000');
  assert.equal(await page.locator('#request-status').innerText(), 'Menunggu konfirmasi');
  const wa = new URL(await page.locator('#request-whatsapp').getAttribute('href'));
  assert.equal(wa.pathname, '/628213194417');
  const message = wa.searchParams.get('text');
  for (const part of [code, 'Pelanggan Website Uji', '6281234567811', 'Cuci Setrika Regular', '2,5 kg', 'Rp15.000', 'Pisahkan pakaian warna']) {
    assert.ok(message.replace(/\s/g, '').includes(part.replace(/\s/g, '')), part);
  }
  await page.locator('#tracking-form button[type=submit]').click();
  await page.locator('#tracking-result-status').getByText('Menunggu konfirmasi').waitFor();
  await adminPage.locator('#order-rows').getByText('Pelanggan Website Uji').waitFor({ timeout: 25000 });
  await adminPage.locator('#order-rows tr').filter({ hasText: 'Pelanggan Website Uji' }).locator('[data-order]').click();
  await adminPage.locator('#dialog-body').getByText(code).waitFor();
  assert.equal(await adminPage.locator('#payment-submit').isDisabled(), true);
  await adminPage.locator('#status-form button[type=submit]').click();
  await adminPage.locator('#dialog-body').getByText('Antre', { exact: true }).waitFor();
  assert.equal(await adminPage.locator('#payment-submit').isDisabled(), false);
  await adminPage.locator('#close-dialog').click();
  await adminPage.goto(admin + '/operasional.html#customers');
  await adminPage.locator('#customer-rows').getByText('6281234567811').waitFor();
  await page.locator('#tracking-form button[type=submit]').click();
  await page.locator('#tracking-result-status').getByText('Antre').waitFor();
  console.log(`Permintaan publik tersimpan, kode ${code}, WA siap kirim, pelanggan/order terlihat di admin, konfirmasi dan lacak berhasil.`);
} finally {
  await browser.close();
}
