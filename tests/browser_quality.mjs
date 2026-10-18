import assert from 'node:assert/strict';
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const pub=process.env.PUBLIC_URL || 'http://127.0.0.1:8080',admin=process.env.ADMIN_URL || 'http://127.0.0.1:8081';
for(const [name,type] of [['Chromium',chromium],['Firefox',firefox],['WebKit',webkit]]){
 const browser=await type.launch({headless:true});
 try{
  for(const width of [320,375,768,1440]){
   const page=await browser.newPage({viewport:{width,height:900}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(pub+'/');
   await page.locator('#service option').nth(1).waitFor({state:'attached'});
   let overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
   assert.ok(overflow<=1,`${name} ${width} public overflow ${overflow}`);
   if(width<=375){
    await page.locator('.menu-toggle').click();
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'true');
    await page.locator('.main-nav a').first().click();
    assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'),'false');
   }
   await page.goto(admin+'/operasional.html#new-order');
   await page.locator('#operasional-service option').nth(1).waitFor({state:'attached'});
   await page.locator('#add-order-item').click();
   const labels=await page.locator('#order-items input,#order-items select').evaluateAll(nodes=>nodes.map(el=>({id:el.id,count:el.labels?.length||0})));
   assert.ok(labels.every(x=>x.count===1),`${name} ${width}: item labels ${JSON.stringify(labels)}`);
   assert.equal(new Set(labels.map(x=>x.id)).size,labels.length);
   for(const hash of ['dashboard','services','customers','new-order','orders','expenses','receipt']){
    await page.goto(admin+'/operasional.html#'+hash);
    await page.locator('#operasional-service option').nth(1).waitFor({state:'attached'});
    overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
    assert.ok(overflow<=1,`${name} ${width} ${hash} overflow ${overflow}`);
   }
   assert.deepEqual(errors,[],`${name} ${width} JS errors`);
   console.log(`${name} ${width}px: all public/admin views, labels, navigation, overflow OK`);
   await page.close();
  }
 } finally{await browser.close();}
}
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:375,height:812}});
 await page.route('**/api/services',route=>route.request().method()==='GET'?route.abort():route.continue());
 await page.goto(pub+'/');
 await page.locator('#retry-public-services').waitFor();
 assert.equal(await page.locator('#service option').count(),0);
 await page.unroute('**/api/services');
 await page.locator('#retry-public-services').click();
 await page.locator('#service option').nth(2).waitFor({state:'attached'});
 console.log('Public API error + retry OK');
 await page.route('**/api/orders',route=>route.request().method()==='GET'?route.abort():route.continue());
 await page.goto(admin+'/operasional.html#orders');
 await page.locator('#orders-state button').waitFor();
 assert.equal(await page.locator('#order-rows tr').count(),0);
 await page.unroute('**/api/orders');
 await page.locator('#orders-state button').click();
 await page.locator('#order-rows tr').first().waitFor({state:'attached'});
 console.log('POS API error + retry OK');
 await page.locator('#order-rows [data-order]').first().click();
 await page.locator('#dialog-body .dialog-detail').first().waitFor();
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#order-dialog').evaluate(el=>el.open),false);
 await page.keyboard.press('Tab');
 const focus=await page.evaluate(()=>({tag:document.activeElement.tagName,outline:getComputedStyle(document.activeElement).outlineStyle}));
 assert.notEqual(focus.tag,'BODY');
 assert.notEqual(focus.outline,'none');
 console.log('Keyboard focus, dialog Escape, focus indicator OK');
} finally{await browser.close();}
