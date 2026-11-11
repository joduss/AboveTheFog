const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto((process.env.MAP_URL||'http://127.0.0.1:5177')+'/?place=Fribourg&debugTiles');
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('· ready'));
  // Give look-ahead loads time to finish, then simulate slower incoming edge tiles.
  await page.waitForTimeout(500);
  await page.route('**/terrain/**',async r=>{await new Promise(resolve=>setTimeout(resolve,450));await r.continue();});
  const box=await page.locator('.map').boundingBox();
  let samples=0,amber=0;const sizes=[];
  const sample=async()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
   const map=document.querySelector('.map'),info=JSON.parse(map.getAttribute('data-terrain-diagnostics'));
   const canvas=document.querySelector('.terrain-availability canvas'),ctx=canvas.getContext('2d'),rect=canvas.getBoundingClientRect(),bounds=map.getBoundingClientRect();
   let samples=0,amber=0;
   const world=20037508.342789244;
   for(const key of info.ready) {
    const [z,x,y]=key.split('/').map(Number);if(z!==Math.min(16,Math.floor(info.zoom)))continue;
    const span=2*world/2**z,ex=-world+(x+.5)*span,ny=world-(y+.5)*span;
    const px=bounds.x+bounds.width/2+(ex-info.center[0])/info.resolution;
    const py=bounds.y+bounds.height/2-(ny-info.center[1])/info.resolution;
    if(px<bounds.x+10||px>bounds.right-10||py<bounds.y+10||py>bounds.bottom-10)continue;
    const col=Math.floor((px-rect.x)/rect.width*canvas.width),row=Math.floor((py-rect.y)/rect.height*canvas.height);
    if(col<0||row<0||col>=canvas.width||row>=canvas.height)continue;
    const pixel=ctx.getImageData(col,row,1,1).data;samples++;if(pixel[3]>20)amber++;
   }
   resolve({samples,amber,width:bounds.width,height:bounds.height});
  }))));
  for(const direction of [-1,1,-1,1]) {
   await page.mouse.move(box.x+box.width/2-direction*220,box.y+box.height/2);await page.mouse.down();
   for(let i=1;i<=24;i++) {
    await page.mouse.move(box.x+box.width/2-direction*220+direction*i*440/24,box.y+box.height/2);
    const row=await sample();samples+=row.samples;amber+=row.amber;sizes.push([row.width,row.height]);
   }
   await page.waitForTimeout(150);await page.mouse.up();await page.waitForTimeout(250);
  }
  assert(samples>100,'Must inspect resident terrain throughout real pointer drags');
  assert.equal(amber,0,'Availability overlay must never flash over already loaded terrain');
  assert(sizes.every(([w,h])=>w===sizes[0][0]&&h===sizes[0][1]),'Loading text must not resize the map');
  assert.deepEqual(errors,[]);
  console.log(`Navigation stability passed: ${samples} loaded-tile samples during repeated drags, zero amber flashes, constant viewport, delayed edge requests.`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
