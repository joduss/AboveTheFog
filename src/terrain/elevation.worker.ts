import {BaseClient, BaseResponse, fromCustomClient, type GeoTIFF, type GeoTIFFImage} from 'geotiff';
import proj4 from 'proj4';
import {DETAIL_ZOOM, NODATA, TILE_SIZE, tileExtent, overviewIndex, validHeight, missingTile, selectDetailAssets, type Bounds, type Asset} from './math';

const STAC = 'https://data.geo.admin.ch/api/stac/v0.9/collections/';
proj4.defs('EPSG:2056', '+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs');
const toSwiss = proj4('EPSG:3857', 'EPSG:2056');
const toLonLat = proj4('EPSG:2056', 'EPSG:4326');
let current: AbortController | undefined;
let activeSignal: AbortSignal;
let transferred = 0;
// Each worker handles one tile at a time, with at most two range requests in flight.
let networkActive = 0;
const waiters: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (networkActive >= 2) await new Promise<void>(resolve => waiters.push(resolve));
  networkActive++;
  try {return await fn();} finally {networkActive--; waiters.shift()?.();}
}
class RangeResponse extends BaseResponse {
  constructor(private response: Response, private data: ArrayBuffer) {super();}
  get status() {return this.response.status;}
  getHeader(name: string) {return this.response.headers.get(name) ?? undefined;}
  async getData() {return this.data;}
}
class RangeClient extends BaseClient {
  async request(options: RequestInit = {}) {
    const taskSignal = activeSignal;
    return limited(async () => {
      taskSignal.throwIfAborted();
      const range = new Headers(options.headers).get('range');
      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
      if (!match || Number(match[2]) - Number(match[1]) > 8 * 1024 * 1024) throw Error('Unbounded elevation request');
      const signals = [taskSignal, AbortSignal.timeout(20000)];
      if (options.signal) signals.push(options.signal);
      const response = await fetch(this.url, {...options, credentials: 'omit', signal: AbortSignal.any(signals)});
      // Never accept an accidental full download of the 10 GB regional COG.
      if (response.status !== 206) {await response.body?.cancel(); throw Error(`Range request failed (${response.status})`);}
      const data = await response.arrayBuffer();
      if (!data.byteLength || data.byteLength > Number(match[2]) - Number(match[1]) + 1) throw Error('Invalid range response');
      transferred += data.byteLength;
      return new RangeResponse(response, data);
    });
  }
}
async function json(url: string) {
  const response = await fetch(url, {signal: AbortSignal.any([activeSignal, AbortSignal.timeout(20000)]), credentials: 'omit'});
  if (!response.ok) throw Error(`Catalogue unavailable (${response.status})`);
  return response.json();
}
interface Raster {tiff: GeoTIFF; images: GeoTIFFImage[]; bounds: Bounds; widths: number[]; nodata: number | null}
const readers = new Map<string, Raster>();
let regioURL: string | undefined;
async function open(url: string, overviews: boolean): Promise<Raster> {
  const cached = readers.get(url);
  if (cached) {readers.delete(url); readers.set(url, cached); return cached;}
  // Detail sampling reads each small 2 m source square in full. One bounded
  // range usually covers it. Keep fine-grained ranges for the national COG.
  const tiff = await fromCustomClient(new RangeClient(url), {allowFullFile: false, maxRanges: 0, blockSize: overviews ? 65536 : 2 * 1024 * 1024, cacheSize: overviews ? 32 : 1}, activeSignal);
  const base = await tiff.getImage(0);
  if (base.getGeoKeys()?.ProjectedCSTypeGeoKey !== 2056) throw Error('Unexpected elevation projection');
  const images = [base];
  if (overviews) for (let i = 1; i < await tiff.getImageCount(); i++) images.push(await tiff.getImage(i));
  const raster = {tiff, images, bounds: base.getBoundingBox() as Bounds, widths: images.map(i => i.getWidth()), nodata: base.getGDALNoData()};
  readers.set(url, raster);
  // Bounded reader count, including TIFF metadata and compressed-block caches.
  while (readers.size > 12) readers.delete(readers.keys().next().value!);
  return raster;
}
async function regio() {
  if (!regioURL) {
    const item = await json(STAC + 'ch.swisstopo.swissaltiregio/items/swissaltiregio');
    regioURL = item.assets?.['swissaltiregio_2056_5728.tif']?.href;
    if (!regioURL?.startsWith('https://data.geo.admin.ch/')) throw Error('Regional elevation asset missing');
  }
  return open(regioURL, true);
}
const inventories = new Map<string, {bounds: Bounds; assets: Map<string, Asset>}>();
const decoded = new WeakMap<Raster, ArrayLike<number>>();
async function discover(bounds: Bounds, key: string) {
  // Cache spatial catalogue cells rather than one query per display tile.
  for(const entry of inventories.values()) if(bounds[0]>=entry.bounds[0] && bounds[1]>=entry.bounds[1] && bounds[2]<=entry.bounds[2] && bounds[3]<=entry.bounds[3]) return entry.assets;
  bounds=[Math.floor(bounds[0]/4000)*4000,Math.floor(bounds[1]/4000)*4000,Math.ceil(bounds[2]/4000)*4000,Math.ceil(bounds[3]/4000)*4000];
  key=bounds.join('/');
  const points: number[][] = [];
  for (let step = 0; step <= 8; step++) {
    const x = bounds[0] + (bounds[2] - bounds[0]) * step / 8;
    const y = bounds[1] + (bounds[3] - bounds[1]) * step / 8;
    points.push(toLonLat.forward([x, bounds[1]]), toLonLat.forward([x, bounds[3]]), toLonLat.forward([bounds[0], y]), toLonLat.forward([bounds[2], y]));
  }
  const bbox = [Math.min(...points.map(p => p[0])) - 0.00001, Math.min(...points.map(p => p[1])) - 0.00001, Math.max(...points.map(p => p[0])) + 0.00001, Math.max(...points.map(p => p[1])) + 0.00001];
  let url: string | undefined = STAC + `ch.swisstopo.swissalti3d/items?bbox=${bbox.join(',')}&limit=100`;
  const features: any[] = [];
  const visited = new Set<string>();
  while (url) {
    if (!url.startsWith(STAC) || visited.has(url) || visited.size >= 8) throw Error('Incomplete elevation catalogue');
    visited.add(url);
    const page = await json(url);
    if (!Array.isArray(page.features)) throw Error('Invalid catalogue');
    features.push(...page.features);
    url = page.links?.find((l: any) => l.rel === 'next')?.href;
  }
  const selected = selectDetailAssets(features);
  inventories.set(key, {bounds, assets: selected});
  while (inventories.size > 64) inventories.delete(inventories.keys().next().value!);
  return selected;
}
async function sample(raster: Raster, level: number, indices: number[], coords: Float64Array, output: Float32Array) {
  const image = raster.images[level];
  const [left, bottom, right, top] = raster.bounds;
  const sx = (right - left) / image.getWidth(), sy = (top - bottom) / image.getHeight();
  let x0 = image.getWidth(), y0 = image.getHeight(), x1 = -1, y1 = -1;
  const pixels: [number, number, number][] = [];
  for (const index of indices) {
    const x = Math.floor((coords[index * 2] - left) / sx), y = Math.floor((top - coords[index * 2 + 1]) / sy);
    if (x < 0 || y < 0 || x >= image.getWidth() || y >= image.getHeight()) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    pixels.push([index, x, y]);
  }
  if (!pixels.length) return;
  // Detailed source squares are 500² samples (1 MiB). Decode each resident
  // square once instead of repeatedly decoding overlapping display windows.
  const completeSource = raster.images.length===1 && image.getWidth()*image.getHeight()<=1024*1024;
  if(completeSource) {x0=0;y0=0;x1=image.getWidth()-1;y1=image.getHeight()-1;}
  const width = x1 - x0 + 1, height = y1 - y0 + 1;
  if (width * height > 1024 * 1024) throw Error('Elevation window exceeds memory budget');
  let values = completeSource ? decoded.get(raster) : undefined;
  if(!values) {
    values = await image.readRasters({window: [x0, y0, x1 + 1, y1 + 1], samples: [0], interleave: true, signal: activeSignal});
    if(completeSource) decoded.set(raster,values);
  }
  for (const [index, x, y] of pixels) {
    const value = Number(values[(y - y0) * width + x - x0]);
    if (validHeight(value, raster.nodata)) output[index] = value;
  }
}
async function tile(z: number, x: number, y: number) {
  const extent = tileExtent(z, x, y), step = (extent[2] - extent[0]) / TILE_SIZE;
  const coords = new Float64Array(TILE_SIZE * TILE_SIZE * 2);
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let row = 0; row < TILE_SIZE; row++) for (let col = 0; col < TILE_SIZE; col++) {
    const i = row * TILE_SIZE + col;
    const [e, n] = toSwiss.forward([extent[0] + (col + 0.5) * step, extent[3] - (row + 0.5) * step]);
    coords[i * 2] = e; coords[i * 2 + 1] = n;
    bounds[0] = Math.min(bounds[0], e); bounds[1] = Math.min(bounds[1], n); bounds[2] = Math.max(bounds[2], e); bounds[3] = Math.max(bounds[3], n);
    all.push(i);
    if(z>=DETAIL_ZOOM) {
      const key = `${Math.floor(e / 1000)}/${Math.floor(n / 1000)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    }
  }
  const output = missingTile();
  let spacing = 2, failures = 0;
  if (z < DETAIL_ZOOM) {
    const raster = await regio();
    const groundSpacing = step / Math.cosh((extent[1] + extent[3]) / 2 / 6378137);
    const baseSpacing = (raster.bounds[2] - raster.bounds[0]) / raster.widths[0];
    const level = overviewIndex(raster.widths, raster.widths[0], baseSpacing, groundSpacing);
    spacing = baseSpacing * raster.widths[0] / raster.widths[level];
    await sample(raster, level, all, coords, output);
  } else {
    const selected = await discover(bounds, `${z}/${x}/${y}`);
    for (const [key, indices] of groups) {
      activeSignal.throwIfAborted();
      const asset = selected.get(key);
      if (!asset) continue; // No known 2 m data is explicitly missing, never zero or a hidden fallback.
      try {await sample(await open(asset.url, false), 0, indices, coords, output);}
      catch (error) {activeSignal.throwIfAborted(); readers.delete(asset.url); failures++;}
    }
  }
  return {data: output, spacing, failures, missing: output.reduce((n, h) => n + Number(h === NODATA), 0)};
}
self.onmessage = async (event: MessageEvent) => {
  if (event.data.cancel) {current?.abort(); return;}
  const {id, z, x, y} = event.data;
  current = new AbortController();
  activeSignal = AbortSignal.any([current.signal, AbortSignal.timeout(60000)]);
  transferred = 0;
  try {
    const result = await tile(z, x, y);
    activeSignal.throwIfAborted();
    self.postMessage({id, ...result, bytes: transferred}, {transfer: [result.data.buffer]});
  } catch (error) {
    readers.clear();
    self.postMessage({id, error: error instanceof Error ? error.message : String(error), bytes: transferred});
  } finally {current = undefined;}
};
