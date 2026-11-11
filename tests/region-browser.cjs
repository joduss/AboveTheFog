const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
fs.mkdirSync('test-results',{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1400,height:950}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const requests=[];page.on('request',r=>{if(r.url().endsWith('.bin.gz'))requests.push(r.url());});
 await page.goto('http://127.0.0.1:5173');
 await page.getByRole('status').filter({hasText:'Fribourg ·'}).waitFor({timeout:60000});
 await page.waitForTimeout(4000);
 await page.waitForFunction(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('.bin.gz')),{},{timeout:30000});
 assert.match(await page.getByRole('status').innerText(),/Fribourg ·/);
 await page.screenshot({path:'test-results/fribourg-desktop.png'});
 const initial=requests.length;
 console.log({initial,errors,status:await page.getByRole('status').innerText()});
 assert(initial>0 && initial<100,'Only viewport elevation tiles should load');
 const timings=[];
 for(const value of ['0','600','650','700','800','2000']) {
   const t=Date.now();await page.getByRole('slider').fill(value);
   assert.equal(await page.getByRole('spinbutton').inputValue(),value);
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   timings.push(Date.now()-t);
 }
 await page.getByRole('spinbutton').fill('650');
 assert.equal(await page.getByRole('slider').inputValue(),'650');
 await page.getByRole('checkbox').uncheck();
 await page.screenshot({path:'test-results/fribourg-off.png'});
 await page.getByRole('checkbox').check();
 assert.equal(requests.length,initial,'Threshold/toggle changes must not fetch elevation');
 for(let i=0;i<4;i++) {await page.getByTitle('Zoom in').click();await page.waitForTimeout(500);}
 await page.getByRole('status').filter({hasText:'Fribourg ·'}).waitFor();
 await page.waitForTimeout(1000);
 assert(requests.length>initial,'Zoom must stream new detail');
 const rect=await page.locator('.map').boundingBox();
 await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
 await page.waitForTimeout(500);
 assert.match(await page.locator('.map-footer').innerText(),/Terrain:/);
 await page.screenshot({path:'test-results/fribourg-detail.png'});
 await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
 await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+200,rect.y+rect.height/2+80,{steps:10});await page.mouse.up();
 await page.waitForTimeout(1000);
 await page.getByRole('button',{name:'Fribourg area'}).click();
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(1500);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'test-results/fribourg-phone.png',fullPage:true});
 // Mixed success/failure must stay local; a bad tile must not appear clear.
 await page.route('**/*.bin.gz',route=>route.abort());
 await page.reload();
 await page.getByRole('status').filter({hasText:'unavailable'}).waitFor({timeout:60000});
 await page.screenshot({path:'test-results/fribourg-failed.png',fullPage:true});
 await page.getByRole('checkbox').uncheck();
 assert.match(await page.getByRole('status').innerText(),/unavailable/);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({initialTiles:initial,totalTileRequests:requests.length,inputToTwoFramesMs:timings,phoneOverflow:false,failedLoading:'passed',pageErrors:errors},null,2));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
