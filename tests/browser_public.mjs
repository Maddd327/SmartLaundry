import assert from 'node:assert/strict';
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const pub=process.env.PUBLIC_URL || 'http://127.0.0.1:8080', admin=process.env.ADMIN_URL || 'http://127.0.0.1:8081';
const before=(await (await fetch(admin+'/api/orders')).json()).orders.length;
assert.equal(before,0);
for (const [name,type] of [['Chromium',chromium],['Firefox',firefox],['WebKit',webkit]]) {
 const browser=await type.launch({headless:true});
 try {
  for (const width of [320,768,1440]) {
   const page=await browser.newPage({viewport:{width,height:900}});
   const errors=[]; page.on('pageerror',error=>errors.push(error.message));
   for (const [origin,path] of [[pub,'/'],[admin,'/operasional.html']]) {
    await page.goto(origin+path);
    await page.locator(path==='/' ? '#service option' : '#operasional-service option').nth(1).waitFor({state:'attached'});
    const result=await page.evaluate(() => ({overflow:document.documentElement.scrollWidth-innerWidth,unlabelled:[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(el=>!el.labels?.length&&!el.getAttribute('aria-label')).map(el=>el.id)}));
    assert.ok(result.overflow<=1,`${name} ${width} ${path}: overflow ${result.overflow}`);
    assert.deepEqual(result.unlabelled,[],`${name} ${width} ${path}: label`);
   }
   await page.goto(pub+'/');
   await page.locator('#service option').nth(2).waitFor({state:'attached'});
   const services=await page.locator('#service option').allTextContents();
   assert.deepEqual(services,['Cuci Setrika Regular','Express Wash','Setrika Saja']);
   const prices=await page.locator('#price-rows tr').allTextContents();
   assert.equal(prices.length,3);
   for(const price of ['Rp6.000','Rp18.000','Rp8.000','Rp25.000','Rp3.000','Rp5.000']) assert.ok(prices.join(' ').replace(/\s/g,'').includes(price),price);
   const writes=[]; page.on('request',req=>{if(req.url().includes('/api/requests')&&req.method()!=='GET') writes.push(req.url());});
   await page.locator('#service').selectOption('regular');
   await page.locator('#quantity').fill('2,5');
   assert.equal(Number((await page.locator('#estimated-price').innerText()).replace(/\D/g,'')),15000);
   await page.locator('#customer-name').fill('Ani & Budi');
   await page.locator('#phone').fill('+62 812-3456-7890');
   await page.locator('#notes').fill('Putih + biru #1');
   await page.locator('#booking-form button[type=submit]').click();
   assert.ok(await page.locator('#review-dialog').evaluate(el=>el.open));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=1), `${name} ${width}: review overflow`);
   for(const part of ['Ani & Budi','6281234567890','Cuci Setrika Regular','2,5 kg','Rp15.000','Putih + biru #1']) assert.ok((await page.locator('#review-details').innerText()).replace(/\s/g,'').includes(part.replace(/\s/g,'')),part);
   await page.locator('#review-back').click();
   await page.locator('#service').selectOption('express');
   await page.locator('#unit').selectOption('item');
   await page.locator('#quantity').fill('3');
   assert.equal(Number((await page.locator('#estimated-price').innerText()).replace(/\D/g,'')),75000);
   await page.locator('#booking-form button[type=submit]').click();
   for(const part of ['Express Wash','3 item','Rp75.000']) assert.ok((await page.locator('#review-details').innerText()).replace(/\s/g,'').includes(part.replace(/\s/g,'')),part);
   await page.locator('#review-back').click();
   assert.equal(writes.length,0);
   assert.deepEqual(errors,[]);
   console.log(`${name} ${width}px: public kg/item, review, labels, no overflow; admin initial render OK`);
   await page.close();
  }
 } finally {await browser.close();}
}
const after=(await (await fetch(admin+'/api/orders')).json()).orders.length;
assert.equal(after,before);
console.log('Review dibatalkan: zero orders created.');
