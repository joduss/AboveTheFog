const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const url=process.env.MAP_URL||'http://127.0.0.1:5177';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'});
 const report={browser:browser.version(),runs:[]};
 try{
  const context=await browser.newContext({viewport:{width:1100,height:850}}),page=await context.newPage();
  let requests=[];context.on('request',r=>{if(/\/stac\/|\.tif(?:\?|$)|\/terrain\//.test(r.url()))requests.push(r.url());});
  const ready=()=>page.waitForFunction(()=>{const text=document.querySelector('[role=status]')?.textContent||'';return !text.includes('loading')&&!text.includes('updating view')&&(text.includes('ready')||text.includes('contain unavailable'));},{},{timeout:60000});
  await page.goto(`${url}/?place=Fribourg&debugTiles`);await ready();
  await page.waitForTimeout(200);
  const box=await page.locator('.map').boundingBox();
  for(const [name,dx,dy] of [['small-east',-170,0],['further-east',-450,0],['further-north',0,350],['further-west',450,0]]) {
   const before=requests.length,start=Date.now();
   await page.mouse.move(box.x+box.width/2-dx/2,box.y+box.height/2-dy/2);
   await page.mouse.down();
   for(let i=1;i<=15;i++) {await page.mouse.move(box.x+box.width/2-dx/2+dx*i/15,box.y+box.height/2-dy/2+dy*i/15);await page.waitForTimeout(20);}
   // Release after a pause so this test measures loading, not kinetic distance.
   await page.waitForTimeout(200);await page.mouse.up();
   let timeout=false;try{await ready();}catch{timeout=true;}
   const row={name,ms:Date.now()-start,requests:requests.length-before,tiffRequests:requests.slice(before).filter(u=>u.includes('.tif')).length,stacRequests:requests.slice(before).filter(u=>u.includes('/stac/')).length,status:await page.getByRole('status').textContent(),timeout};
   report.runs.push(row);console.log(JSON.stringify(row));
   await page.screenshot({path:`test-results/navigation-${name}.png`});
  }
  fs.writeFileSync(process.env.REPORT_PATH||'test-results/navigation.json',JSON.stringify(report,null,2));
  if(process.env.ASSERT_FAST==='1') {assert(report.runs.every(r=>!r.timeout&&r.tiffRequests===0&&r.stacRequests===0),'Local navigation must stay on prepared assets');assert(report.runs.every(r=>r.ms<2500),'Local pans must settle promptly');}
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
