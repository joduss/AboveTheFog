import type {TileResult} from './workerPool';

/** Shared, bounded decoded tiles: speculative loads and visible loads reuse one job. */
export class ResidentTiles {
  private ready = new Map<string, TileResult>();
  private generation = 0;
  private pending = new Map<string, Promise<TileResult>>();
  private limit: number;
  constructor(limit = 64) {this.limit=limit;} // At most 16 MiB of Float32 samples.
  load(key: string, loader: () => Promise<TileResult>): Promise<TileResult> {
    const value = this.ready.get(key);
    if (value) {this.ready.delete(key);this.ready.set(key,value);return Promise.resolve(value);}
    const existing = this.pending.get(key);
    if (existing) return existing;
    const generation=this.generation;
    const job = loader().then(result => {
      if (generation===this.generation && !result.missing && !result.failures) {
        this.ready.set(key,result);
        while(this.ready.size>this.limit) this.ready.delete(this.ready.keys().next().value!);
      }
      return result;
    }).finally(()=>{if(this.pending.get(key)===job)this.pending.delete(key);});
    this.pending.set(key,job);
    return job;
  }
  forEachBuffer(visit: (buffer:ArrayBufferLike)=>void) {
    this.ready.forEach(result=>visit(result.data.buffer));
  }
  clear() {this.generation++;this.ready.clear();this.pending.clear();}
}
