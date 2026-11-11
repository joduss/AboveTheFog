import type {TileResult} from './workerPool';

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {clearTimeout(timer); reject(signal.reason);};
    const timer = setTimeout(() => {signal.removeEventListener('abort', abort); resolve();}, ms);
    signal.addEventListener('abort', abort, {once: true});
  });
}

/** Retry transport/decoder failures, never genuine source nodata. */
export async function retryTile(load: () => Promise<TileResult>, signal: AbortSignal, delays = [500, 1500, 3500]): Promise<TileResult> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const result = await load();
      signal.throwIfAborted();
      if (!result.failures || attempt === delays.length) return result;
    } catch (error) {
      signal.throwIfAborted();
      // These mean the job is obsolete, rather than a failed data request.
      if (attempt === delays.length || (error instanceof Error && ['View changed', 'Cancelled', 'Disposed', 'Renderer unavailable'].includes(error.message))) throw error;
    }
    await pause(delays[attempt], signal);
  }
}
