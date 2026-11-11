import {Capacity} from './transfer.ts';

interface Entry {
  data: Promise<ArrayBuffer>;
  readers: number;
  size: number;
  release?: () => void;
}

/** One reservation follows a packet from download through its last reader. */
export class PacketStore {
  private entries = new Map<string, Entry>();
  private capacity: Capacity;
  private waiting = 0;
  private limit: number;
  constructor(limit: number) {
    this.limit = limit;
    this.capacity = new Capacity(limit);
  }
  get used() {return this.capacity.used;}
  get peak() {return this.capacity.peak;}

  async read<T>(key: string, size: number, signal: AbortSignal,
                fetchPacket: () => Promise<ArrayBuffer>, consume: (buffer: ArrayBuffer) => Promise<T>) {
    signal.throwIfAborted();
    let entry = this.entries.get(key);
    if (!entry) {
      for (const [oldKey, old] of this.entries) {
        if (this.used + size <= this.limit) break;
        if (!old.readers) this.remove(oldKey, old);
      }
      const created: Entry = {readers: 0, size, data: Promise.resolve(new ArrayBuffer(0))};
      created.data = (async () => {
        this.waiting++;
        try {created.release = await this.capacity.acquire(size, signal);}
        finally {this.waiting--;}
        signal.throwIfAborted();
        return fetchPacket();
      })();
      this.entries.set(key, created);
      entry = created;
    } else {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    entry.readers++;
    try {
      return await consume(await entry.data);
    } catch (error) {
      if (this.entries.get(key)===entry) this.entries.delete(key);
      throw error;
    } finally {
      entry.readers--;
      if (!entry.readers && (this.waiting || this.entries.get(key)!==entry)) this.remove(key,entry);
    }
  }
  private remove(key: string, entry: Entry) {
    if (this.entries.get(key)===entry) this.entries.delete(key);
    entry.release?.();
    entry.release = undefined;
  }
  clear() {
    for (const [key, entry] of this.entries) {
      this.entries.delete(key);
      if (!entry.readers) this.remove(key,entry);
    }
  }
}
