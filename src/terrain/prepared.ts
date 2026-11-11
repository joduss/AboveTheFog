import {tileExtent, type Bounds} from './math';
import type {TileResult} from './workerPool';

export {BAND_NODATA} from './bands';
import {decodeBands} from './bands';
import index from './prepared-index.json';
export const preparedMode = new URLSearchParams(location.search).get('prepared') ?? 'national';
// Pilot rasters and vectors remain available only for the explicit comparison.
export const nationalMode = !['off', 'pilot', 'vector'].includes(preparedMode);
export const preparedAreas = index.areas.map(area => ({...area, bounds: area.coverage as Bounds}));
export function preparedArea(z: number, x: number, y: number) {
  if (nationalMode || preparedMode === 'off') return undefined;
  const b = tileExtent(z,x,y);
  return preparedAreas.find(a => z >= a.minZoom && z <= a.maxZoom && b[0] >= a.bounds[0] - 1e-7 && b[1] >= a.bounds[1] - 1e-7 && b[2] <= a.bounds[2] + 1e-7 && b[3] <= a.bounds[3] + 1e-7);
}
// Both plain gzip files and servers that apply Content-Encoding: gzip are supported.
export async function preparedPayload(url: string, signal: AbortSignal) {
  const response = await fetch(url, {signal});
  if (!response.ok) throw Error(`Prepared tile HTTP ${response.status}`);
  let bytes = await response.arrayBuffer();
  if (bytes.byteLength > 8_000_000) throw Error('Prepared tile exceeds size limit');
  const header = new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
  if (header[0] === 31 && header[1] === 139) bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if (bytes.byteLength > 32_000_000) throw Error('Decoded prepared tile exceeds size limit');
  return bytes;
}
export async function loadPrepared(id: string, z: number, x: number, y: number, signal: AbortSignal): Promise<TileResult> {
  const buffer = await preparedPayload(`${import.meta.env.BASE_URL}prepared/${id}/raster/${z}/${x}/${y}.i16.gz?v=${preparedAreas.find(a=>a.id===id)?.fingerprint}`, AbortSignal.any([signal,AbortSignal.timeout(20000)]));
  return {...decodeBands(buffer), spacing: Math.max(4, (tileExtent(z,x,y)[2]-tileExtent(z,x,y)[0])/256 / Math.cosh((tileExtent(z,x,y)[1]+tileExtent(z,x,y)[3])/2/6378137)), failures: 0, bytes: buffer.byteLength};
}
