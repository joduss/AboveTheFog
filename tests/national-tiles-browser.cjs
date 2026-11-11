// Production map, empty browser storage for each place. Live elevation is
// blocked, so any geographic fallback is observable on both startup and pan.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {gunzipSync} = require('node:zlib');
const root = process.env.DATA_ROOT || path.resolve(__dirname, '..');

const references = new Map();
function expectedSample(zoom, coordinate) {
  const key=[zoom,...coordinate.map(v=>v.toFixed(6))].join('/');
  if (!references.has(key)) references.set(key,readReference(zoom,coordinate));
  return references.get(key);
}
function readReference(zoom, [east,north]) {
  if (zoom>=13 && fs.existsSync(path.join(root,'src/terrain/native-index/release.json'))) {
    const python = process.env.TERRAIN_PYTHON || path.resolve('.prep-env/bin/python');
    const output = require('node:child_process').execFileSync(python,
      ['scripts/national/native_probe.py',root,String(zoom),String(east),String(north)]);
    return JSON.parse(output);
  }
  const z = Math.min(16, zoom);
  const index = JSON.parse(fs.readFileSync(path.join(root, 'src/terrain/national-index', z+'.json')));
  const span = 40075016.68557849 / 2**z;
  const px = Math.floor((east+20037508.342789244)/span*256);
  const py = Math.floor((20037508.342789244-north)/span*256);
  const x = Math.floor(px/256), y = Math.floor(py/256), g = index.group;
  const key = Math.floor(x/g)+'/'+Math.floor(y/g);
  let band = -32768;
  if (index.packs[key]) {
    const pack = fs.readFileSync(path.join(root, 'static/terrain', String(z), key+'-'+index.packs[key]+'.pack'));
    const offset = 4*((y%g)*g+x%g);
    const start = pack.readUInt32LE(offset), end = pack.readUInt32LE(offset+4);
    if (end>start) band = gunzipSync(pack.subarray(start,end)).readInt16LE(2*((py%256)*256+px%256));
  }
  return {height:band===-32768 ? -99999 : band*10, dataset:index.source};
}
const hops = Number(process.env.PAN_HOPS || 1);
const states = process.env.PAN_CACHE_STATES ? ['cold','http-warm','decoded-revisit'] : ['cold'];
const origin = process.env.MAP_URL || 'http://127.0.0.1:5184';

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.env.BROWSER_PATH ||
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'});
  try {
    const routes = process.env.PAN_PLACE ? [[process.env.PAN_PLACE, Number(process.env.PAN_ZOOM || 16)]] : [['Zurich',13], ['St. Moritz',13], ['Lugano',13], ['Geneva',15], ['Basel',19], ['Zurich',12]];
    const repetitions=Number(process.env.PAN_RUNS || 1);
    if (!Number.isInteger(repetitions) || repetitions<1) throw Error('PAN_RUNS must be positive');
    const trials=Array.from({length:repetitions},(_,i)=>routes.map(([place,zoom])=>[place,zoom,i+1])).flat();
    for (const [place, zoom, run] of trials) {
      const context = await browser.newContext({viewport: {width:1100,height:850}});
      const upstream = [], packets = [], errors = [];
      context.on('request', req => {
        if (/\/api\/stac\/|\.tif(?:\?|$)/.test(req.url())) upstream.push(req.url());
        if (/\/terrain\/(?:.*\.pack$|native\/)/.test(req.url())) packets.push(req.url());
      });

      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setBlockedURLs', {urls:['*://data.geo.admin.ch/*']});
      await cdp.send('Network.emulateNetworkConditions', {offline:false,latency:40,
        downloadThroughput:2500000,uploadThroughput:2500000});
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        window.coldFrames=[];
        document.addEventListener('terrain-edge-frame',event=>{
          if (window.hopStart===undefined && window.coldFrames.length<300) window.coldFrames.push(event.detail);
        },true);
        window.uploads = [];
        for (const type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) {
          if (!type) continue;
          const original = type.prototype.texImage2D;
          type.prototype.texImage2D = function(...args) {
            const start = performance.now();
            const result = original.apply(this,args);
            if (args.at(-1) instanceof Float32Array) {
              window.uploads.push({start,ms:performance.now()-start,bytes:args.at(-1).byteLength});
            }
            return result;
          };
        }
        window.frameTimes = [];
        function animate(t) {window.frameTimes.push(t);requestAnimationFrame(animate);}
        requestAnimationFrame(animate);
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
      const url = new URL(origin);
      url.search = new URLSearchParams({place,zoom:String(zoom),debugTiles:'',centerProbe:'', decodeWorkers:process.env.DECODE_WORKERS || '0', terrainRequests:process.env.TERRAIN_REQUESTS || '4'});
      for (const state of states) {
        if (state !== 'decoded-revisit') {
          await page.goto(url.href, {waitUntil:'domcontentloaded'});
        } else {
          await page.evaluate(() => document.querySelector('.map').dispatchEvent(new Event('terrain-reset-trace')));
        }
        await page.waitForFunction(() => window.settled > 0);
        if (zoom===13) assert.match(await page.locator('.ol-scale-line-inner').innerText(), /1000 m|1 km/);
        const atStart = await page.evaluate(() => ({
          firstDetail: window.firstDetail, settled: window.settled,
          center: JSON.parse(document.querySelector('.map').dataset.terrainDiagnostics).center,
        }));
        const direct = await page.evaluate(() => {
          const frames=window.coldFrames;
          const valid=f=>f.height!==null && f.height!==-99999 &&
            Math.abs(f.rgba[3]-(f.height<650?92:0))<=1;
          return {firstApproximateOrFineMs:frames.find(valid)?.time ?? null,
            firstFullResolutionImageryMs:frames.find(f=>f.imagery)?.time ?? null,
            firstCombinedMs:frames.find(f=>f.imagery && valid(f))?.time ?? null};
        });
        const box = await page.locator('.map').boundingBox();
        const middle = {x:box.width/2,y:box.height/2};
        await page.locator('.map').click({position:middle});
        await page.waitForFunction(() => document.querySelector('.map-footer').textContent.includes('Terrain band:'));
        for (let hop=0; hop<hops; hop++) {
          const beforeCenter = await page.evaluate(() => JSON.parse(document.querySelector('.map').dataset.terrainDiagnostics).center[0]);
          const edge = await page.evaluate(() => {
            const map = document.querySelector('.map');
            const {center,size,resolution} = JSON.parse(map.dataset.terrainDiagnostics);
            const coordinate = [center[0] + (size[0]/2+size[0]*.48)*resolution, center[1]];
            map.dataset.previousRight = String(center[0]+size[0]/2*resolution);
            delete map.dataset.edgeExposed;

            window.edgeFrames = [];
            map.onEdgeFrame ||= event => window.edgeFrames.push(event.detail);
            map.addEventListener('terrain-edge-frame', map.onEdgeFrame);
            map.dataset.edgeCoordinate = coordinate.join(',');
            return coordinate;
          });
          const expected = expectedSample(zoom,edge);
          await page.evaluate(()=>{window.hopStart=performance.now();});
          const initialRequests = packets.length;
          // Move two thirds of the viewport, including tiles outside the initial view.
          const from = box.x+box.width*.82, to = box.x+box.width*.17, y = box.y+box.height/2;
          await page.mouse.move(from,y); await page.mouse.down();
          await page.mouse.move(to,y,{steps:10}); await page.waitForTimeout(180); await page.mouse.up();
          const released = await page.evaluate(() => performance.now());
          await page.waitForFunction(start => {
            const v = JSON.parse(document.querySelector('.map').dataset.terrainDiagnostics);
            return Math.abs(v.center[0]-start)>10 && v.viewProgress?.centerSource==='detail' &&
              v.viewProgress.loading===0 && v.pending.length===0 && v.failed.length===0;
          },beforeCenter);
          const edgeTiming = await page.evaluate(({expected,released}) => {
            const map = document.querySelector('.map');
            map.dispatchEvent(new Event('terrain-report'));
            const report = JSON.parse(map.dataset.terrainReport);
            const exposed = Number(map.dataset.edgeExposed);
            const times = window.frameTimes.filter(t=>t>=window.hopStart);
            const intervals = times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
            const resources = performance.getEntriesByType('resource').filter(e=>e.startTime>=window.hopStart && (e.name.endsWith('.pack') || e.name.includes('/terrain/native/')));
            const frames = window.edgeFrames;
            const elapsed = frame => frame ? Math.max(0,Math.round(frame.time-exposed)) : null;
            const color = expected.height===-99999 ? [94,72,32,128] : expected.height<650 ? [13,21,26,92] : [0,0,0,0];
            const correct = f => f.fineLoaded && f.height===expected.height && color.every((c,i)=>Math.abs(f.rgba[i]-c)<=1);
            return {frames: frames.length,
              stripReadyMs:elapsed(frames.find(f=>f.stripReady)),
              viewportReadyMs:elapsed(frames.find(f=>f.viewportReady)),
              exposureObserved:Number.isFinite(exposed),
              settledAfterReleaseMs:Math.round(performance.now()-released),
              frameP95Ms:intervals[Math.ceil(intervals.length*.95)-1],
              transferBytes:resources.reduce((n,e)=>n+e.transferSize,0),
              packetBodyBytes:resources.reduce((n,e)=>n+e.encodedBodySize,0),
              uploads:window.uploads.filter(u=>u.start>=window.hopStart),
              packetPeakBytes:report.packetPeak,trackedBytes:report.trackedBytes,textureBytes:report.textureBytes,stagingPeak:report.native?.peak, stages:report.trace.filter(t=>t.start>=window.hopStart),
              fineFogMs: elapsed(frames.find(correct)),
              combinedMs: elapsed(frames.find(f=>correct(f) && f.imagery)), firstDimFogMs: elapsed(frames.find(f => Math.abs(f.rgba[3]-92)<=1)),
              firstFullResolutionImageryMs: elapsed(frames.find(f=>f.imagery)), lastFrame: frames.at(-1)};
          },{expected,released});
          assert(edgeTiming.exposureObserved && edgeTiming.frames > 0, 'Expected rendered samples on the newly exposed strip');
          const afterPan = packets.length;
          assert.deepEqual(upstream,[]); assert.deepEqual(errors,[]);
          console.log(JSON.stringify({place,zoom,run,state,hop,direct,firstDetailMs:atStart.firstDetail,settledMs:atStart.settled,
            dataset:expected.dataset,expectedHeight:expected.height,edge,edgeTiming,
            build:await page.locator('script[type=module]').first().getAttribute('src'),packetsBeforePan:initialRequests,additionalPanPackets:afterPan-initialRequests,sourceRequests:upstream.length}));
        }
        await page.waitForFunction(() => {
          const view = JSON.parse(document.querySelector('.map').dataset.terrainDiagnostics);
          return view.pending.length===0 && view.lookAhead===0 && view.viewProgress?.loading===0;
        });
        await page.waitForLoadState('networkidle');
        const beforeControls = packets.length;
        await page.getByRole('spinbutton').fill('850');
        await page.getByRole('checkbox').uncheck();
        await page.waitForTimeout(100);
        assert.deepEqual(packets.slice(beforeControls),[],'Threshold controls must reuse downloaded elevation');
        await page.getByRole('spinbutton').fill('650');
        await page.getByRole('checkbox').check();
      }
      await context.close();
    }
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
