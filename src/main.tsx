import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import WebGLTile from 'ol/layer/WebGLTile.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import XYZ from 'ol/source/XYZ.js';
import DataTile from 'ol/source/DataTile.js';
import TileGrid from 'ol/tilegrid/TileGrid.js';
import Feature from 'ol/Feature.js';
import Polygon, { fromExtent } from 'ol/geom/Polygon.js';
import { Fill, Stroke, Style } from 'ol/style.js';
import { defaults } from 'ol/control/defaults.js';
import ScaleLine from 'ol/control/ScaleLine.js';
import 'ol/ol.css';
import './style.css';
type Manifest = {
    extent: number[];
    size: number;
    minMetres: number;
    maxMetres: number;
    checkpoints: {
        name: string;
        sourceMetres: number;
        preparedMetres: number;
    }[];
};
function App() {
    const host = useRef<HTMLDivElement>(null), mapRef = useRef<Map | null>(null), layer = useRef<WebGLTile | null>(null);
    const [alt, setAlt] = useState(650), [enabled, setEnabled] = useState(true), [status, setStatus] = useState('Loading elevation…'), [meta, setMeta] = useState<Manifest | null>(null), [error, setError] = useState(false), [baseError, setBaseError] = useState(false);
    const [probe, setProbe] = useState('Tap the map to inspect terrain.');
    useEffect(() => {
        let disposed = false;
        const abort = new AbortController();
        let values: Uint16Array | undefined;
        let manifest: Manifest | undefined;
        const world = fromExtent([-20037508, -20037508, 20037508, 20037508]).getCoordinates()[0];
        const unknown = new Feature(new Polygon([world]));
        const unknownLayer = new VectorLayer({ source: new VectorSource({ features: [unknown] }), style: new Style({ fill: new Fill({ color: 'rgba(188,143,63,0.23)' }) }) });
        const base = new XYZ({ url: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', maxZoom: 18, attributions: 'Map & elevation © <a href="https://www.swisstopo.admin.ch/">swisstopo</a>', crossOrigin: 'anonymous' });
        base.on('tileloaderror', () => setBaseError(true));
        const map = new Map({ target: host.current!, layers: [new TileLayer({ source: base }), unknownLayer], controls: defaults({ attributionOptions: { collapsible: false } }).extend([new ScaleLine()]), view: new View({ center: [945000, 5998000], zoom: 13, minZoom: 7, maxZoom: 19 }) });
        mapRef.current = map;
        const fail = () => { if (disposed)
            return; setError(true); setStatus('Elevation unavailable — reload to retry'); unknown.setGeometry(new Polygon([world])); layer.current?.setVisible(false); };
        host.current!.addEventListener('webglcontextlost', fail, true);
        async function load() {
            try {
                const mr = await fetch(`${import.meta.env.BASE_URL}data/manifest.json`, { signal: abort.signal });
                if (!mr.ok)
                    throw Error('manifest');
                manifest = await mr.json();
                const m = manifest!;
                if (m.size !== 1024 || m.extent.length !== 4)
                    throw Error('metadata');
                setMeta(m);
                map.getView().fit(m.extent, { padding: [35, 35, 35, 35] });
                map.addLayer(new VectorLayer({ source: new VectorSource({ features: [new Feature(fromExtent(m.extent))] }), style: new Style({ stroke: new Stroke({ color: '#2c6459', width: 2, lineDash: [8, 5] }) }) }));
                const r = await fetch(`${import.meta.env.BASE_URL}data/elevation.bin`, { signal: abort.signal });
                if (!r.ok)
                    throw Error('elevation');
                const b = await r.arrayBuffer();
                if (b.byteLength !== m.size * m.size * 2)
                    throw Error('truncated elevation');
                if (disposed)
                    return;
                values = new Uint16Array(b);
                // Float32 avoids image-band normalization; values remain decimetres.
                const data = Float32Array.from(values);
                const source = new DataTile({ projection: 'EPSG:3857', bandCount: 1, interpolate: false, wrapX: false, tileGrid: new TileGrid({ extent: m.extent, origin: [m.extent[0], m.extent[3]], resolutions: [(m.extent[2] - m.extent[0]) / m.size], tileSize: m.size }), loader: () => data });
                const elevation = new WebGLTile({ source, extent: m.extent, style: { variables: { altitude: 650, enabled: 1 }, color: ['case', ['==', ['band', 1], 65535], [188, 143, 63, 0.5], ['all', ['==', ['var', 'enabled'], 1], ['<', ['band', 1], ['*', ['var', 'altitude'], 10]]], [36, 57, 72, 0.32], [0, 0, 0, 0]] } });
                layer.current = elevation;
                map.getLayers().insertAt(1, elevation);
                source.on('tileloadend', () => { if (disposed)
                    return; unknown.setGeometry(new Polygon([world, fromExtent(m.extent).getCoordinates()[0].slice().reverse()])); setStatus('Elevation ready · 4 km² sample'); });
                source.on('tileloaderror', fail);
            }
            catch (e) {
                if (!disposed)
                    fail();
            }
        }
        void load();
        map.on('singleclick', event => {
            if (!values || !manifest) {
                setProbe('Elevation unavailable.');
                return;
            }
            const [x, y] = event.coordinate, m = manifest, [l, b, r, t] = m.extent;
            if (x < l || x >= r || y <= b || y > t) {
                setProbe('Outside test area — elevation unavailable.');
                return;
            }
            const col = Math.floor((x - l) / (r - l) * m.size), row = Math.floor((t - y) / (t - b) * m.size), v = values[row * m.size + col];
            setProbe(v === 65535 ? 'No elevation data at this point.' : `Terrain: ${(v / 10).toFixed(1)} m above sea level (LN02).`);
        });
        return () => { disposed = true; abort.abort(); host.current?.removeEventListener('webglcontextlost', fail, true); map.dispose(); mapRef.current = null; layer.current = null; };
    }, []);
    useEffect(() => { layer.current?.updateStyleVariables({ altitude: alt, enabled: enabled ? 1 : 0 }); layer.current?.setVisible(!error); }, [alt, enabled, status, error]);
    return <main><header><div className="brand"><span className="mark">≋</span><div><h1>Swiss Fog Map</h1><p>Altitude laboratory</p></div></div><span className="badge">LOCAL PROTOTYPE</span></header><section className="workspace"><aside><p className="eyebrow">01 / EXPLORE AN ALTITUDE</p><h2>See the terrain <br />above your threshold.</h2><p className="intro">A small experiment around Uetliberg, from the valley to the ridge.</p><div className="controls"><label htmlFor="altitude">Selected altitude</label><div className="number"><input id="altitude" aria-label="Altitude in metres above sea level" type="number" min="0" max="2000" step="1" value={alt} onChange={e => { if (e.target.value !== '')
        setAlt(Math.min(2000, Math.max(0, Number(e.target.value)))); }}/><span>m above sea level</span></div><input aria-label="Altitude slider" type="range" min="0" max="2000" step="1" value={alt} onChange={e => setAlt(Number(e.target.value))}/><div className="range-labels"><span>0 m</span><span>2,000 m</span></div><label className="toggle"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/><span>Dim terrain below {alt} m</span></label></div><div className="legend"><p><i className="dim"/>Below selected altitude</p><p><i className="clear"/>At or above · no dimming</p><p><i className="unavailable"/>Amber: elevation unavailable</p></div><p className="notice"><strong>An altitude scenario, not a fog forecast.</strong> Actual fog height varies by region. Consult <a href="https://www.meteoswiss.admin.ch/" target="_blank" rel="noreferrer">MeteoSwiss ↗</a> for weather information.</p><details><summary>About this sample</summary><p>Real 2 m swissALTI3D, prepared to a roughly 2 m ground grid. Heights in metres, LN02. Dashed boundary marks the prepared tile; amber edge pixels have no source data. Outside coverage is always unavailable, including when dimming is off.</p><p>Source range: {meta ? `${Math.floor(meta.minMetres)}–${Math.ceil(meta.maxMetres)} m` : 'loading'}.</p></details></aside><section className="map-panel" aria-label="Interactive topographic map"><div className="map-toolbar"><span role="status" className={error ? 'error' : ''}>{status}</span><button onClick={() => meta && mapRef.current?.getView().fit(meta.extent, { padding: [35, 35, 35, 35], duration: 250 })}>Test area ↗</button></div><div ref={host} className="map" tabIndex={0} aria-label="Map: drag to pan, plus or minus to zoom"/><div className="map-footer"><span>{probe}</span><span>Amber ≠ above threshold</span></div>{baseError && <p role="alert" className="map-warning">Some background map tiles failed to load. Reload to retry.</p>}</section></section><footer>SWISSALTI3D / LV95 → WEB MERCATOR / LN02 <span>Map & elevation © swisstopo</span></footer></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
