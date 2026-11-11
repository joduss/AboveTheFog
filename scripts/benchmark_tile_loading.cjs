// Production preview, real WMTS and elevation sources, fresh browser context.
// MAP_URL, BROWSER_PATH and RUNS can be set by the caller.
const {chromium} = require('playwright');
const origin = process.env.MAP_URL || 'http://127.0.0.1:5177';
if (process.env.START_PLACE && !['national', 'Fribourg', 'Zurich'].includes(process.env.START_PLACE)) {
  throw Error('START_PLACE must be national, Fribourg or Zurich');
}
const executablePath = process.env.BROWSER_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

(async () => {
  const browser = await chromium.launch({headless: true, executablePath});
  try {
    for (let run = 1; run <= Number(process.env.RUNS || 1); run++) {
      const context = await browser.newContext({viewport: {width: 1100, height: 850}});
      const page = await context.newPage();
      const requests = [];
      context.on('request', request => requests.push(request.url()));
      await page.addInitScript(() => {
        window.measureView = (place, start, coldStart) => new Promise(resolve => {
          let firstTerrain, settled, firstBase, centerDetail;
          const national = place === 'national';
          function sample() {
            const elapsed = Math.round(performance.now() - start);
            const map = document.querySelector('.map');
            const info = map?.dataset.terrainDiagnostics && JSON.parse(map.dataset.terrainDiagnostics);
            const status = document.querySelector('[role=status]')?.textContent || '';
            const longitude = place === 'Zurich' ? 8.5417 : 7.1619;
            const atDestination = info && (national ? info.zoom < 12 :
              info.zoom === 15 && Math.abs(info.center[0] - longitude * 20037508.342789244 / 180) < 1);
            if (atDestination) {
              const z = Math.floor(info.zoom);
              const span = 40075016.68557849 / 2 ** z;
              const cx = Math.floor((20037508.342789244 + info.center[0]) / span);
              const cy = Math.floor((20037508.342789244 - info.center[1]) / span);
              const progress = info.viewProgress;
              if (progress?.centerKey === [z,cx,cy].join('/') && progress.centerSource) {
                firstTerrain ??= elapsed;
                if (progress.centerSource === 'detail') centerDetail ??= elapsed;
                if (centerDetail !== undefined && progress.loading === 0) settled ??= elapsed;
              }
              // Only check first navigation paint. On a pan, an old frame can
              // already have an opaque centre pixel before the new basemap draws.
              if (coldStart && firstBase === undefined) {
                const canvas = map.querySelector('.ol-layers canvas');
                const ctx = canvas?.getContext('2d');
                if (ctx && ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data[3]) firstBase = elapsed;
              }
            }
            if ((settled !== undefined && (!coldStart || firstBase !== undefined)) || elapsed > 60000) {
              resolve({firstBase, firstTerrain, centerDetail, settled, status});
            } else requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        });
      });
      const route = process.env.START_PLACE ? [process.env.START_PLACE] : ['national', 'Fribourg', 'Zurich', 'Fribourg'];
      for (const [index, place] of route.entries()) {
        const coldStart = index === 0;
        requests.length = 0;
        if (coldStart) {
          const url = new URL('/?debugTiles', origin);
          if (place !== 'national') url.searchParams.set('place', place);
          await page.goto(url.href, {waitUntil: 'domcontentloaded'});
        }
        const result = await page.evaluate(({place, coldStart}) => {
          const start = coldStart ? 0 : performance.now();
          if (!coldStart) {
            const select = document.querySelector('select');
            select.value = place;
            select.dispatchEvent(new Event('change', {bubbles: true}));
          }
          return window.measureView(place, start, coldStart);
        }, {place, coldStart});
        console.log(JSON.stringify({run, browser: browser.version(), place, ...result,
          wmts: requests.filter(url => url.includes('wmts.geo.admin.ch')).length,
          catalogue: requests.filter(url => url.includes('/api/stac/')).length,
          tiff: requests.filter(url => url.includes('.tif')).length,
          warning: await page.getByRole('alert').count(),
        }));
      }
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
