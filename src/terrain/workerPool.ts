export interface TileResult {data: Float32Array; spacing: number; failures: number; missing: number; bytes: number}
interface Job {id: number; z: number; x: number; y: number; resolve: (result: TileResult) => void; reject: (error: Error) => void; signal: AbortSignal; cleanup: () => void}
interface Slot {worker: Worker; job?: Job; timer?: ReturnType<typeof setTimeout>}
export class TerrainWorkers {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextID = 0;
  private score: (job: Job) => number = () => 0;
  private disposed = false;
  private timeout: number;
  constructor(count = 2, timeout = 65000) {
    this.timeout = timeout;
    for (let i = 0; i < count; i++) {
      const slot: Slot = {worker: this.makeWorker()};
      this.bind(slot);
      this.slots.push(slot);
    }
  }
  private makeWorker() {return new Worker(new URL('./elevation.worker.ts', import.meta.url), {type: 'module'});}
  private restart(slot: Slot, error: Error) {
    clearTimeout(slot.timer);
    slot.job?.cleanup(); slot.job?.reject(error); slot.job = undefined;
    slot.worker.terminate();
    if (!this.disposed) {slot.worker = this.makeWorker(); this.bind(slot);}
  }
  private bind(slot: Slot) {
    slot.worker.onmessage = event => {
      const job = slot.job;
      if (!job || event.data.id !== job.id) return;
      clearTimeout(slot.timer);
      job.cleanup();
      slot.job = undefined;
      if (job.signal.aborted || event.data.error) job.reject(new Error(event.data.error ?? 'Cancelled'));
      else job.resolve(event.data);
      this.pump();
    };
    slot.worker.onerror = event => {
      this.restart(slot, new Error(event.message || 'Elevation worker failed'));
      this.pump();
    };
  }
  load(z: number, x: number, y: number, signal: AbortSignal): Promise<TileResult> {
    if (this.disposed || signal.aborted) return Promise.reject(new Error('Cancelled'));
    return new Promise((resolve, reject) => {
      const job: Job = {id: ++this.nextID, z, x, y, resolve, reject, signal, cleanup: () => signal.removeEventListener('abort', cancel)};
      const cancel = () => {
        const slot = this.slots.find(s => s.job === job);
        if (slot) {this.restart(slot, new Error('Cancelled')); this.pump();}
        else {this.queue = this.queue.filter(j => j !== job); job.cleanup(); reject(new Error('Cancelled'));}
      };
      signal.addEventListener('abort', cancel, {once: true});
      this.queue.push(job);
      this.queue.sort((a,b) => this.score(a)-this.score(b));
      this.pump();
    });
  }
  prioritize(z: number, minX: number, minY: number, maxX: number, maxY: number) {
    const visible = (job: Job) => job.z === z && job.x >= minX && job.x <= maxX && job.y >= minY && job.y <= maxY;
    const stale = this.queue.filter(job => !visible(job));
    this.queue = this.queue.filter(visible);
    for (const job of stale) {job.cleanup(); job.reject(new Error('View changed'));}
    // Decoders and queued TIFF range reads may not acknowledge an abort. Release
    // obsolete slots immediately so visible tiles never wait for that reply.
    for (const slot of this.slots) if (slot.job && !visible(slot.job)) this.restart(slot, new Error('View changed'));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.score = job => (job.x-cx)**2 + (job.y-cy)**2;
    this.queue.sort((a,b) => this.score(a)-this.score(b));
    this.pump();
  }
  private pump() {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift()!;
      slot.job = job;
      // A worker-side AbortSignal cannot recover a stalled decoder or worker.
      slot.timer = setTimeout(() => {
        this.restart(slot, new Error('Elevation tile timed out'));
        this.pump();
      }, this.timeout);
      slot.worker.postMessage({id: job.id, z: job.z, x: job.x, y: job.y});
    }
  }
  dispose() {
    this.disposed = true;
    for (const slot of this.slots) this.restart(slot, new Error('Disposed'));
    for (const job of this.queue) {job.cleanup(); job.reject(new Error('Disposed'));}
    this.queue = [];
  }
}
