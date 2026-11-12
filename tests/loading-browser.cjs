const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})});
 try{
  const context=await browser.newContext({viewport:{width:1100,height:850}});
  await context.addInitScript(()=>{
   window.tileJobs=[];
   window.Worker=class{
    postMessage(job){
     if(job.cancel){clearTimeout(this.timer);this.onmessage?.({data:{id:this.id,error:'Cancelled'}});return;}
     this.id=job.id;window.tileJobs.push(job);
     if(window.stallDetail && job.z>=15)return; // Simulate a decoder that never acknowledges cancellation.
     this.timer=setTimeout(()=>this.onmessage?.({data:{id:job.id,data:new Float32Array(65536).fill(job.z>=15?800:500),spacing:job.z>=15?2:80,missing:0,failures:0,bytes:0}}),job.z>=15?800:200);
    }
    terminate(){clearTimeout(this.timer);}
   };
  });
  const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=new URL(process.env.MAP_URL||'http://127.0.0.1:5176');url.searchParams.set('prepared','off');
  await page.goto(url.href);
  const ready=()=>page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('· ready'),{},{timeout:45000});
  const city=async name=>{
   await page.getByRole('combobox').selectOption({Fribourg:'FR',Zurich:'ZH',Geneva:'GE'}[name]);
   await page.waitForTimeout(100); // Let the fitted canton replace the previous detail status.
   for(let i=0;i<10;i++) {
    if((await page.getByRole('status').textContent()).includes('swissALTI3D'))return;
    await page.getByTitle('Zoom in',{exact:true}).click();await page.waitForTimeout(350);
   }
   throw Error('Canton zoom must reach detailed terrain');
  };
  await page.waitForFunction(()=>window.tileJobs.length>0);
  await page.getByTitle('Zoom in',{exact:true}).click();
  await ready();
  await page.getByRole('button',{name:'Switzerland ↗',exact:true}).click();await ready();
  await city('Fribourg');
  await page.waitForFunction(()=>/Approximate (?:preview|cached terrain) · refining/.test(document.querySelector('[role=status]').textContent));
  await page.screenshot({path:'test-results/loading-preview.png'});
  await ready();await page.screenshot({path:'test-results/loading-refined.png'});
  await page.getByTitle('Zoom out',{exact:true}).click();await page.waitForTimeout(500);await ready();
  await page.getByTitle('Zoom in',{exact:true}).click();await page.waitForTimeout(500);await ready();
  await page.waitForTimeout(500);
  await page.reload();await ready();await city('Fribourg');await ready();
  assert.equal(await page.evaluate(()=>window.tileJobs.filter(j=>j.z===15).length),0,'Reload should reuse persisted detail');
  await page.evaluate(()=>{window.stallDetail=true;window.tileJobs=[];});
  await city('Zurich');
  await page.waitForFunction(()=>window.tileJobs.filter(j=>j.z>=15).length>=2);
  await page.evaluate(()=>{window.stallDetail=false;});
  await city('Geneva');await ready();
  assert.deepEqual(errors,[]);
  console.log('Browser loading checks passed: preview, refinement, persistent reuse and location changes with stalled obsolete workers.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
