import {createNativeGrid, hasNativeGrid} from './nativeGrid';
import {PacketStore} from './packetStore';
import {decodeBands} from './bands';
import {inflateBytes} from './bandDecoder';
import {missingTile, tileExtent} from './math';
import {Capacity, readExact} from './transfer';
import type {TileResult} from './workerPool';

// The normal map follows one source rule at every Swiss coordinate.
export const NATIONAL_DETAIL_ZOOM = 13;
export const NATIONAL_MAX_ZOOM = hasNativeGrid ? 19 : 16;
interface Level {
  z: number;
  group: number;
  bounds: [number, number, number, number];
  lengths: Record<string, number>;
  packs: Record<string, string>;
}
const manifests = import.meta.glob<string>('./national-index/*.json', {
  eager: true, import: 'default', query: '?url&no-inline',
});
const BYTE_BUDGET = 12 * 1024 * 1024;

export function createNationalTerrain() {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debugTiles');
  const requested = debug ? Number(params.get('terrainRequests')) : 4;
  const network = new Capacity([2,4,6].includes(requested) ? requested : 4);
  const workerCount = debug ? Number(params.get('decodeWorkers')) : 0;
  const idleWorkers: Worker[] = [];
  const trace: {stage:string; key:string; start:number; ms:number; bytes:number}[] = [];
  function record(stage:string, key:string, start:number, bytes=0) {
    if (!debug) return;
    trace.push({stage,key,start,ms:performance.now()-start,bytes});
    if (trace.length>512) trace.shift();
  }
  const packets = new PacketStore(BYTE_BUDGET);
  const native = createNativeGrid(packets,network,async (bytes,signal)=>{
    const release=await decodes.acquire(1,signal);
    try {return new Int16Array(await decode(bytes,signal,125000));}
    finally {release();}
  },record);
  const decodes = new Capacity(workerCount===1 ? 1 : 2);
  const levels = new Map<number, Promise<Level>>();
  let controller = new AbortController();

  async function decode(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal, size:number) {
    if (workerCount!==1 && workerCount!==2) return inflateBytes(bytes,size);
    signal.throwIfAborted();
    const worker = idleWorkers.pop() ?? new Worker(new URL('./bandDecoder.worker.ts', import.meta.url), {type:'module'});
    try {
      const result = await new Promise<ArrayBuffer>((resolve,reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort',abort,{once:true});
        worker.onerror = event => {signal.removeEventListener('abort',abort); reject(Error(event.message));};
        worker.onmessage = ({data}) => {
          signal.removeEventListener('abort',abort);
          if (data.error) reject(Error(data.error));
          else resolve(data);
        };
        const copy = bytes.slice();
        worker.postMessage({bytes:copy,size},[copy.buffer]);
      });
      worker.onerror = null;
      worker.onmessage = null;
      idleWorkers.push(worker);
      return result;
    } catch (error) {
      worker.terminate();
      throw error;
    }
  }

  function level(z: number) {
    const existing = levels.get(z);
    if (existing) return existing;
    const url = manifests[`./national-index/${z}.json`];
    if (!url) throw Error(`National terrain index missing for zoom ${z}`);
    const request = (async () => {
      const response = await fetch(url, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])});
      if (!response.ok) throw Error(`National index HTTP ${response.status}`);
      const index: Level = await response.json();
      if (index.z !== z || ![1,2,4,8].includes(index.group) || !index.lengths || !index.packs || index.bounds?.length !== 4) {
        throw Error('Invalid national terrain index');
      }
      return index;
    })();
    levels.set(z, request);
    request.catch(() => {if (levels.get(z) === request) levels.delete(z);});
    return request;
  }

  async function fetchPacket(path: string, group: number, size: number, signal: AbortSignal) {
    const queued = performance.now();
    const releaseNetwork = await network.acquire(1, signal);
    try {
      record('queue',path,queued);
      const start = performance.now();
      const response = await fetch(`${import.meta.env.BASE_URL}terrain/${path}.pack`, {signal});
      if (!response.ok) throw Error(`National terrain HTTP ${response.status}`);
      if (!response.body) throw Error('Empty terrain response');
      const buffer = await readExact(response.body, size);
      record('fetch',path,start,size);
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
      return buffer;
    } finally {releaseNetwork();}
  }

  return {
    async load(z: number, x: number, y: number, signal: AbortSignal): Promise<TileResult> {
      if (hasNativeGrid && z>=NATIONAL_DETAIL_ZOOM) {
        const start=performance.now();
        const result=await native.load(z,x,y,AbortSignal.any([signal,controller.signal,AbortSignal.timeout(20000)]));
        record('native',`${z}/${x}/${y}`,start);
        return result;
      }
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
      const size = index.lengths[`${gx}/${gy}`];
      const fetchSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]);
      return packets.read(path,size,fetchSignal, () => fetchPacket(path,g,size,fetchSignal), async buffer => {
        signal.throwIfAborted();
        const slot = (y-gy*g)*g + (x-gx*g);
        const header = new DataView(buffer);
        const start = header.getUint32(4*slot,true), end = header.getUint32(4*(slot+1),true);
        if (start===end) return empty();
        const release = await decodes.acquire(1,signal);
        try {
          const began = performance.now();
          const decoded = decodeBands(await decode(new Uint8Array(buffer,start,end-start),signal,131072));
          record('decode',`${z}/${x}/${y}`,began,end-start);
          signal.throwIfAborted();
          return {...decoded,spacing,failures:0,bytes:end-start};
        } finally {release();}
      });
    },
    diagnostics: () => ({networkPeak:network.peak,packetPeak:packets.peak,decodePeak:decodes.peak,compressed:packets.used,native:native.memory(),trace}),
    clear() {
      for (const worker of idleWorkers.splice(0)) worker.terminate();
      controller.abort();
      controller = new AbortController();
      levels.clear();
      packets.clear();
      native.clear();
    },
  };
}
