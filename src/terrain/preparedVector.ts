import VectorTile from 'ol/VectorTile';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import GeoJSON from 'ol/format/GeoJSON';
import {createXYZ} from 'ol/tilegrid';
import {Fill, Style} from 'ol/style';
import Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import {preparedArea, preparedAreas, preparedPayload, BAND_NODATA} from './prepared';
import {tileExtent} from './math';
import type {TileResult} from './workerPool';

// Experimental comparison path. Raster is the default; this uses actual vector
// rendering so geometry parse/render costs remain visible in the benchmark.
export function createPreparedVectors() {
  const controller = new AbortController();
  const cache = new Map<string, Promise<Feature<Geometry>[]>>();
  let altitude=650, enabled=true;
  const dim=new Style({fill:new Fill({color:'rgba(36,57,72,0.36)'})});
  const missing=new Style({fill:new Fill({color:'rgba(188,143,63,0.5)'})});
  async function features(z:number,x:number,y:number) {
    const area=preparedArea(z,x,y);
    if(!area) return [];
    const key=`${area.id}/${z}/${x}/${y}`;
    let promise=cache.get(key);
    if(!promise) {
      promise=(async()=>{
        const buffer=await preparedPayload(`${import.meta.env.BASE_URL}prepared/${key.split('/')[0]}/vector/${z}/${x}/${y}.json.gz?v=${area.fingerprint}`,AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]));
        const json=JSON.parse(new TextDecoder().decode(buffer));
        const result=new GeoJSON().readFeatures(json,{dataProjection:'EPSG:3857',featureProjection:'EPSG:3857'}) as Feature<Geometry>[];
        if(!result.length || result.some(f=>!Number.isInteger(f.get('band')) || (f.get('band')!==BAND_NODATA && (f.get('band') < -50 || f.get('band') > 999)))) throw Error('Invalid vector bands');
        return result;
      })();
      cache.set(key,promise);
      promise.catch(()=>{if(cache.get(key)===promise) cache.delete(key);});
      while(cache.size>64) cache.delete(cache.keys().next().value!);
    }
    return promise;
  }
  const source=new VectorTileSource({projection:'EPSG:3857',format:new GeoJSON(),tileGrid:createXYZ({minZoom:Math.min(...preparedAreas.map(a=>a.minZoom)),maxZoom:17,tileSize:256}),wrapX:false,
    tileUrlFunction:coord=>coord.join('/'),
    tileLoadFunction:(baseTile)=>{const tile=baseTile as VectorTile<Feature<Geometry>>; tile.setLoader(()=>{
      const [z,x,y]=tile.getTileCoord();
      void features(z,x,y).then(fs=>tile.setFeatures(fs)).catch(()=>tile.setState(3));
    });},
  });
  const layer=new VectorTileLayer({source,renderMode:'vector',declutter:false,preload:0,
    style:feature=>feature.get('band')===BAND_NODATA?missing:enabled&&feature.get('band')*10<altitude?dim:undefined,
  });
  return {
    layer,
    async load(z:number,x:number,y:number):Promise<TileResult> {
      const fs=await features(z,x,y);
      // Coverage bookkeeping only. The real polygons render on the vector layer.
      return {data:new Float32Array(65536).fill(10000),missing:fs.some(f=>f.get('band')===BAND_NODATA)?1:0,failures:0,bytes:0,spacing:Math.max(4,(tileExtent(z,x,y)[2]-tileExtent(z,x,y)[0])/256/Math.cosh((tileExtent(z,x,y)[1]+tileExtent(z,x,y)[3])/2/6378137))};
    },
    async probe(pixel:number[]) {
      const fs=await layer.getFeatures(pixel);
      const band=fs[0]?.get('band');
      return band===undefined || band===BAND_NODATA?'Elevation unavailable here.':`Terrain band: [${band*10}, ${band*10+10}) m · 4 m source grid. LN02.`;
    },
    update(value:number,show:boolean) {altitude=value;enabled=show;layer.changed();},
    retry() {cache.clear();source.refresh();},
    dispose() {controller.abort();cache.clear();},
  };
}
