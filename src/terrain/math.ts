export const TILE_SIZE = 256;
export const DETAIL_ZOOM = 15;
export const MAX_ZOOM = 17;
export const NODATA = -99999;
export const WORLD = 20037508.342789244;
export const SWISS_BOUNDS = [5.95, 45.8, 10.5, 47.85];
export type Bounds = [number, number, number, number];
export function tileExtent(z: number, x: number, y: number): Bounds {
  const span = 2 * WORLD / 2 ** z;
  return [-WORLD + x * span, WORLD - (y + 1) * span, -WORLD + (x + 1) * span, WORLD - y * span];
}
export function overviewIndex(widths: number[], baseWidth: number, baseSpacing: number, targetSpacing: number) {
  let selected = 0;
  for (let i = 1; i < widths.length; i++) {
    if (baseSpacing * baseWidth / widths[i] <= targetSpacing) selected = i;
  }
  return selected;
}
export function validHeight(value: number, nodata: number | null) {
  return Number.isFinite(value) && value !== nodata && value > -500 && value < 10000;
}
export function missingTile() {return new Float32Array(TILE_SIZE * TILE_SIZE).fill(NODATA);}
export function classify(height: number, altitude: number, enabled = true) {
  return height === NODATA ? 'missing' : enabled && height < altitude ? 'dim' : 'clear';
}
export interface Asset {url: string; date: string; id: string}
export function selectDetailAssets(features: any[]): Map<string, Asset> {
  const selected = new Map<string, Asset>();
  for (const feature of features) {
    const match = /^swissalti3d_(\d{4})_(\d{4})-(\d{4})$/.exec(feature.id);
    if (!match) continue;
    const date = feature.properties?.datetime ?? match[1];
    for (const [name, asset] of Object.entries(feature.assets ?? {}) as [string, any][]) {
      if (!name.endsWith('_2_2056_5728.tif') || !asset.href?.startsWith('https://data.geo.admin.ch/')) continue;
      const key = `${Number(match[2])}/${Number(match[3])}`;
      if (!selected.has(key) || selected.get(key)!.date < date) selected.set(key, {url: asset.href, date, id: feature.id});
    }
  }
  return selected;
}
