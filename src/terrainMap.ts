import {ResidentTiles} from './terrain/residentTiles';
import {retryTile} from './terrain/retryTile';
import {createPreparedVectors} from './terrain/preparedVector';
import {preparedArea, loadPrepared, preparedMode, nationalMode} from './terrain/prepared';
import {createPreview} from './terrain/preview';
import {readTile, writeTile} from './terrain/tileCache';
import type {Bounds} from './terrain/math';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {createBasemap, watchBasemap} from './terrain/basemap';
import {overviewUrl, loadOverview} from './terrain/overview';
import {createNationalTerrain, NATIONAL_DETAIL_ZOOM, NATIONAL_MAX_ZOOM} from './terrain/national';
import WebGLTile from 'ol/layer/WebGLTile.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import DataTile from 'ol/source/DataTile.js';
import {createXYZ} from 'ol/tilegrid.js';
import Feature from 'ol/Feature.js';
import Polygon, {fromExtent} from 'ol/geom/Polygon.js';
import {Fill, Style} from 'ol/style.js';
import {defaults} from 'ol/control/defaults.js';
import ScaleLine from 'ol/control/ScaleLine.js';
import {getIntersection, isEmpty} from 'ol/extent.js';
import {fromLonLat, transformExtent} from 'ol/proj.js';
import {TerrainWorkers, type TileResult} from './terrain/workerPool';
import {DETAIL_ZOOM, MAX_ZOOM, NODATA, SWISS_BOUNDS, WORLD, missingTile} from './terrain/math';

interface Callbacks {
  status: (text: string) => void;
  resolution: (text: string) => void;
  probe: (text: string) => void;
  basemapError: (visible: boolean) => void;
}
export const PLACES: Record<string, [number, number]> = {
  Fribourg: [7.1619, 46.8065], Zermatt: [7.7491, 46.0207], Geneva: [6.1432, 46.2044], Zurich: [8.5417, 47.3769],
  Basel: [7.5886, 47.5596], Lugano: [8.9511, 46.0037], 'St. Moritz': [9.8397, 46.4908],
};

export function createTerrainMap(target: HTMLElement, callbacks: Callbacks) {
  const controller = new AbortController();
  const extent = transformExtent(SWISS_BOUNDS, 'EPSG:4326', 'EPSG:3857');
  const world = fromExtent([-WORLD, -WORLD, WORLD, WORLD]).getCoordinates()[0];
  const unknown = new Feature(new Polygon([world]));
  const coverage = new VectorLayer({className: 'terrain-availability', updateWhileAnimating: true, updateWhileInteracting: true, source: new VectorSource({features: [unknown]}), style: new Style({fill: new Fill({color: 'rgba(188,143,63,0.35)'})})});
  const base = createBasemap();
  const map = new Map({target, layers: [base, coverage],
    controls: defaults({attributionOptions: {collapsible: false}}).extend([new ScaleLine()]),
    view: new View({center: fromLonLat([8.23, 46.8]), zoom: 8, minZoom: 7, maxZoom: 19, constrainResolution: true}),
  });
  const background = watchBasemap(map, base, callbacks.basemapError);
  const national = createNationalTerrain();
  const grid = createXYZ({minZoom: 7, maxZoom: nationalMode ? NATIONAL_MAX_ZOOM : MAX_ZOOM, tileSize: 256});
  let disposed = false, fatal = false, altitude = 650, enabled = true, frame = 0, signature = '';
  let workers: TerrainWorkers | undefined;
  let runtimeView: Parameters<TerrainWorkers['prioritize']> = [-1,0,0,0,0];
  function runtimeWorkers() {
    if (!workers) {
      workers = new TerrainWorkers();
      workers.prioritize(...runtimeView);
    }
    return workers;
  }
  let elevation: WebGLTile | undefined;
  type Info = Omit<TileResult, 'data'> & {signal: AbortSignal};
  const loaded = new globalThis.Map<string, {tile: {getState: () => number}; result: Info}>();
  const completed = new globalThis.Map<string, Info>();
  const failed = new Set<string>();
  const pending = new Set<string>();
  const cancelled = new Set<string>();
  let epoch = 0, bypassCache = false;
  let loadController = new AbortController();
  const resident = new ResidentTiles();
  let prefetchQueue: [number,number,number][] = [], prefetchActive = 0, prefetchTimer = 0;
  const debugTiles = new URLSearchParams(location.search).has('debugTiles');
  const starts: Record<string, number> = {};
  let viewProgress: {centerKey: string; centerSource?: string; loading: number} | undefined;
  const diagnostic = () => {if (debugTiles) target.setAttribute('data-terrain-diagnostics', JSON.stringify({zoom: map.getView().getZoom(), size: map.getSize(), center: map.getView().getCenter(), resolution: map.getView().getResolution(), viewProgress, ready: [...loaded].filter(([,record])=>record.tile.getState()===2).map(([key])=>key), starts, lookAhead: prefetchActive+prefetchQueue.length, loaded: loaded.size, pending: [...pending], failed: [...failed]}));};

  const vectors = preparedMode === 'vector' ? createPreparedVectors() : undefined;
  if (vectors) map.addLayer(vectors.layer);
  const preview = createPreview(refresh);
  preview.layer.setExtent(extent);
  map.getLayers().insertAt(1, preview.layer);

  function refresh() {
    if (disposed || frame) return;
    frame = requestAnimationFrame(refreshNow);
  }
  function refreshNow() {
      if(frame) cancelAnimationFrame(frame); frame=0;
      if (fatal || disposed) return;
      const z = grid.getZForResolution(map.getView().getResolution()!, -1);
      const visible = getIntersection(map.getView().calculateExtent(map.getSize()), extent);
      const holes: number[][][] = [], keys: string[] = [];
      let loading = 0, unavailable = 0, ready = 0, spacing = 0, previews = 0, parents = 0, preparedVisible = 0, visibleTiles = 0;
      const detailed: Bounds[] = [];
      if (!isEmpty(visible)) {
        const range = grid.getTileRangeForExtentAndZ(visible, z);
        for (let x = range.minX; x <= range.maxX; x++) for (let y = range.minY; y <= range.maxY; y++) {
          visibleTiles++; if(preparedArea(z,x,y)) preparedVisible++;
          const key = `${z}/${x}/${y}`, record = loaded.get(key);
          if (record && record.tile.getState() === 2) {
            const clipped = getIntersection(grid.getTileCoordExtent([z, x, y]), extent);
            holes.push(fromExtent(clipped).getCoordinates()[0].slice().reverse()); keys.push(key);
            detailed.push(clipped as Bounds);
            spacing = Math.max(spacing, record.result.spacing);
            if (record.result.missing || record.result.failures || failed.has(key)) unavailable++;
            ready++;
          } else if (failed.has(key)) unavailable++;
          else {
            loading++;
            const tileBounds = grid.getTileCoordExtent([z,x,y]) as Bounds;
            let parent;
            for(let parentZ=z-1;parentZ>=7;parentZ--) {
              const scale=2**(z-parentZ), candidate=loaded.get(`${parentZ}/${Math.floor(x/scale)}/${Math.floor(y/scale)}`);
              if(candidate?.tile.getState()===2 && !candidate.result.failures) {parent=candidate;break;}
            }
            if(!vectors && parent?.tile.getState()===2 && !parent.result.failures) {
              holes.push(fromExtent(getIntersection(tileBounds,extent)).getCoordinates()[0].slice().reverse());keys.push(`parent/${key}`);detailed.push(getIntersection(tileBounds,extent) as Bounds);parents++;
            } else if (!preparedArea(z,x,y) && preview.covers(tileBounds)) {
              holes.push(fromExtent(getIntersection(tileBounds, extent)).getCoordinates()[0].slice().reverse()); keys.push(`preview/${key}`); previews++;
            }
          }
        }
      }
      for(const [key,record] of loaded) {
        const coord=key.split('/').map(Number) as [number,number,number];
        if(coord[0]===z && record.tile.getState()===2 && !keys.includes(key)) {
          const b=getIntersection(grid.getTileCoordExtent(coord),extent);
          if(!isEmpty(b)) {holes.push(fromExtent(b).getCoordinates()[0].slice().reverse());keys.push(key);detailed.push(b as Bounds);}
        }
      }
      const next = keys.sort().join('|');
      if (next !== signature) preview.mask(detailed);
      if (next !== signature) {signature = next; unknown.setGeometry(new Polygon([world, ...holes]));}
      if (debugTiles) {
        const centerKey = grid.getTileCoordForCoordAndZ(map.getView().getCenter()!, z).join('/');
        const centerSource = keys.includes(centerKey) ? 'detail' : keys.includes(`preview/${centerKey}`) ? 'preview' :
          keys.includes(`parent/${centerKey}`) ? 'parent' : undefined;
        viewProgress = {centerKey, centerSource, loading};
      }
      const preparedCount = preparedVisible;
      const moving = map.getView().getAnimating() || map.getView().getInteracting();
      const nationalBands = nationalMode && z >= 9;
      const nationalDetail = nationalBands && z >= NATIONAL_DETAIL_ZOOM;
      const mode = nationalBands ? (nationalDetail ? 'Prepared swissALTI3D · 4 m grid / 10 m bands' : 'Prepared swissALTIRegio · approximate overview') : preparedCount ? `Prepared swissALTI3D · 4 m grid / 10 m bands${preparedCount < visibleTiles ? ' · mixed runtime coverage' : ''}` : z >= DETAIL_ZOOM ? 'swissALTI3D · 2 m samples' : 'swissALTIRegio · approximate overview';
      diagnostic();
      callbacks.resolution(nationalBands ?
        (nationalDetail ? '4 m source grid · 10 m elevation bands' : 'Regional overview · 10 m elevation bands') : preparedCount ? (z >= 17 ? '4 m grid · 10 m elevation bands' : '4 m source grid · approximate delivery overview · 10 m bands') : previews ? 'Approximate preview · refining' : z >= DETAIL_ZOOM ? '2 m terrain samples' : `${spacing ? `≈${Math.round(spacing)} m` : 'Coarse'} terrain samples · approximate`);
      callbacks.status(`${parents ? 'Approximate cached terrain · refining · ' : previews ? 'Approximate preview · refining · ' : ''}${mode}${loading ? ` · loading ${loading} tile(s)` : ''}${unavailable ? ` · ${unavailable} tile(s) contain unavailable data` : ''}${moving ? ' · updating view' : !loading && !unavailable && ready ? ' · ready' : ''}${!ready && !loading && !unavailable ? ' · outside supported extent' : ''}`);
  }
  // Update coverage before the layers draw, including while dragging. A delayed
  // availability polygon otherwise covers already-rendered tiles with amber.
  map.on('precompose', refreshNow);
  function fail() {
    if (disposed) return;
    fatal = true; vectors?.layer.setVisible(false); vectors?.dispose(); preview.dispose(); preview.layer.setVisible(false); workers?.dispose(); unknown.setGeometry(new Polygon([world])); elevation?.setVisible(false);
    callbacks.status('Elevation unavailable — reload to retry'); callbacks.resolution('Elevation unavailable');
  }
  target.addEventListener('webglcontextlost', fail, true);
  map.getView().on('change', () => {callbacks.probe('Tap the map to inspect terrain.'); refresh();});
  function currentView() {
    if (fatal || disposed) return;
    const z = grid.getZForResolution(map.getView().getResolution()!, -1);
    const bounds = getIntersection(map.getView().calculateExtent(map.getSize()), extent) as Bounds;
    if (isEmpty(bounds)) {runtimeView = [-1,0,0,0,0]; workers?.prioritize(...runtimeView); preview.reset(); refresh(); return;}
    const range = grid.getTileRangeForExtentAndZ(bounds,z);
    runtimeView = [z,range.minX-1,range.minY-1,range.maxX+1,range.maxY+1];
    workers?.prioritize(...runtimeView);
    // Nationwide packets already contain neighbouring tiles. A pan can use
    // those bytes immediately without competing with speculative source work.
    if (nationalMode) {refresh(); return;}
    // Skip source-based previews when every visible tile has prepared coverage.
    let allPrepared = true;
    for (let x=range.minX;x<=range.maxX;x++) for(let y=range.minY;y<=range.maxY;y++) if(!preparedArea(z,x,y)) allPrepared=false;
    if(!allPrepared && (preparedMode === 'off' || z > 8)) void preview.view(bounds,z);
    let preparedParents = allPrepared && z>13;
    for(let x=Math.floor(range.minX/2);x<=Math.floor(range.maxX/2);x++) for(let y=Math.floor(range.minY/2);y<=Math.floor(range.maxY/2);y++) if(!preparedArea(z-1,x,y)) preparedParents=false;
    elevation?.setPreload(preparedParents ? 1 : 0);
    prefetchQueue=[];
    if(!vectors) for(let x=range.minX-1;x<=range.maxX+1;x++) for(let y=range.minY-1;y<=range.maxY+1;y++) {
      if((x<range.minX||x>range.maxX||y<range.minY||y>range.maxY) && preparedArea(z,x,y)) prefetchQueue.push([z,x,y]);
    }
    clearTimeout(prefetchTimer);prefetchTimer=window.setTimeout(prefetch,150);refresh();
  }
  function preparedResult(z:number,x:number,y:number) {
    const area=preparedArea(z,x,y)!;
    const cacheKey=`prepared-v1/raster/${area.id}/${area.fingerprint}/${z}/${x}/${y}`;
    return resident.load(cacheKey,async()=>{
      const cached=bypassCache?undefined:await readTile(cacheKey,80);
      if(cached) return cached;
      const result=await loadPrepared(area.id,z,x,y,controller.signal);
      writeTile(cacheKey,result);return result;
    });
  }
  function prefetch() {
    if(disposed || fatal) return;
    while(prefetchActive<2 && prefetchQueue.length) {
      const [z,x,y]=prefetchQueue.shift()!;prefetchActive++;
      void preparedResult(z,x,y).catch(()=>{}).finally(()=>{prefetchActive--;prefetch();diagnostic();});
    }
  }
  map.on('moveend', currentView);

  map.on('rendercomplete', refresh);
  const source = new DataTile({
    projection: 'EPSG:3857', bandCount: 1, interpolate: false, wrapX: false, tileGrid: grid, zDirection: -1, transition: 0,
    loader: async (z, x, y, options) => {
      const key = `${z}/${x}/${y}`, generation = epoch;
      const signal = AbortSignal.any([controller.signal, loadController.signal, options.signal]);
      if (debugTiles) {starts[key] = (starts[key] ?? 0) + 1; if (Object.keys(starts).length > 256) delete starts[Object.keys(starts)[0]];} diagnostic(); loaded.delete(key); failed.delete(key); pending.add(key); refresh();
      let result: TileResult;
      try {
        if (fatal) throw Error('Renderer unavailable');
        const prepared = preparedArea(z,x,y);
        const overview = preparedMode !== 'off' && overviewUrl(z,x,y);
        if (overview) result = await retryTile(() => loadOverview(overview, signal), signal);
        else if (nationalMode) result = await retryTile(() => national.load(z,x,y,signal,bypassCache), signal);
        else if(prepared && !vectors) result=await retryTile(()=>preparedResult(z,x,y), signal);
        else {
          const cached=bypassCache || (prepared && vectors)?undefined:await readTile(key);
          signal.throwIfAborted();
          result=cached ?? await retryTile(()=>prepared && vectors ? vectors.load(z,x,y) : runtimeWorkers().load(z,x,y,signal), signal);
          if(!cached && !prepared && generation===epoch) writeTile(key,result);
        }
        signal.throwIfAborted();
        if (result.failures && generation === epoch) failed.add(key);
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.message === 'View changed')) {
          cancelled.add(key); if (generation === epoch) pending.delete(key); throw error;
        }
        result = {data: missingTile(), spacing: 0, missing: 65536, failures: 1, bytes: 0};
        if (generation === epoch) failed.add(key);
      }
      if (!disposed && generation === epoch) {const {data: _data, ...info} = result; completed.set(key, {...info, signal: options.signal}); pending.delete(key); refresh();}
      diagnostic(); return result.data;
    },
  });
  source.on('tileloadend', event => {
    if (disposed) return;
    const key = event.tile.getTileCoord().join('/'), result = completed.get(key);
    if (result) {loaded.set(key, {tile: event.tile, result}); completed.delete(key);}
    while (loaded.size > 256) loaded.delete(loaded.keys().next().value!);
    diagnostic(); refresh();
  });
  source.on('tileloaderror', event => {const key = event.tile.getTileCoord().join('/'); if (cancelled.delete(key)) {
      // Let OpenLayers release the failed request slot before making it retryable.
      queueMicrotask(() => {if (!disposed) {event.tile.setState(0); map.render(); refresh();}}); return;
    } loaded.delete(key); failed.add(key); pending.delete(key); refresh();});
  try {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl');
    if (!gl) throw Error('WebGL unavailable');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    elevation = new WebGLTile({source, extent, cacheSize: 128, preload: 0, style: {
      variables: {altitude, enabled: 1},
      color: ['case', ['==', ['band', 1], NODATA], [188, 143, 63, 0.5],
        ['==', ['var', 'enabled'], 0], [0, 0, 0, 0],
        ['<', ['band', 1], ['var', 'altitude']], [36, 57, 72, 0.36], [0, 0, 0, 0]],
    }});
    map.getLayers().insertAt(2, elevation);
  } catch {fail();}
  const initialPlace = new URLSearchParams(location.search).get('place');
  if(initialPlace && PLACES[initialPlace]) {map.getView().setCenter(fromLonLat(PLACES[initialPlace])); map.getView().setZoom(Number(new URLSearchParams(location.search).get('zoom') ?? 15));}
  else map.getView().fit(extent, {padding: [30, 30, 30, 30]});
  currentView();
  map.on('singleclick', async event => {
    const z = grid.getZForResolution(map.getView().getResolution()!, -1);
    const coord = grid.getTileCoordForCoordAndZ(event.coordinate,z);
    if(vectors && preparedArea(...coord as [number,number,number])) {callbacks.probe(await vectors.probe(event.pixel)); return;}
    const key = coord.join('/');
    const record = loaded.get(key);
    const data = !fatal && record && record.tile.getState() === 2 ? elevation?.getData(event.pixel) : null;
    if (!data || data instanceof DataView || data[0] === NODATA || !Number.isFinite(data[0])) return callbacks.probe('Elevation unavailable here.');
    if (nationalMode && z >= 9) {
      const source = z >= NATIONAL_DETAIL_ZOOM ? '4 m swissALTI3D grid' : 'swissALTIRegio overview';
      return callbacks.probe(`Terrain band: [${data[0]}, ${data[0]+10}) m · ${source}. LN02 within Switzerland.`);
    }
    if (preparedArea(...grid.getTileCoordForCoordAndZ(event.coordinate,z) as [number,number,number])) return callbacks.probe(`Terrain band: [${data[0]}, ${data[0]+10}) m · 4 m source grid${z < 17 ? ' · approximate overview' : ''}. LN02.`);
    callbacks.probe(`Terrain sample: ${data[0].toFixed(1)} m · ${z >= DETAIL_ZOOM ? '2 m grid' : `approx. ${Math.round(record!.result.spacing)} m grid`}. LN02 within Switzerland.`);
  });
  return {
    update(nextAltitude: number, nextEnabled: boolean) {altitude = nextAltitude; enabled = nextEnabled; vectors?.update(altitude,enabled); preview.update(altitude, enabled); elevation?.updateStyleVariables({altitude, enabled: enabled ? 1 : 0});},
    recenter() {map.getView().fit(extent, {padding: [30, 30, 30, 30]});},
    goTo(place: string) {if (PLACES[place]) {map.getView().cancelAnimations(); map.getView().setCenter(fromLonLat(PLACES[place])); map.getView().setZoom(15);}},
    retryBasemap: background.retry,
    retry() {
      if (fatal) {location.reload(); return;}
      epoch++; loadController.abort(); loadController = new AbortController(); bypassCache = true; national.clear(); resident.clear();prefetchQueue=[]; vectors?.retry(); preview.reset(true); workers?.dispose(); elevation?.setSource(null); elevation?.setSource(source); workers = undefined; loaded.clear(); completed.clear(); failed.clear(); pending.clear();
      signature = ''; unknown.setGeometry(new Polygon([world])); source.refresh(); currentView();
    },
    dispose() {disposed = true; national.clear(); background.dispose(); clearTimeout(prefetchTimer);prefetchQueue=[];resident.clear();vectors?.dispose(); preview.dispose(); controller.abort(); workers?.dispose(); cancelAnimationFrame(frame); target.removeEventListener('webglcontextlost', fail, true); map.dispose();},
  };
}
