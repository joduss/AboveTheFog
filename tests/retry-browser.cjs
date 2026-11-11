const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 try{
  for(const mode of ['request','partial','nodata','persistent']) {
   const context=await browser.newContext({viewport:{width:1100,height:850}});
   await context.addInitScript(mode=>{
    window.tileAttempts={};
    window.Worker=class{
     postMessage(job){
      const key=`${job.z}/${job.x}/${job.y}`, attempt=window.tileAttempts[key]=(window.tileAttempts[key]||0)+1;
      this.timer=setTimeout(()=>{
       if(mode==='persistent'||(mode==='request'&&attempt===1))this.onmessage?.({data:{id:job.id,error:'Range request failed (503)'}});
       else {
        const missing=mode==='nodata'||(mode==='partial'&&attempt===1);
        const data=new Float32Array(65536).fill(500);if(missing)data[0]=-99999;
        this.onmessage?.({data:{id:job.id,data,spacing:80,missing:missing?1:0,failures:mode==='partial'&&attempt===1?1:0,bytes:0}});
       }
      },20);
     }
     terminate(){clearTimeout(this.timer);}
    };
   },mode);
   const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
   const url=new URL(process.env.MAP_URL||'http://127.0.0.1:5176');
   url.search='?place=Zurich&zoom=14&prepared=off&debugTiles';
   await page.goto(url.href);
   await page.waitForFunction(mode=>{
    const text=document.querySelector('[role=status]')?.textContent||'';
    return mode==='nodata'||mode==='persistent'?text.includes('contain unavailable data')&&!text.includes('loading'):text.includes('· ready');
   },mode,{timeout:30000});
   const info=await page.locator('.map').getAttribute('data-terrain-diagnostics');
   const ready=JSON.parse(info).ready.filter(key=>key.startsWith('14/'));
   assert(ready.length>0);
   const counts=await page.evaluate(keys=>keys.map(key=>window.tileAttempts[key]),ready);
   assert(counts.every(n=>n===(mode==='nodata'?1:mode==='persistent'?4:2)),`${mode}: ${counts}`);
   if(mode==='request'||mode==='partial')assert.deepEqual(JSON.parse(info).failed,[]);
   assert.deepEqual(errors,[]);
   await context.close();
  }
  console.log('Browser recovery passed: failed overview requests and partial tiles recover automatically; genuine nodata is not retried; persistent failures stop after four attempts.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
