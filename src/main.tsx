import {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createTerrainMap, PLACES} from './terrainMap';
import 'ol/ol.css';
import './style.css';

function App() {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<ReturnType<typeof createTerrainMap> | null>(null);
  const [altitude, setAltitude] = useState(650);
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState('Loading elevation…');
  const [resolution, setResolution] = useState('Loading terrain…');
  const [baseError, setBaseError] = useState(false);
  const [probe, setProbe] = useState('Tap the map to inspect terrain.');

  useEffect(() => {
    map.current = createTerrainMap(host.current!, {
      status: setStatus, resolution: setResolution, probe: setProbe,
      basemapError: setBaseError,
    });
    return () => {map.current?.dispose(); map.current = null;};
  }, []);
  useEffect(() => {map.current?.update(altitude, enabled);}, [altitude, enabled]);

  return <main>
    <header>
      <div className="brand"><span className="mark">≋</span><div><h1>Swiss Fog Map</h1><p>Altitude laboratory</p></div></div>
      <span className="badge">SWITZERLAND</span>
    </header>
    <section className="workspace">
      <aside>
        <p className="eyebrow">01 / EXPLORE AN ALTITUDE</p>
        <h2>See the terrain <br/>above your threshold.</h2>
        <p className="intro">Explore Switzerland, from the Plateau to the Alps. Select altitude in 10 m steps.</p>
        <div className="controls">
          <label htmlFor="altitude">Selected altitude</label>
          <div className="number">
            <input id="altitude" aria-label="Altitude in metres above sea level" type="number" min="0" max="5000" step="10" value={altitude}
              onChange={event => {if (event.target.value !== '') setAltitude(Math.min(5000, Math.max(0, Math.round(Number(event.target.value) / 10) * 10)));}}/>
            <span>m above sea level</span>
          </div>
          <input aria-label="Altitude slider" type="range" min="0" max="5000" step="10" value={altitude} onChange={event => setAltitude(Number(event.target.value))}/>
          <div className="range-labels"><span>0 m</span><span>5,000 m</span></div>
          <label className="toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/><span>Dim terrain below {altitude} m</span></label>
        </div>
        <div className="legend">
          <p><i className="dim"/>Below selected altitude</p>
          <p><i className="clear"/>At or above · no dimming</p>
          <p><i className="unavailable"/>Amber: elevation unavailable</p>
        </div>
        <p className="notice"><strong>An altitude scenario, not a fog forecast.</strong> Actual fog height varies by region. Consult <a href="https://www.meteoswiss.admin.ch/" target="_blank" rel="noreferrer">MeteoSwiss ↗</a> for weather information.</p>
        <p className="resolution" aria-live="polite">{resolution}</p>
        <label className="place-picker">Explore a place
          <select aria-label="Explore a place" defaultValue="" onChange={event => {map.current?.goTo(event.target.value); event.target.value = '';}}>
            <option value="" disabled>Choose a location…</option>
            {Object.keys(PLACES).map(place => <option key={place}>{place}</option>)}
          </select>
        </label>
        <details>
          <summary>About nationwide elevation</summary>
          <p>Wide views use nationwide swissALTIRegio overviews. At the 1,000 m scale and closer, the map uses swissALTI3D sampled on a 4 m grid across its Swiss coverage. Elevation tiles are prepared in advance. The 10 m bands follow the altitude control: a height in [650,660) dims at 660 m, while [660,670) stays clear. Close zooms magnify the finest prepared tiles.</p>
          <p>The overlay compares sampled heights with your altitude. Coarse views are approximate: small valleys and ridges can disappear, and boundaries can change as you zoom. A clear sample does not mean every point around it is above the threshold.</p>
          <p>Amber marks loading, missing or failed data, even with dimming off. Heights use LN02 within Switzerland; surrounding countries may use different vertical references. Coverage extends over a rectangular area around Switzerland.</p>
        </details>
      </aside>
      <section className="map-panel" aria-label="Interactive topographic map">
        <div className="map-toolbar"><span role="status">{status}</span><div className="map-actions"><button onClick={() => map.current?.retry()}>Retry elevation</button><button onClick={() => map.current?.recenter()}>Switzerland ↗</button></div></div>
        <div ref={host} className="map" tabIndex={0} aria-label="Map: drag to pan, plus or minus to zoom"/>
        <div className="map-footer"><span>{probe}</span><span>Amber ≠ above threshold</span></div>
        {baseError && <p role="alert" className="map-warning">Some background map tiles are unavailable. <button onClick={() => map.current?.retryBasemap()}>Retry background map</button></p>}
      </section>
    </section>
    <footer>SWISSALTIREGIO + SWISSALTI3D / 10 M THRESHOLDS <span>Map & elevation © swisstopo</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
