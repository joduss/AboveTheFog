const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const origin=process.env.MAP_URL||'http://127.0.0.1:5177';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'});
 try{
  for(const place of ['Zurich','Lugano','Fribourg','Zermatt']) {
   const context=await browser.newContext({viewport:{width:1100,height:850}});
   const remote=[],requests=[],errors=[];
   context.on('request',r=>{if(/\/stac\/|\.tif(?:\?|$)/.test(r.url()))remote.push(r.url());if(new URL(r.url()).pathname.startsWith('/terrain/'))requests.push(r.url());});
   await context.route(/\/stac\/|\.tif(?:\?|$)/,r=>r.abort());
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${origin}/?place=${place}&debugTiles`);
   const ready=()=>page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('· ready'),{},{timeout:20000});
   await ready();assert.equal(remote.length,0);
   assert.match(await page.getByRole('status').textContent(),/Prepared/);
   assert.equal(await page.locator('input[type=range]').getAttribute('step'),'10');
   assert.equal(await page.locator('#altitude').getAttribute('step'),'10');
   await page.waitForFunction(()=>{const d=JSON.parse(document.querySelector('.map').getAttribute('data-terrain-diagnostics'));return d.lookAhead===0&&d.pending.length===0;});
   const before=requests.length;
   await page.locator('#altitude').fill(place==='Zermatt'?'2500':'659');
   assert.equal(await page.locator('#altitude').inputValue(),place==='Zermatt'?'2500':'660');
   await page.getByRole('checkbox').uncheck();await page.getByRole('checkbox').check();await page.waitForTimeout(100);
   assert.equal(requests.length,before);
   await page.locator('.map').click({position:{x:360,y:350}});
   await page.waitForFunction(()=>document.querySelector('.map-footer').textContent.includes('Terrain band: ['));
   await page.screenshot({path:`test-results/prepared-verified-${place}.png`});
   await page.getByTitle('Zoom in',{exact:true}).click();await page.waitForTimeout(500);await ready();
   await page.getByTitle('Zoom in',{exact:true}).click();await page.waitForTimeout(500);await ready();
   const box=await page.locator('.map').boundingBox();await page.mouse.move(box.x+300,box.y+250);await page.mouse.down();await page.mouse.move(box.x+380,box.y+300,{steps:10});await page.mouse.up();await page.waitForTimeout(500);await ready();
   assert.equal(remote.length,0,'Prepared zoom and pan may not use source processing');
   await page.screenshot({path:`test-results/prepared-native-${place}.png`});
   await page.goto(`${origin}/?place=${place}&debugTiles`);await ready();
   await page.waitForFunction(()=>{const d=JSON.parse(document.querySelector('.map').getAttribute('data-terrain-diagnostics'));return d.lookAhead===0&&d.pending.length===0;});
   const count=requests.length;await page.reload();await ready();await page.waitForFunction(()=>{const d=JSON.parse(document.querySelector('.map').getAttribute('data-terrain-diagnostics'));return d.lookAhead===0&&d.pending.length===0;});assert.equal(requests.length,count,'Warm application cache should eliminate tile downloads');
   assert.deepEqual(errors,[]);await context.close();
  }
  // Failed prepared assets stay unavailable with dimming disabled, and retry recovers.
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage(),remote=[];
  context.on('request',r=>{if(/\/stac\/|\.tif(?:\?|$)/.test(r.url()))remote.push(r.url());});
  await page.route('**/terrain/**',r=>r.fulfill({status:503,body:'Unavailable'}));
  await page.goto(`${origin}/?place=Fribourg&debugTiles`);
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('contain unavailable'));
  await page.getByRole('checkbox').uncheck();
  assert.match(await page.getByRole('status').textContent(),/Prepared.*unavailable/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'test-results/prepared-phone-unavailable.png',fullPage:true});
  assert.equal(remote.length,0,'Failed prepared assets must not fall back to source elevation');
  await page.unroute('**/terrain/**');await page.getByRole('button',{name:'Retry elevation',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('· ready'));
  await page.screenshot({path:'test-results/prepared-phone-ready.png',fullPage:true});
  assert.equal(remote.length,0);await context.close();
  console.log('Prepared browser checks passed: nationwide detail, source-free loads, band probe, 10 m controls, zero threshold requests, pan/zoom, reload caching, phone layout, visible failures and retry.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
