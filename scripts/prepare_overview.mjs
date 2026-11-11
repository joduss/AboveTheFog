// Run after npm run build. Use the production sampler so every overview pixel,
// including NoData along the national boundary, matches the interactive path.
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {gzipSync, gunzipSync} from 'node:zlib';
import {mkdir, readFile, readdir, rename, writeFile} from 'node:fs/promises';
import {createXYZ} from 'ol/tilegrid.js';
import {transformExtent} from 'ol/proj.js';
import {SWISS_BOUNDS} from '../src/terrain/math.ts';

const assets = new URL('../dist/assets/', import.meta.url);
const bundle = (await readdir(assets)).find(name => /^elevation\.worker-.*\.js$/.test(name));
if (!bundle) throw Error('Build the app before preparing national overviews.');
const worker = new Worker(`
  const {parentPort} = require('node:worker_threads');
  globalThis.self = globalThis;
  globalThis.postMessage = message => parentPort.postMessage(message);
  import(${JSON.stringify(new URL(bundle, assets).href)}).then(() =>
    parentPort.on('message', data => self.onmessage({data})));
`, {eval: true});
const directory = new URL('../src/terrain/overview/', import.meta.url);
await mkdir(directory, {recursive: true});
const grid = createXYZ();
const extent = transformExtent(SWISS_BOUNDS, 'EPSG:4326', 'EPSG:3857');
const check = process.argv.includes('--check');
const output = new Map();
let count = 0, bytes = 0;
try {
  for (const z of [7, 8]) {
    const range = grid.getTileRangeForExtentAndZ(extent, z);
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        const result = once(worker, 'message', {signal: AbortSignal.timeout(65000)});
        worker.postMessage({id: ++count, z, x, y});
        const [tile] = await result;
        if (tile.error || tile.failures || tile.data?.length !== 65536) throw Error(tile.error || 'Incomplete overview');
        const payload = Buffer.alloc(8 + tile.data.byteLength);
        payload.writeDoubleLE(tile.spacing);
        for (let i = 0; i < tile.data.length; i++) payload.writeFloatLE(tile.data[i], 8 + 4 * i);
        const name = `${z}-${x}-${y}.bin.gz`;
        if (check) {
          const saved = await readFile(new URL(name, directory));
          if (!gunzipSync(saved).equals(payload)) throw Error(`Live samples differ in ${name}`);
          bytes += saved.length;
        } else {
          const compressed = gzipSync(payload, {level: 9});
          output.set(name, compressed);
          bytes += compressed.length;
        }
      }
    }
  }
  for (const [name, compressed] of output) {
    const temporary = new URL(`${name}.${process.pid}.tmp`, directory);
    await writeFile(temporary, compressed);
    await rename(temporary, new URL(name, directory));
  }
  console.log(`${check ? 'Verified' : 'Prepared'} ${count} national overview tiles (${bytes} bytes).`);
} finally {
  await worker.terminate();
}
