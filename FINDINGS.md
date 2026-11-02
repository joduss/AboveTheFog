# Prototype findings

## Decision

Use an offline-prepared numeric elevation tile, served statically and rendered by OpenLayers DataTile + WebGLTile. Four real 2 m swissALTI3D source COGs cover a 2 × 2 km area around Uetliberg. Terrain below the threshold is dimmed; equality is clear. Changing the threshold updates a shader variable without fetching or recalculating terrain.

The complete source sample is 5,270,267 bytes. The prepared 1024² decimetre raster is 2,097,152 bytes before HTTP compression. Its Float32 GPU upload is about 4 MiB, plus renderer textures and CPU copies. Source elevation range is 444.33–871.93 m. 1,017,927 pixels are valid; the remaining 30,649 are explicitly missing at warped edges.

## COG versus prepared delivery

A real remote COG was fetched and decoded with geotiff.js (already an OpenLayers dependency): 500 × 500 float samples, EPSG:2056, metre horizontal units, −9999 NoData. One recorded remote fetch/decode took 380 ms. Fetching the entire prepared four-tile sample from localhost and constructing its typed array took 41 ms. **These are different network paths and different extents, not a controlled speed ratio.** `scripts/compare.mjs` reproduces the experiment in Node; direct COG rendering in the browser was not implemented.

Direct COG remains viable: OpenLayers supports GeoTIFF decoding and style variables. It would require registering LV95, browser reprojection or a LV95 map, coordinating four sources/mosaicking, range/CORS behaviour and overviews. Prepared delivery adds an offline Python/GDAL step but removes those responsibilities from the browser. It is the simplest tested browser path here. This is one numeric tile, not yet a nationwide multizoom tile pyramid; that extension remains work.

## Correctness

GDAL reads EPSG:2056 and 2 m pixel spacing from every original. Heights use LN02 (EPSG:5728) per the product specification and asset names; the TIFF's horizontal GeoKeys alone do not establish its vertical datum. Reprojection changes only horizontal coordinates. NoData stays distinct throughout preparation and rendering, including when dimming is switched off. Failed or incomplete downloads leave the entire map amber with an explicit unavailable message. WebGL context loss also invalidates elevation display.

Spot checks compare source pixels, prepared pixels, and swisstopo's independent height-service query at the same WGS84 coordinate:

| Point | Lon, lat | Source m | Prepared m | Height service m |
|---|---|---:|---:|---:|
| Uetliberg summit area | 8.4914, 47.3495 | 869.772 | 869.8 | 869.9 |
| Eastern slope | 8.4990, 47.3510 | 603.105 | 603.0 | 603.1 |
| Near Albisgüetli | 8.5090, 47.3520 | 493.612 | 493.6 | 493.7 |

Height service: `https://api3.geo.admin.ch/rest/services/height?easting=E&northing=N`, LV95 coordinates obtained with Rasterio. It is a verification reference, not used by the application. Points are ground samples near named places, not surveyed benchmarks. The topographic map's Uetliberg 870 m annotation agrees visually. Overlay boundaries follow contours; at 650 m the valley and eastern slope dim while the summit remains clear; at 800 m the exposed ridge contracts. Values at/above 900 m dim all valid terrain, while 0 m dims none. `npm test` verifies coverage counts, checkpoints and monotonic threshold classification against real data.

## Browser verification

Headless Chromium 151 on this Mac, 1400 × 950 desktop and 390 × 844 phone-sized layout. Screenshots inspected for map/contour alignment, text and control readability. Pan, zoom, recenter, both overlay states, numeric/slider synchronization and deliberate elevation request abort exercised. Exactly one elevation binary request occurred through repeated threshold/toggle changes. Phone layout had no horizontal overflow. Phone-sized browser emulation is **not a physical phone test**; physical Safari/Chrome and touch/thermal behaviour remain untested.

Thirty input-to-next-animation-frame measurements after loading: approximately 38–57 ms for most samples (one 8 ms sample); median around 43 ms in the second run. Earlier run had a 97 ms outlier. This is headless rendering on the available host and includes scheduling; it does not establish 60 fps or input-to-photon latency. The interaction works, but physical-device performance must be validated before calling it production-ready. No elevation network request is made per adjustment.

`npm run build` performs strict TypeScript checking and Vite production bundling. Initial npm audit reported zero vulnerabilities. Only React, React DOM and OpenLayers are runtime direct dependencies; Vite, TypeScript, React types and Playwright are development dependencies. OpenLayers brings geotiff, spatial indexing and geometry/protobuf helpers even though this path does not decode COG in-browser. The production bundle is 610 kB uncompressed / 183 kB gzip JS (Vite reports its >500 kB chunk advisory); all app code is locally served. No UI/state framework or OpenLayers React wrapper was added.

## Limitations and national coverage

- This proves one 4 km² altitude scenario, not regional fog conditions or national coverage.
- The 2 m source is resampled to roughly 2 m on the ground and quantized to decimetres. This is not survey-grade interpolation, and the dataset's own accuracy still applies.
- Browser support currently requires WebGL. Failed loading is explicit, but recovery requires reload. The basemap remains a network dependency.
- Choose fixed 256/512-pixel national tiles and zoom-dependent resolutions; stream viewport tiles with a bounded cache. Preserve NoData in every zoom level and avoid averaged elevations silently implying safety at ridgelines. Define what overview pixels mean before introducing them.
- Add deterministic pinned-source inventory, checksum validation, incremental regeneration, pyramid QA, cross-tile seam tests and dataset update policy. Current manifest records hashes but does not enforce a published upstream hash.
- Benchmark delivery/compression, GPU memory and sustained slider performance on physical phones. Add accessibility and browser compatibility testing, retry controls and detailed loading status.
- Evaluate static hosting bandwidth, HTTP caching and swisstopo service fair-use limits. No application server or database is required by this design.

Source documentation and licensing links are in README. Nothing has been published or deployed.
