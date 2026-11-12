const {chromium} = require('playwright');
const assert = require('node:assert/strict');

const origin = process.env.MAP_URL || 'http://127.0.0.1:5177';
const executablePath = process.env.BROWSER_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const success = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=', 'base64');

(async () => {
  const browser = await chromium.launch({headless: true, executablePath});
  try {
    const page = await browser.newPage({viewport: {width: 1100, height: 850}});
    const attempts = new Map(), failures = new Map(), errors = [], remoteTerrain = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://data.geo.admin.ch/**', route => {
      remoteTerrain.push(route.request().url());
      return route.abort();
    });
    // Keep one visible tile broken and let its neighbour recover automatically.
    let persistent, transient;
    await page.route('https://wmts.geo.admin.ch/**', route => {
      const key = new URL(route.request().url()).pathname.split('/').slice(-3).join('/').replace('.jpeg', '');
      if (!persistent) {persistent = key; failures.set(key, Infinity);}
      else if (!transient && key !== persistent) {transient = key; failures.set(key, 1);}
      const count = (attempts.get(key) || 0) + 1;
      attempts.set(key, count);
      return count <= (failures.get(key) || 0)
        ? route.fulfill({status: 503, headers: {'Access-Control-Allow-Origin': '*'}})
        : route.fulfill({contentType: 'image/png', body: success, headers: {'Access-Control-Allow-Origin': '*'}});
    });
    await page.goto(origin + '/?debugTiles');
    const warning = page.getByRole('alert');
    await warning.waitFor();
    await page.waitForFunction(() => /ready|contain unavailable/.test(document.querySelector('[role=status]').textContent)
      && !document.querySelector('[role=status]').textContent.includes('loading'));
    assert.equal(attempts.get(persistent), 2);
    assert.equal(attempts.get(transient), 2);
    assert([...attempts.keys()].every(key => !key.startsWith('7/') || !key.endsWith('/43')), 'Out-of-bounds row must never be requested');
    assert.deepEqual(remoteTerrain, [], 'National startup must use bundled overview samples');
    // Changing views clears the warning. Returning retries the failed tile; good
    // neighbours stay resident even when the user requests another recovery.
    await page.getByRole('combobox').selectOption('FR');
    await warning.waitFor({state: 'hidden'});
    await page.getByRole('button', {name: 'Switzerland ↗', exact: true}).click();
    await warning.waitFor();
    const before = new Map(attempts);
    failures.delete(persistent);
    await page.getByRole('button', {name: 'Retry background map'}).click();
    await warning.waitFor({state: 'hidden'});
    await page.waitForTimeout(700);
    assert.equal(await warning.count(), 0);
    assert.equal(attempts.get(persistent), before.get(persistent) + 1);
    assert.equal(attempts.get(transient), before.get(transient));
    assert.deepEqual(errors, []);
    console.log('National static overview, coverage bounds, automatic recovery, persistent failure, pan away/back and targeted retry passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
