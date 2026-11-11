import type {TileResult} from './workerPool';
const NAME = 'terrain-samples-v1';
const AGE = 7 * 86400000;
const LIMIT = 192; // About 48 MiB of samples, plus metadata.
const url = (key: string) => new URL(`/__terrain_cache__/${key}`, location.origin).href;
export async function readTile(key: string, timeout = 1500): Promise<TileResult | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // CacheStorage can stay pending (for example while its backing store is
    // unavailable). Treat it as an optional optimization, even in that case.
    return await Promise.race([
      readStoredTile(key),
      new Promise<undefined>(resolve => {timer = setTimeout(resolve, timeout);}),
    ]);
  } finally {clearTimeout(timer);}
}
async function readStoredTile(key: string): Promise<TileResult | undefined> {
  try {
    const cache = await caches.open(NAME), response = await cache.match(url(key));
    if (!response) return;
    if (Date.now() - Number(response.headers.get('saved')) > AGE) {await cache.delete(url(key)); return;}
    const data = new Float32Array(await response.arrayBuffer());
    const spacing = Number(response.headers.get('spacing'));
    if (data.length !== 65536 || !Number.isFinite(spacing) || spacing <= 0) return;
    return {data, spacing, missing: 0, failures: 0, bytes: 0};
  } catch {return;} // Private mode, quota and unavailable storage must not block the map.
}
let writes = Promise.resolve();
let reserved = 0;
const WRITE_BUDGET = 2 * 1024 * 1024;
export function writeTile(key: string, result: TileResult) {
  if (result.missing || result.failures) return;
  const size = result.data.byteLength * 2;
  if (reserved + size > WRITE_BUDGET) return;
  reserved += size;
  writes = writes.then(async () => {
    const cache = await caches.open(NAME);
    await cache.put(url(key), new Response(result.data.slice().buffer, {headers: {saved: String(Date.now()), spacing: String(result.spacing)}}));
    const keys = await cache.keys();
    for (const request of keys.slice(0, Math.max(0, keys.length - LIMIT))) await cache.delete(request);
  }).catch(() => {}).finally(() => {reserved -= size;});
}
