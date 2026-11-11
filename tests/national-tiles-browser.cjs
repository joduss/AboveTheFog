// Production map, empty browser storage for each place. Live elevation is
// blocked, so any geographic fallback is observable on both startup and pan.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const origin = process.env.MAP_URL || 'http://127.0.0.1:5184';

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_PATH ||
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'});
  try {
    for (const [place, zoom] of [['Zurich',13], ['St. Moritz',13], ['Lugano',13], ['Geneva',15], ['Basel',19], ['Zurich',12]]) {
      const context = await browser.newContext({viewport: {width:1100,height:850}});
      const upstream = [], packets = [], errors = [];
      context.on('request', req => {
        if (/\/api\/stac\/|\.tif(?:\?|$)/.test(req.url())) upstream.push(req.url());
        if (/\/terrain\/.*\.pack$/.test(req.url())) packets.push(req.url());
      });
      await context.route('https://data.geo.admin.ch/**', route => route.abort());
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        // Observe from the first frame rather than measuring a polling interval.
        function sample() {
          const raw = document.querySelector('.map')?.dataset.terrainDiagnostics;
          if (raw) {
            const view = JSON.parse(raw);
            if (view.viewProgress?.centerSource === 'detail') {
              window.firstDetail ??= Math.round(performance.now());
              if (view.viewProgress.loading === 0) window.settled ??= Math.round(performance.now());
            }
          }
          if (!window.settled) requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      const url = new URL('/',origin);
      url.search = new URLSearchParams({place,zoom:String(zoom),debugTiles:''});
      await page.goto(url.href, {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.settled > 0);
      if (zoom===13) assert.match(await page.locator('.ol-scale-line-inner').innerText(), /1000 m|1 km/);
      const atStart = await page.evaluate(() => ({
        firstDetail: window.firstDetail, settled: window.settled,
        center: JSON.parse(document.querySelector('.map').dataset.terrainDiagnostics).center,
      }));
      const box = await page.locator('.map').boundingBox();
      const middle = {x:box.width/2,y:box.height/2};
      await page.locator('.map').click({position:middle});
      await page.waitForFunction(() => document.querySelector('.map-footer').textContent.includes('Terrain band:'));
      const initialRequests = packets.length;
      // Move two thirds of the viewport, including tiles outside the initial view.
      const from = box.x+box.width*.82, to = box.x+box.width*.17, y = box.y+box.height/2;
      await page.mouse.move(from,y); await page.mouse.down();
      await page.mouse.move(to,y,{steps:10}); await page.waitForTimeout(180); await page.mouse.up();
      await page.waitForFunction(start => {
        const v = JSON.parse(document.querySelector('.map').dataset.terrainDiagnostics);
        return Math.abs(v.center[0]-start)>10 && v.viewProgress?.centerSource==='detail' &&
          v.viewProgress.loading===0 && v.pending.length===0 && v.failed.length===0;
      },atStart.center[0]);
      const beforeControls = packets.length;
      await page.getByRole('spinbutton').fill('850');
      await page.getByRole('checkbox').uncheck();
      await page.waitForTimeout(100);
      assert.equal(packets.length,beforeControls,'Threshold controls must reuse downloaded elevation');
      assert(initialRequests > 0 && packets.every(url => !url.includes('/prepared/')));
      assert.deepEqual(upstream,[]); assert.deepEqual(errors,[]);
      console.log(JSON.stringify({place,zoom,firstDetailMs:atStart.firstDetail,settledMs:atStart.settled,
        coldPackets:initialRequests,additionalPanPackets:beforeControls-initialRequests,sourceRequests:upstream.length}));
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
