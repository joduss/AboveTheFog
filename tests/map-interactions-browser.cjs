const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

(async () => {
  const {outputText} = ts.transpileModule(fs.readFileSync('src/cantons.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext}});
  const {CANTONS} = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
  const browser = await chromium.launch({headless: true, ...(process.env.BROWSER_PATH ? {executablePath: process.env.BROWSER_PATH} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 1400, height: 950}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto((process.env.MAP_URL || 'http://127.0.0.1:5177') + '/?debugTiles');
    await page.waitForFunction(() => document.querySelector('.map')?.hasAttribute('data-terrain-diagnostics'));
    const stats = () => page.locator('.map').getAttribute('data-terrain-diagnostics').then(JSON.parse);
    const picker = page.getByRole('combobox', {name: 'Explore a canton'});
    assert.equal(await picker.locator('option').count(), 27);
    assert.equal(new Set(CANTONS.map(c => c.code)).size, 26);
    const project = (lon, lat) => [lon * 20037508.342789244 / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 20037508.342789244 / Math.PI];
    for (const canton of CANTONS) {
      await picker.selectOption(canton.code);
      assert.equal(await picker.inputValue(), canton.code, 'Selection stays visible');
      const sw = project(canton.bounds[0], canton.bounds[1]);
      const ne = project(canton.bounds[2], canton.bounds[3]);
      await page.waitForFunction(center => {
        const state = JSON.parse(document.querySelector('.map').getAttribute('data-terrain-diagnostics'));
        return state.center.every((value, i) => Math.abs(value - center[i]) < 1);
      }, sw.map((value, i) => (value + ne[i]) / 2));
      const state = await stats();
      for (let axis = 0; axis < 2; axis++) {
        const half = (state.size[axis] / 2 - 29) * state.resolution;
        assert(state.center[axis] - half <= sw[axis] && state.center[axis] + half >= ne[axis], `${canton.code} must fit with padding`);
      }
    }
    await picker.selectOption('FR');
    const box = await page.locator('.map').boundingBox();
    const point = {x: Math.round(box.x + box.width * .65) - box.x, y: Math.round(box.y + box.height * .6) - box.y};
    const wheel = values => page.locator('.ol-viewport').dispatchEvent('wheel', {
      deltaMode: 0, clientX: box.x + point.x, clientY: box.y + point.y,
      bubbles: true, cancelable: true, ...values,
    });
    let before = await stats();
    await wheel({deltaX: 75, deltaY: 120});
    await page.waitForTimeout(350);
    let after = await stats();
    assert(Math.abs(after.zoom - before.zoom) < 1e-8, 'Two-finger scroll must not zoom');
    assert(Math.abs(after.center[0] - before.center[0] - 75 * before.resolution) < 1, 'Horizontal pan');
    assert(Math.abs(after.center[1] - before.center[1] + 120 * before.resolution) < 1, 'Vertical pan');
    before = after;
    for (let i = 0; i < 10; i++) await wheel({deltaX: 2, deltaY: 3});
    await page.waitForTimeout(350);
    after = await stats();
    assert(Math.abs(after.center[0] - before.center[0] - 20 * before.resolution) < 1, 'Rapid horizontal deltas accumulate');
    assert(Math.abs(after.center[1] - before.center[1] + 30 * before.resolution) < 1, 'Rapid vertical deltas accumulate');
    before = after;
    await page.mouse.move(box.x + point.x, box.y + point.y);
    await page.mouse.wheel(25, 40);
    await page.waitForTimeout(350);
    after = await stats();
    assert(Math.abs(after.zoom - before.zoom) < 1e-8 && after.center[0] > before.center[0] && after.center[1] < before.center[1], 'Browser-delivered scroll pans');
    const coordinate = state => [state.center[0] + (point.x * state.size[0]/box.width - state.size[0]/2) * state.resolution, state.center[1] - (point.y * state.size[1]/box.height - state.size[1]/2) * state.resolution];
    before = after;
    const anchor = coordinate(before);
    for (let i = 0; i < 10; i++) await wheel({deltaY: -2, ctrlKey: true});
    await page.waitForTimeout(400);
    after = await stats();
    assert(Math.abs(after.zoom - before.zoom - .2) < .001, 'Pinching zooms continuously without snapping');
    coordinate(after).forEach((value, i) => assert(Math.abs(value - anchor[i]) < 1, `Pinch stays anchored under the pointer: axis ${i}, drift ${value-anchor[i]}`));
    await wheel({deltaY: 20, ctrlKey: true});
    await page.waitForTimeout(400);
    assert(Math.abs((await stats()).zoom - before.zoom) < .001, 'Reverse pinch zooms out');
    await wheel({deltaY: -3, deltaMode: 1});
    await page.waitForTimeout(500);
    assert((await stats()).zoom > before.zoom, 'Traditional mouse wheel still zooms');
    before = await stats();
    const cancelled = await page.locator('.ol-viewport').evaluate((element, point) => {
      function gesture(type, scale) {
        const event = new Event(type, {bubbles: true, cancelable: true});
        Object.assign(event, {scale, clientX: point.x, clientY: point.y});
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }
      return [gesture('gesturestart', 1), gesture('gesturechange', 1.5), gesture('gestureend', 1.5)];
    }, {x: box.x + point.x, y: box.y + point.y});
    assert(cancelled.every(Boolean), 'Safari gesture events prevent browser page zoom');
    await page.waitForTimeout(400);
    assert(Math.abs((await stats()).zoom - before.zoom - Math.log2(1.5)) < .001, 'Safari gesture scales the map');
    before = await stats();
    await page.locator('.map').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    assert((await stats()).center[0] > before.center[0], 'Keyboard navigation works');
    before = await stats();
    await page.getByTitle('Zoom in', {exact: true}).click();
    await page.waitForTimeout(400);
    assert((await stats()).zoom > before.zoom, 'Zoom buttons work');
    await page.getByRole('button', {name: 'Switzerland ↗'}).click();
    assert.equal(await picker.inputValue(), '', 'Reset clears the canton choice');
    await page.screenshot({path: 'test-results/cantons-desktop.png'});
    await page.setViewportSize({width: 390, height: 844});
    await picker.selectOption('BS');
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Phone layout has no horizontal overflow');
    await page.screenshot({path: 'test-results/cantons-phone.png', fullPage: true});
    assert.deepEqual(errors, []);
    console.log('Passed: all 26 canton extents, retained selection/reset, diagonal pan, anchored continuous pinch, mouse wheel, Safari gesture path, keyboard/buttons, phone layout.');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
