// Reserve capacity before starting work. Abort wakes queued callers even if all
// current owners are blocked on the network.
export class Capacity {
  used = 0;
  peak = 0;
  private changed = new EventTarget();
  private limit: number;
  constructor(limit: number) {this.limit = limit;}
  async acquire(size: number, signal: AbortSignal) {
    if (!Number.isSafeInteger(size) || size <= 0 || size > this.limit) throw Error('Invalid terrain reservation');
    while (true) {
      signal.throwIfAborted();
      if (this.used + size <= this.limit) break;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          this.changed.removeEventListener('release', wake);
          signal.removeEventListener('abort', cancel);
        };
        const wake = () => {cleanup(); resolve();};
        const cancel = () => {cleanup(); reject(signal.reason);};
        this.changed.addEventListener('release', wake);
        signal.addEventListener('abort', cancel);
      });
    }
    this.used += size;
    this.peak = Math.max(this.peak, this.used);
    return () => {this.used -= size; this.changed.dispatchEvent(new Event('release'));};
  }
}

export async function readExact(stream: ReadableStream<Uint8Array>, size: number) {
  const reader = stream.getReader();
  const buffer = new Uint8Array(size);
  let offset = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (value.length > size - offset) throw Error('Oversized terrain payload');
      buffer.set(value, offset);
      offset += value.length;
    }
    if (offset !== size) throw Error('Incomplete terrain payload');
    return buffer.buffer;
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {reader.releaseLock();}
}
