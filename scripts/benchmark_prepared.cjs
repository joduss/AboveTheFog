const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const origin=process.env.MAP_URL||'http://127.0.0.1:5176';
const executablePath=process.env.BROWSER_PATH||'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const elevation=url=>new URL(url).pathname.startsWith('/prepared/') || /\/stac\/|\.tif(?:\?|$)/.test(url);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath});
 const results=[];
 try{
  for(const place of ['Fribourg','Zermatt']) for(const mode of (process.env.MODES||'off,raster,vector').split(',')) {
   const context=await browser.newContext({viewport:{width:1100,height:850}});
   await context.addInitScript(()=>{
    window.bench={longTasks:[],first:null,complete:null};
    new PerformanceObserver(list=>window.bench.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});
    new MutationObserver(()=>{
     if(document.head&&!document.getElementById('benchmark-fixed-map')) {const style=document.createElement('style');style.id='benchmark-fixed-map';style.textContent='.map{height:751px!important;min-height:751px!important;max-height:751px!important;flex:none!important}';document.head.appendChild(style);}
     const text=document.querySelector('[role=status]')?.textContent||'';
     const ready=/· ready/.test(text);
     const diagnostics=document.querySelector('.map')?.getAttribute('data-terrain-diagnostics');
     const some=ready || (diagnostics && JSON.parse(diagnostics).loaded>0) || /Approximate preview/.test(text);
     if(some&&window.bench.first===null) requestAnimationFrame(()=>requestAnimationFrame(()=>{window.bench.first??=performance.now();}));
     if(ready&&window.bench.complete===null) requestAnimationFrame(()=>requestAnimationFrame(()=>{window.bench.complete??=performance.now();}));
    }).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-terrain-diagnostics']});
   });
   const page=await context.newPage(), cdp=await context.newCDPSession(page);
   await cdp.send('Network.enable');
   await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:20,downloadThroughput:6250000,uploadThroughput:6250000});
   let requests=[],transfer=0,decoded=0,ids=new Set(),errors=[];
   let responseJobs=[];
   context.on('request',r=>{if(elevation(r.url()))requests.push(r.url());});
   context.on('response',r=>{if(elevation(r.url())) responseJobs.push((async()=>{try {await r.finished();const sizes=await r.request().sizes();transfer+=sizes.responseBodySize;decoded+=Number(r.headers()['content-length']||0);}catch{}})());});
   page.on('pageerror',e=>errors.push(e.message));
   const url=`${origin}/?place=${place}&prepared=${mode === 'raster' ? 'pilot' : mode}&debugTiles`;
   for(const phase of ['cold-app-and-http','warm-http-cold-app','warm-app']) {
    if(phase==='warm-http-cold-app') await page.evaluate(async()=>{for(const k of await caches.keys())await caches.delete(k);});
    requests=[];transfer=0;decoded=0;ids=new Set();errors=[];responseJobs=[];
    const start=Date.now();
    await page.goto(url,{waitUntil:'domcontentloaded'});
    let timeout=false;
    try{await page.waitForFunction(()=>window.bench?.complete!==null,{},{timeout:90000});}catch{timeout=true;}
    await page.waitForTimeout(150);
    const info=await page.evaluate(()=>({...window.bench,status:document.querySelector('[role=status]').textContent,size:document.querySelector('.map').getBoundingClientRect().toJSON(),heap:performance.memory?.usedJSHeapSize,diagnostics:JSON.parse(document.querySelector('.map').getAttribute('data-terrain-diagnostics'))}));
    await Promise.allSettled(responseJobs);
    const before=requests.length;
    const interactions=[];
    for(const altitude of (place==='Zermatt'?[2000,2500,3000,2510]:[500,650,800,660])) {
     interactions.push(await page.evaluate(value=>new Promise(resolve=>{
      const input=document.querySelector('input[type=range]');const start=performance.now();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-start)));
     }),altitude));
    }
    await page.waitForTimeout(200);
    const row={place,mode,phase,...info,requests:before,transferredBytes:transfer,decodedBodyBytes:decoded,stacRequests:requests.filter(u=>u.includes('/stac/')).length,tiffRequests:requests.filter(u=>u.includes('.tif')).length,preparedRequests:requests.filter(u=>u.includes('/prepared/')).length,thresholdRequests:requests.length-before,interactionTwoRafMs:interactions,errors,timeout,wallMs:Date.now()-start};
    results.push(row);console.log(JSON.stringify(row));
    await page.screenshot({path:`test-results/prepared-${place}-${mode}-${phase}.png`});
   }
   // Same one-level zoom interaction on the loaded dataset.
   const before=requests.length,start=Date.now();
   await page.getByTitle('Zoom in',{exact:true}).click();
   await page.waitForTimeout(400);
   try{await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('· ready'),{},{timeout:90000});}catch{}
   results.push({place,mode,interaction:'zoom15-to16',wallMs:Date.now()-start,requests:requests.length-before});
   await context.close();
  }
 }finally{fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/prepared-benchmark.json',JSON.stringify({browser:browser.version(),viewport:{width:1100,height:850},connection:{latencyMs:20,downloadBytesPerSecond:6250000},results},null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
