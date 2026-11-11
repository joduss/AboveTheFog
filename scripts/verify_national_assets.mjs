// Validate the entire release without remote sources or the preparation environment.
// A partial checkout must fail the production build before Vite replaces dist.
import {verifyNative} from './verify_native_assets.mjs';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createXYZ} from 'ol/tilegrid.js';
import {transformExtent} from 'ol/proj.js';
import {SWISS_BOUNDS} from '../src/terrain/math.ts';

export function verifyNationalAssets() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const grid = createXYZ();
  const extent = transformExtent(SWISS_BOUNDS,'EPSG:4326','EPSG:3857');
  let files = 0, bytes = 0;
  const inventory = readFileSync(resolve(root,'scripts/national/detail-sources.json.gz'));
  const detailHash = createHash('sha256').update(inventory).digest('hex');
  const overviewHashes = JSON.parse(readFileSync(resolve(root,'scripts/national/overview-hashes.json')));
  // The production grid covers every overview tile intersecting the Swiss extent.
  for (const z of [7,8]) {
    const r = grid.getTileRangeForExtentAndZ(extent,z);
    for (let x=r.minX; x<=r.maxX; x++) for (let y=r.minY; y<=r.maxY; y++) {
      const name = `${z}-${x}-${y}.bin.gz`;
      const body = readFileSync(resolve(root,'src/terrain/overview',name));
      if (createHash('sha256').update(body).digest('hex')!==overviewHashes[name]) throw Error('Wrong overview '+name);
    }
  }
  const native = existsSync(resolve(root,'src/terrain/native-index/release.json'));
  if (native) {
    const r = grid.getTileRangeForExtentAndZ(extent,12);
    const result = verifyNative(root,[r.minX,r.minY,r.maxX,r.maxY],inventory);
    files += result.files;
    bytes += result.bytes;
  }
  for (let z = 9; z <= (native ? 12 : 16); z++) {
    const level = JSON.parse(readFileSync(resolve(root,`src/terrain/national-index/${z}.json`),'utf8'));
    const range = grid.getTileRangeForExtentAndZ(extent,z);
    const bounds = [range.minX, range.minY, range.maxX, range.maxY];
    if (z !== level.z || bounds.some((n,i) => level.bounds[i] !== n) || ![1,2,4,8].includes(level.group)) {
      throw Error(`Invalid nationwide extent or grid at zoom ${z}`);
    }
    const expectedSource = z<13 ? 'e1cade929d3007d74be67e5d107e517e40b13e0597a114097744b032fc6527e5' : detailHash;
    if (level.source!==expectedSource) throw Error(`Wrong source edition at zoom ${z}`);
    const packs = Object.entries(level.packs);
    if (!packs.length) throw Error(`No national packets at zoom ${z}`);
    for (const [coord, digest] of packs) {
      if (!/^\d+\/\d+$/.test(coord) || !/^[a-f0-9]{20}$/.test(digest)) throw Error('Invalid national packet key');
      const [x,y] = coord.split('/');
      const file = resolve(root,`static/terrain/${z}/${x}/${y}-${digest}.pack`);
      const buffer = readFileSync(file);
      if (level.lengths?.[coord] !== buffer.length) throw Error(`Packet length mismatch: ${file}`);
      if (!createHash('sha256').update(buffer).digest('hex').startsWith(digest)) throw Error(`Packet checksum mismatch: ${file}`);
      const count = level.group**2;
      let offset = (count+1)*4;
      if (buffer.readUInt32LE(0)!==offset) throw Error(`Invalid header: ${file}`);
      for (let i=1; i<=count; i++) {
        const end = buffer.readUInt32LE(i*4);
        if (end<offset || end>buffer.length) throw Error(`Invalid member bounds: ${file}`);
        offset = end;
      }
      if (offset!==buffer.length) throw Error(`Invalid packet length: ${file}`);
      files++;
      bytes += buffer.length;
    }
  }
  return {files,bytes};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Verified nationwide delivery assets', verifyNationalAssets());
}
