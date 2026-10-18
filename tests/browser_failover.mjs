import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = process.env.ADMIN_URL || 'http://127.0.0.1:8081';
if (process.env.E2E_ALLOW_WRITES !== '1') {
  throw new Error('Set E2E_ALLOW_WRITES=1 hanya untuk database uji terpisah.');
}
if (!['127.0.0.1', 'localhost'].includes(new URL(admin).hostname)) {
  throw new Error('Browser write test hanya untuk host lokal.');
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { customerId } = JSON.parse(readFileSync(new URL('./.e2e-state.json', import.meta.url)));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const seen = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/orders')) {
      seen.push({
        method: response.request().method(),
        instance: response.headers()['x-instance-id'],
        status: response.status(),
      });
    }
  });

  await page.goto(`${admin}/operasional.html#new-order`);
  await page.locator('#operasional-service option').nth(1).waitFor({ state: 'attached' });
  await page.locator('#operasional-customer').selectOption(customerId);
  await page.locator('#operasional-service').selectOption('iron');
  await page.locator('#operasional-unit').selectOption('kg');
  await page.locator('#operasional-quantity').fill('1');
  await page.locator('#operasional-order-form button[type=submit]').click();
  await page.locator('#summary-content').waitFor({ state: 'visible' });
  const total = Number((await page.locator('#summary-total').innerText()).replace(/\D/g, ''));
  assert.equal(total, 3000);

  await page.goto(`${admin}/operasional.html#orders`);
  await page.locator('#order-rows tr').first().waitFor();
  assert.ok(seen.some((entry) => entry.method === 'POST' && entry.instance === 'order-api-b' && entry.status === 201), JSON.stringify(seen));
  assert.ok(seen.some((entry) => entry.method === 'GET' && entry.instance === 'order-api-b' && entry.status === 200), JSON.stringify(seen));
  console.log('POS UI via B: create and read succeeded; X-Instance-ID order-api-b.');
} finally {
  await browser.close();
}
