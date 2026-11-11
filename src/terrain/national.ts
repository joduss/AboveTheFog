import {decodeBands} from './bands';
import {missingTile, tileExtent} from './math';
import {readTile, writeTile} from './tileCache';
import type {TileResult} from './workerPool';

// The normal map follows one source rule at every Swiss coordinate.
export const NATIONAL_DETAIL_ZOOM = 13;
export const NATIONAL_MAX_ZOOM = 16;
interface Level {
  z: number;
  group: number;
  bounds: [number, number, number, number];
  packs: Record<string, string>;
}
const manifests = import.meta.glob<string>('./national-index/*.json', {
  eager: true, import: 'default', query: '?url&no-inline',
});
const BYTE_BUDGET = 12 * 1024 * 1024;

export function createNationalTerrain() {
  const levels = new Map<number, Promise<Level>>();
  const pending = new Map<string, Promise<ArrayBuffer>>();
  const resident = new Map<string, ArrayBuffer>();
  let bytes = 0;
  let controller = new AbortController();

  function level(z: number) {
    const existing = levels.get(z);
    if (existing) return existing;
    const url = manifests[`./national-index/${z}.json`];
    if (!url) throw Error(`National terrain index missing for zoom ${z}`);
    const request = (async () => {
      const response = await fetch(url, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])});
      if (!response.ok) throw Error(`National index HTTP ${response.status}`);
      const index: Level = await response.json();
      if (index.z !== z || ![4,8].includes(index.group) || !index.packs || index.bounds?.length !== 4) {
        throw Error('Invalid national terrain index');
      }
      return index;
    })();
    levels.set(z, request);
    request.catch(() => {if (levels.get(z) === request) levels.delete(z);});
    return request;
  }

  function packet(path: string, group: number) {
    const hit = resident.get(path);
    if (hit) {
      resident.delete(path);
      resident.set(path, hit);
      return Promise.resolve(hit);
    }
    const existing = pending.get(path);
    if (existing) return existing;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
    const request = (async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}terrain/${path}.pack`, {signal});
      if (!response.ok) throw Error(`National terrain HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const count = group*group, headerSize = (count+1)*4;
      if (buffer.byteLength < headerSize || buffer.byteLength > BYTE_BUDGET) throw Error('Invalid national terrain packet size');
      const header = new DataView(buffer);
      let previous = header.getUint32(0, true);
      if (previous !== headerSize) throw Error('Invalid national terrain header');
      for (let i = 1; i <= count; i++) {
        const next = header.getUint32(i*4, true);
        if (next < previous || next > buffer.byteLength) throw Error('Invalid terrain tile bounds');
        previous = next;
      }
      if (previous !== buffer.byteLength) throw Error('Incomplete national terrain packet');
      signal.throwIfAborted();
      resident.set(path, buffer);
      bytes += buffer.byteLength;
      while (bytes > BYTE_BUDGET) {
        const oldest = resident.keys().next().value!;
        bytes -= resident.get(oldest)!.byteLength;
        resident.delete(oldest);
      }
      return buffer;
    })();
    pending.set(path, request);
    const settle = () => {if (pending.get(path) === request) pending.delete(path);};
    request.then(settle, settle);
    return request;
  }

  return {
    async load(z: number, x: number, y: number, signal: AbortSignal, bypassCache: boolean): Promise<TileResult> {
      const index = await level(z);
      signal.throwIfAborted();
      const g = index.group, gx = Math.floor(x/g), gy = Math.floor(y/g);
      const digest = index.packs[`${gx}/${gy}`];
      const extent = tileExtent(z,x,y);
      const spacing = Math.max(z >= NATIONAL_DETAIL_ZOOM ? 4 : 10,
        (extent[2]-extent[0])/256/Math.cosh((extent[1]+extent[3])/2/6378137));
      const empty = () => ({data: missingTile(), missing: 65536, failures: 0, spacing, bytes: 0});
      if (!digest) return empty();
      const path = `${z}/${gx}/${gy}-${digest}`;
      const key = `national-v1/${digest}/${z}/${x}/${y}`;
      const cached = bypassCache ? undefined : await readTile(key, 40);
      signal.throwIfAborted();
      if (cached) return cached;
      const buffer = await packet(path, g);
      signal.throwIfAborted();
      const slot = (y-gy*g)*g + (x-gx*g);
      const header = new DataView(buffer);
      const start = header.getUint32(4*slot, true), end = header.getUint32(4*(slot+1), true);
      if (start === end) return empty();
      const compressed = new Blob([new Uint8Array(buffer, start, end-start)]);
      let decoded: ReturnType<typeof decodeBands>;
      try {
        const samples = await new Response(compressed.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        decoded = decodeBands(samples);
      } catch (error) {
        // Fetch fresh bytes on the bounded retry if storage or transport
        // returned a corrupt gzip member.
        if (resident.get(path) === buffer) {
          resident.delete(path);
          bytes -= buffer.byteLength;
        }
        throw error;
      }
      signal.throwIfAborted();
      const result = {...decoded, spacing, failures: 0, bytes: end-start};
      writeTile(key, result);
      return result;
    },
    clear() {
      controller.abort();
      controller = new AbortController();
      levels.clear();
      pending.clear();
      resident.clear();
      bytes = 0;
    },
  };
}
