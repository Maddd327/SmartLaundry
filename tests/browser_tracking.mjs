import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const publicUrl = process.env.PUBLIC_URL || 'http://127.0.0.1:8080';
const { firstId } = JSON.parse(readFileSync(new URL('./.e2e-state.json', import.meta.url)));

const response = await fetch(`${publicUrl}/api/track?code=${encodeURIComponent(firstId)}`);
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store');
const tracking = (await response.json()).tracking;
assert.deepEqual(Object.keys(tracking).sort(), [
  'code', 'expected_completed_at', 'status', 'status_label', 'updated_at',
].sort());
assert.equal(tracking.code, firstId);
assert.equal(tracking.status_label, 'Selesai');
assert.equal((await fetch(`${publicUrl}/api/track?code=invalid`)).status, 422);
assert.equal((await fetch(`${publicUrl}/api/track?code=00000000-0000-4000-8000-000000000000`)).status, 404);
assert.equal((await fetch(`${publicUrl}/api/track`, { method: 'POST' })).status, 405);
assert.equal((await fetch(`${publicUrl}/api/orders`)).status, 404);

for (const [name, type] of [['Chromium', chromium], ['Firefox', firefox], ['WebKit', webkit]]) {
  const browser = await type.launch({ headless: true });
  try {
    for (const width of [320, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${publicUrl}/#lacak`);
      await page.locator('#tracking-code').fill('salah');
      await page.locator('#tracking-submit').click();
      assert.ok((await page.locator('#tracking-state').innerText()).includes('seluruh kode'));
      assert.equal(await page.locator('#tracking-code').evaluate((element) => element === document.activeElement), true);
      await page.locator('#tracking-code').fill(firstId);
      await page.locator('#tracking-submit').click();
      await page.locator('#tracking-result').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#tracking-result-code').innerText(), firstId);
      assert.equal(await page.locator('#tracking-result-status').innerText(), 'Selesai');
      assert.ok(await page.locator('#tracking-result-estimate').innerText());
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, `${name} ${width}px: overflow ${overflow}`);
      assert.deepEqual(errors, []);
      console.log(`${name} ${width}px: lacak order dari database, validasi dan tampilan OK`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
