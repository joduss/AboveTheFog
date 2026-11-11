import type Map from 'ol/Map.js';
import type Tile from 'ol/Tile.js';
import TileState from 'ol/TileState.js';
import TileLayer from 'ol/layer/Tile.js';
import ImageTileSource from 'ol/source/ImageTile.js';
import {transformExtent} from 'ol/proj.js';
import {getUid} from 'ol/util.js';

// WGS84BoundingBox for ch.swisstopo.pixelkarte-farbe in EPSG:3857 capabilities.
// Clip the layer, preserving the worldwide XYZ origin and zoom resolutions.
export function createBasemap() {
  const source = new ImageTileSource({
    url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
    maxZoom: 18, wrapX: false, transition: 0,
    attributions: 'Map & elevation © <a href="https://www.swisstopo.admin.ch/">swisstopo</a>',
  });
  return new TileLayer({source, extent: transformExtent(
    [5.140242, 45.398181, 11.47757, 48.230651], 'EPSG:4326', 'EPSG:3857',
  )});
}

export function watchBasemap(map: Map, layer: ReturnType<typeof createBasemap>, warn: (visible: boolean) => void) {
  const source = layer.getSource()!;
  const sourceId = getUid(source);
  const failures = new Set<Tile>();
  const retried = new WeakSet<Tile>();
  const timers = new globalThis.Map<Tile, number>();
  let warning = false;
  function requeue(tile: Tile) {
    // The map queue owns concurrency and only starts tiles wanted by a frame.
    failures.delete(tile);
    clearTimeout(timers.get(tile));
    timers.delete(tile);
    if (tile.getState() === TileState.ERROR) tile.setState(TileState.IDLE);
    map.render();
  }
  function failed(event: {tile: Tile}) {
    failures.add(event.tile);
    map.render();
  }
  const render = (event: import('ol/MapEvent.js').default) => {
    const wanted = event.frameState?.wantedTiles[sourceId];
    let visibleFailure = false;
    for (const tile of failures) {
      if (!wanted?.[tile.getKey()]) {
        retried.delete(tile);
        requeue(tile);
      } else if (timers.has(tile)) {
        continue;
      } else if (!retried.has(tile)) {
        retried.add(tile);
        timers.set(tile, window.setTimeout(() => requeue(tile), 500));
      } else {
        visibleFailure = true;
      }
    }
    if (warning !== visibleFailure) {warning = visibleFailure; warn(warning);}
  };
  const retry = () => {
    for (const tile of failures) requeue(tile);
  };
  source.on('tileloaderror', failed);
  map.on('postrender', render);
  window.addEventListener('online', retry);
  return {
    retry,
    dispose() {
      source.un('tileloaderror', failed);
      map.un('postrender', render);
      window.removeEventListener('online', retry);
      for (const timer of timers.values()) clearTimeout(timer);
      failures.clear();
      timers.clear();
    },
  };
}
