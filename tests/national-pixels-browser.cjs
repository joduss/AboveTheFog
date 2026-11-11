// Validate resident shader pixels across equality and a known NoData boundary.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {execFileSync}=require('node:child_process');
const {resolve}=require('node:path');
const origin=process.env.MAP_URL || 'http://127.0.0.1:5240/AboveTheFog/';
const root=process.env.DATA_ROOT || process.cwd();
const python=process.env.TERRAIN_PYTHON || resolve('.prep-env/bin/python');
const world=20037508.342789244;
const project=(lon,lat)=>[world*lon/180,world/Math.PI*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))];

async function position(page,coord) {
  const map=page.locator('.map'),box=await map.boundingBox();
  const middle=[box.x+box.width/2,box.y+box.height/2];
  for(let i=0;i<12;i++) {
    const view=await map.evaluate(m=>JSON.parse(m.dataset.terrainDiagnostics));
    const dx=(view.center[0]-coord[0])/view.resolution;
    const dy=(coord[1]-view.center[1])/view.resolution;
    if(Math.abs(dx)<box.width*.35 && Math.abs(dy)<box.height*.35) return;
    const ratio=Math.min(1,box.width*.38/Math.max(1,Math.abs(dx)),box.height*.38/Math.max(1,Math.abs(dy)));
    await page.mouse.move(...middle);
    await page.mouse.down();
    await page.mouse.move(middle[0]+dx*ratio,middle[1]+dy*ratio,{steps:8});
    await page.waitForTimeout(180);
    await page.mouse.up();
  }
  throw Error('Could not reach reference coordinate');
}

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH ||
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'});
  try {
    for(const [place,zoom,lon,lat,missing] of [
      ['Fribourg',16,7.1619,46.8065,false],
      ['Geneva',13,6.2528797654,46.3110551405,true],
    ]) {
      const page=await browser.newPage({viewport:{width:1100,height:850}});
      const url=new URL(origin);
      url.search=new URLSearchParams({place,zoom:String(zoom),debugTiles:''});
      await page.goto(url.href);
      await page.waitForSelector('.map[data-terrain-diagnostics]');
      const coord=project(lon,lat);
      const span=2*world/(2**zoom*256);
      let expected;
      // Pick an interior texel from the independent native reference.
      for(const offset of [0,4,-4,12,-12,24,-24]) {
        const point=[coord[0]+offset*span,coord[1]];
        expected=JSON.parse(execFileSync(python,['scripts/national/native_probe.py',root,String(zoom),...point.map(String)]));
        if ((expected.height===-99999)===missing) {coord[0]=point[0];break;}
      }
      assert.equal(expected.height===-99999,missing);
      await position(page,coord);
      await page.locator('.map').evaluate((map,point)=>{
        map.dataset.edgeCoordinate=point.join(',');
        map.addEventListener('terrain-edge-frame',event=>{window.sample=event.detail;});
        document.addEventListener('input',()=>{window.changedAt=performance.now();},true);
      },coord);
      const input=page.getByRole('spinbutton');
      await input.fill('100');
      await page.waitForFunction(height=>window.sample?.fineLoaded && window.sample.height===height,expected.height);
      await page.waitForLoadState('networkidle');
      const transfers=[];
      page.on('request',r=>{if (/\/terrain\/|\.bin-[^/]+\.gz/.test(r.url())) transfers.push(r.url());});
      const measurements=[];
      for(const [altitude,color] of missing ?
        [[200,[94,72,32,128]],[300,[94,72,32,128]]] :
        [[expected.height,[0,0,0,0]],[expected.height+10,[13,21,26,92]]]) {
        await input.fill(String(altitude));
        await page.waitForFunction(c=>window.sample?.time>=window.changedAt &&
          c.every((v,i)=>Math.abs(window.sample.rgba[i]-v)<=1),color);
        measurements.push(await page.evaluate(()=>Math.round(window.sample.time-window.changedAt)));
      }
      assert.deepEqual(transfers,[]);
      console.log(JSON.stringify({place,zoom,coord,height:expected.height,shaderChangeMs:measurements,transfers:0}));
      await page.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
