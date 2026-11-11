import {NODATA, validHeight} from './math';
import {preparedPayload} from './prepared';
import type {TileResult} from './workerPool';

// Vite fingerprints individual tiles. Fetch only those needed for the view.
const urls = import.meta.glob<string>('./overview/*.bin.gz', {
  eager: true, query: '?url&no-inline', import: 'default',
});

export function overviewUrl(z: number, x: number, y: number) {
  return urls[`./overview/${z}-${x}-${y}.bin.gz`];
}

export async function loadOverview(url: string, signal: AbortSignal): Promise<TileResult> {
  const buffer = await preparedPayload(url, AbortSignal.any([signal, AbortSignal.timeout(10000)]));
  if (buffer.byteLength !== 8 + 65536 * 4) throw Error('Invalid national overview length');
  const view = new DataView(buffer);
  const spacing = view.getFloat64(0, true);
  if (!Number.isFinite(spacing) || spacing <= 0) throw Error('Invalid overview spacing');
  const data = new Float32Array(65536);
  let missing = 0;
  for (let i = 0; i < data.length; i++) {
    const height = view.getFloat32(8 + 4 * i, true);
    if (height === NODATA) missing++;
    else if (!validHeight(height, null)) throw Error('Invalid overview sample');
    data[i] = height;
  }
  return {data, spacing, missing, failures: 0, bytes: buffer.byteLength};
}
