import ImageLayer from 'ol/layer/Image';
import ImageCanvas from 'ol/source/ImageCanvas';
import {createXYZ} from 'ol/tilegrid';
import {ComparisonWorkers} from './comparisonWorkers';
import type {TerrainWorkers, TileResult} from './workerPool';
import {readTile, writeTile} from './tileCache';
import {NODATA, type Bounds} from './math';
import {loadOverview, overviewUrl} from './overview';
import {preparedMode} from './prepared';

export function createPreview(changed: () => void) {
  const grid = createXYZ({tileSize: 256});
  let workers: TerrainWorkers | undefined;
  const tiles = new Map<string, {bounds: Bounds; result: TileResult}>();
  let controller = new AbortController(), generation = 0, signature = '', altitude = 650, enabled = true;
  let excluded: Bounds[] = [], bypassCache = false;
  const images = new Map<TileResult, HTMLCanvasElement>();
  const inflight = new Set<string>();
  const source = new ImageCanvas({projection: 'EPSG:3857', ratio: 1,
    canvasFunction: (extent, _resolution, _pixelRatio, size) => {
      const canvas = document.createElement('canvas'); canvas.width = size[0]; canvas.height = size[1];
      const ctx = canvas.getContext('2d')!; ctx.imageSmoothingEnabled = false;
      const rect = (b: Bounds) => [(b[0]-extent[0])/(extent[2]-extent[0])*size[0], (extent[3]-b[3])/(extent[3]-extent[1])*size[1], (b[2]-b[0])/(extent[2]-extent[0])*size[0], (b[3]-b[1])/(extent[3]-extent[1])*size[1]];
      for (const {bounds, result} of [...tiles.values()].sort((a,b)=>(b.bounds[2]-b.bounds[0])-(a.bounds[2]-a.bounds[0]))) {
        let raster=images.get(result);
        if(!raster) {
          raster=document.createElement('canvas'); raster.width=raster.height=256;
          const rc=raster.getContext('2d')!, image=rc.createImageData(256,256);
          for (let i=0; i<result.data.length; i++) {
            if (result.data[i] === NODATA) image.data.set([188,143,63,128], i*4);
            else if (enabled && result.data[i]<altitude) image.data.set([36,57,72,92], i*4);
          }
          rc.putImageData(image,0,0);images.set(result,raster);
        }
        const [x,y,w,h] = rect(bounds); ctx.clearRect(x,y,w,h);ctx.drawImage(raster,x,y,w,h);
      }
      for (const b of excluded) {const [x,y,w,h] = rect(b); ctx.clearRect(x,y,w,h);}
      return canvas;
    },
  });
  return {
    layer: new ImageLayer({source}),
    covers(bounds: Bounds) {return [...tiles.values()].some(t => t.bounds[0] <= bounds[0] && t.bounds[1] <= bounds[1] && t.bounds[2] >= bounds[2] && t.bounds[3] >= bounds[3]);},
    mask(bounds: Bounds[]) {excluded = bounds; source.changed();},
    update(value: number, show: boolean) {if(altitude===value && enabled===show)return;altitude=value;enabled=show;images.clear();source.changed();},
    async view(bounds: Bounds, detailZoom: number) {
      const z = preparedMode === 'off' ? Math.max(7, Math.min(12, detailZoom - 3)) : 8;
      const range = grid.getTileRangeForExtentAndZ(bounds,z);
      const next = `${z}/${range.minX}/${range.minY}/${range.maxX}/${range.maxY}`;
      if (next === signature) return;
      signature = next;
      // Retain resident previews and source readers across neighbouring pans.
      const signal = controller.signal, epoch = generation;
      if (preparedMode === 'off') {
        workers ??= new ComparisonWorkers!(1);
        workers.prioritize(z,range.minX-1,range.minY-1,range.maxX+1,range.maxY+1);
      }
      const jobs: {x:number;y:number}[] = [];
      for(let x=range.minX;x<=range.maxX;x++) for(let y=range.minY;y<=range.maxY;y++) jobs.push({x,y});
      const cx=(range.minX+range.maxX)/2, cy=(range.minY+range.maxY)/2;
      jobs.sort((a,b)=>(a.x-cx)**2+(a.y-cy)**2-(b.x-cx)**2-(b.y-cy)**2);
      await Promise.all(jobs.map(async ({x,y}) => {
        const key=`${z}/${x}/${y}`;
        if(tiles.has(key)||inflight.has(key))return;
        inflight.add(key);
        try {
          const url = preparedMode === 'off' ? undefined : overviewUrl(z,x,y);
          let result: TileResult;
          if (url) {
            result = await loadOverview(url, signal);
          } else if (workers) {
            const cached = bypassCache ? undefined : await readTile(key);
            if (signal.aborted) return;
            result = cached ?? await workers.load(z,x,y,signal);
            if (!cached && !signal.aborted) writeTile(key,result);
          } else {
            return;
          }
          if(epoch!==generation || signal.aborted || result.failures) return;
          tiles.set(key,{bounds:grid.getTileCoordExtent([z,x,y]) as Bounds,result});
          while(tiles.size>24) {const oldest=tiles.keys().next().value!;images.delete(tiles.get(oldest)!.result);tiles.delete(oldest);}
          source.changed(); changed();
        } catch { /* Detail loading continues if preview fails. */ } finally {inflight.delete(key);}
      }));
    },
    reset(force = false) {bypassCache ||= force; signature=''; controller.abort(); generation++;inflight.clear();tiles.clear();images.clear();controller=new AbortController();source.changed();},
    dispose() {controller.abort(); workers?.dispose();},
  };
}
