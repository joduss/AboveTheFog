import {nativePositions} from './nativePositions';
import type {TileResult} from './workerPool';
import {NODATA} from './math';
import {readExact, Capacity} from './transfer';
import type {PacketStore} from './packetStore';

type FileRef = [string, number];
type Point = [number, number];
interface Release {version: number; pages: Record<string, FileRef>}
interface Page {x: number; y: number; controls: Point[]; blocks: Record<string, FileRef>}
const releases = import.meta.glob<string>('./native-index/release.json', {
  eager:true, import:'default', query:'?url&no-inline',
});
const releaseUrl = Object.values(releases)[0];
export const hasNativeGrid = !!releaseUrl;


export function createNativeGrid(packets: PacketStore, network: Capacity,
  inflate: (bytes:Uint8Array<ArrayBuffer>,signal:AbortSignal)=>Promise<Int16Array>,
  record: (stage:string,key:string,start:number,bytes?:number)=>void) {
  let release: Promise<Release> | undefined;
  const pages = new Map<string,Promise<Page>>();
  const active = new Map<string,Promise<Int16Array>>();
  const decoded = new Map<string,Int16Array>();
  const staging = new Capacity(12*1024*1024);
  let generation = 0;
  const base = import.meta.env.BASE_URL+'terrain/native/';
  async function fetchFile(kind:string, ref:FileRef, signal:AbortSignal) {
    const queued=performance.now();
    const unlock = await network.acquire(1,signal);
    try {
      const [hash,n] = ref, suffix = kind==='blocks' ? '.band' : '.json';
      const url = base+kind+'/'+hash.slice(0,2)+'/'+hash+suffix;
      record('queue',hash,queued);
      const start=performance.now();
      const response = await fetch(url,{signal,cache:'force-cache'});
      if (!response.ok || !response.body) throw Error(`Native terrain HTTP ${response.status}`);
      const body=await readExact(response.body,n);
      record('fetch',hash,start,n);
      return body;
    } finally {unlock();}
  }
  function square(ref: FileRef, signal:AbortSignal) {
    const key = ref[0];
    const hit = decoded.get(key);
    if (hit) {decoded.delete(key); decoded.set(key,hit); return Promise.resolve(hit);}
    const existing = active.get(key);
    if (existing) return existing;
    const epoch = generation;
    const job = packets.read(key,ref[1],signal,()=>fetchFile('blocks',ref,signal),async bytes => {
      const start=performance.now();
      const values=await inflate(new Uint8Array(bytes),signal);
      record('decode',key,start,ref[1]);
      if (generation===epoch) {
        decoded.set(key,values);
        if (decoded.size>8) decoded.delete(decoded.keys().next().value!);
      }
      return values;
    }).finally(()=>{if(active.get(key)===job) active.delete(key);});
    active.set(key,job);
    return job;
  }
  return {
    async load(z:number,x:number,y:number,signal:AbortSignal):Promise<TileResult> {
      if (!release) {
        const job = fetch(releaseUrl,{signal}).then(async response=>{
          if (!response.ok) throw Error(`Native index HTTP ${response.status}`);
          const value: Release = await response.json();
          if (value.version!==1 || !value.pages) throw Error('Invalid native release');
          return value;
        });
        release=job;
        job.catch(()=>{if(release===job) release=undefined;});
      }
      const index = await release;
      const scale=2**(z-12), px=Math.floor(x/scale),py=Math.floor(y/scale);
      const ref = index.pages[`${px}/${py}`];
      const empty = () => ({data:new Float32Array(65536).fill(NODATA),spacing:4,missing:65536,bytes:0,failures:0});
      if (!ref) return empty();
      let job = pages.get(ref[0]);
      if (!job) {
        job=fetchFile('pages',ref,signal).then(bytes=>{
          const value:Page=JSON.parse(new TextDecoder().decode(bytes));
          if (value.x!==px || value.y!==py || value.controls.length!==81) throw Error('Invalid native placement');
          return value;
        });
        pages.set(ref[0],job);
        if (pages.size>16) pages.delete(pages.keys().next().value!);
        const current=job;
        job.catch(()=>{if(pages.get(ref[0])===current) pages.delete(ref[0]);});
      }
      const page=await job;
      // Bound mapping arrays, output, and source blocks even when a z13 tile
      // overlaps several kilometres. Reservations precede all allocations.
      const km = Math.ceil(40075017/2**z/1000)+2;
      const unlock=await staging.acquire(65536*10 + km*km*125000,signal);
      try {
        const {blocks,indices,keys}=nativePositions(page,z,x,y);
        const samples=new Map<number,Int16Array>();
        // Wait for every started consumer before returning its staging budget.
        const results = await Promise.allSettled([...keys].map(async id=>{
          const file=page.blocks[`${Math.floor(id/4096)}/${id%4096}`];
          if (file) samples.set(id,await square(file,signal));
        }));
        for (const result of results) if (result.status==='rejected') throw result.reason;
        signal.throwIfAborted();
        const data=new Float32Array(65536);
        let missing=0;
        for (let i=0;i<data.length;i++) {
          const band=samples.get(blocks[i])?.[indices[i]] ?? -32768;
          if (band===-32768) {data[i]=NODATA;missing++;}
          else data[i]=band*10;
        }
        return {data,missing,spacing:4,failures:0,bytes:0};
      } finally {unlock();}
    },
    clear() {generation++;release=undefined;pages.clear();decoded.clear();active.clear();},
    memory:()=>({staging:staging.used,peak:staging.peak,squareBytes:decoded.size*125000}),
  };
}
