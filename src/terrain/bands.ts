import {NODATA} from './math.ts';
export const BAND_NODATA = -32768;
export function decodeBands(buffer: ArrayBuffer) {
  if (buffer.byteLength !== 256 * 256 * 2) throw Error('Invalid prepared tile length');
  const input = new DataView(buffer), data = new Float32Array(65536);
  let missing = 0;
  for (let i=0; i<data.length; i++) {
    const band = input.getInt16(i*2,true);
    if (band === BAND_NODATA) {data[i] = NODATA; missing++;}
    else if (band < -50 || band > 999) throw Error('Invalid prepared band');
    else data[i] = band * 10;
  }
  return {data, missing};
}
