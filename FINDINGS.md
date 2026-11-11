# Prototype findings

## Navigation follow-up

A short pan crossed the original small prepared footprint and triggered 188 TIFF requests, taking 37 seconds. Fribourg now has a roughly 14 × 14 km prepared footprint using the existing 256 local official sources, plus bounded look-ahead caching. The same pan sequence took 660/808/750/720 ms including gestures, with no STAC/TIFF requests. Availability masks update before drawing and during interaction; previews retain their loaded data and rendered images across pans; fixed map dimensions prevent status text from triggering new tile layouts. A real-pointer regression sampled 564 loaded tile positions with delayed edge requests and found no amber flashes. Outside prepared coverage, catalogue searches reuse spatial cells and resident detailed source squares are decoded once. See [navigation verification and limits](docs/navigation-fixes.md).

## Prepared 4 m / 10 m comparison — 4 November 2026

Implemented bounded generation from official swissALTI3D for Fribourg and Zermatt, on one aligned 4 m LV95 lattice per area. Signed floor-quantized 10 m bands retain distinct NoData. Both gzip int16 raster tiles and discrete elevation-band GeoJSON vector tiles derive from the same samples; all generated vector polygons rasterize back with zero band mismatches across 70,516,736 delivery pixels. Source editions, checksums, overviews and resumable checkpoints are recorded.

Raster is the selected client default. In the fixed 759 × 751 production-browser view, cold Fribourg completed in 722 ms and Zermatt in 775 ms, versus 12,504 ms and 14,744 ms for the current COG path. Prepared views issued 16 static tile requests and zero STAC/TIFF requests; threshold changes issued no elevation requests. Raster used 55.0/130.9 kB per viewport, versus vector 431.9/1323.7 kB. The prepared browser regression passed both areas, 10 m controls, band inspection, pan/zoom, persisted reload reuse, failed-tile visibility with dimming disabled, retry and phone-sized layout. Physical devices and process/GPU peak memory remain unmeasured.

See [the full contract, reproducibility instructions, format selection and limits](docs/prepared-elevation.md), [raw browser results](docs/prepared-elevation-benchmark.json), and [generation metrics](docs/prepared-elevation-generation.json). Older browser-only and historical findings below describe prior stages. Nothing was deployed or generated nationwide.

## Nationwide browser-only implementation — 3 November 2026

The current app replaces the prepared Fribourg pipeline with runtime COG loading across Switzerland. It uses swissALTIRegio at map zooms below 15 and local 2 m swissALTI3D discovery from zoom 15. All decoding and coordinate sampling run in two browser workers. The national COG currently measures 10,110,274,504 bytes but is accessed only through ranges. Its six images are 55000×43000, 13750×10750, 6875×5375, 3438×2688, 1719×1344 and 860×672, giving roughly 10–640 m spacing. NoData is approximately 3.4e38. The official product page documents 10 m LV95 data and LN02 within Switzerland; foreign heights may use their original vertical reference.

This is a deliberate semantics change: coarse height samples are approximate, not the earlier min/max bounds. UI text says that small terrain features can disappear and boundaries can change with zoom. Missing or failed samples remain amber even with dimming disabled. No prepared dataset or pinned offline inventory is needed or shipped; historical files remain in the workspace.

Production-worker real-source checks succeeded at six locations. These are Node worker timings on the available host, **not phone/browser performance claims**:

| Location / level | Worker time | Range bytes | Missing samples |
|---|---:|---:|---:|
| National sample tile / ~320 m | 1,343 ms | 1,310,720 | 0 |
| Fribourg / 2 m | 1,429 ms | 1,093,339 | 0 |
| Geneva / 2 m | 1,155 ms | 1,196,447 | 0 |
| Zurich / 2 m | 1,124 ms | 1,677,319 | 0 |
| Lugano / 2 m | 1,394 ms | 1,110,390 | 0 |
| St. Moritz / 2 m | 1,626 ms | 1,538,354 | 0 |

Each result contains 65,536 numeric samples. Tests also passed for overview choice, exact threshold equality, invalid heights, missing data with dimming off, tile extent adjacency and latest eligible 2 m edition selection. Production-worker fault injection passed for failed catalogue queries, a server returning HTTP 200 to a range request (body cancelled without reading), malformed TIFF and cancellation.

The in-app browser successfully loaded the real production app and rendered national and close Fribourg terrain. This verifies browser cross-origin range use despite Content-Range not being exposed to JavaScript. A user-observed blinking/loading problem was investigated with tile-request traces: the first build repeated some detail requests during animated source changes with a 64-entry cache. The revised build uses a bounded 128-entry cache, coarser selection between zooms, settled integer zooms and direct location jumps. A 1048×1105 map viewport loaded all 30 visible Fribourg detail tiles once; it reached ready, and controls reused the same requests. Zooming out and back also settled. Some extra edge tiles can legitimately be requested during a changed viewport; the progress count is not a monotonic lifetime counter. Retry resets renderer caches as well as workers.

TypeScript and production builds pass. The JavaScript worker bundle is approximately 430 kB uncompressed; the main app is approximately 615 kB / 185 kB gzip. Vite still reports the main chunk size advisory. geotiff 3.1.0-beta.0 is explicitly pinned (the same version already present transitively through OpenLayers); proj4 is pinned at 2.22.0. There is no application-level persistent cache. Physical iOS/Android, storage persistence and peak GPU/process memory remain unmeasured. The automated browser regression suite requires a Playwright Chromium installation absent here, so no automated phone/failure-browser suite pass is claimed.

Earlier findings below describe historical prototypes and are not the current runtime architecture.


## Fribourg regional expansion — 3 November 2026

The application now covers a 16 × 16 km region (256 km²), 64 times the original sample area. Bounds are LV95 E 2570000–2586000 / N 1176000–1192000. The regional STAC query selected 256 latest available 2 m assets, all from 2021; URLs and upstream SHA256 hashes are pinned in `scripts/fribourg-sources.json`. Source downloads total 272,598,904 bytes.

The new preparation pipeline produces 1,365 gzip-compressed 256² two-band tiles across six zoom levels, totalling 85,987,276 bytes. Finest ground spacing is approximately 2 m. Each overview preserves the minimum and maximum of its sampled children. Cells straddling the threshold use normal dimming, based on their minimum; the separate purple category was removed at the user’s request. Any missing child makes the parent unavailable. This prevents averaging from turning a low/high mix into an entirely above-threshold overview. It does not remove the spatial sampling limitations of the finest resampled grid.

The browser requests viewport tiles and OpenLayers maintains a 64-entry renderer cache. Slider and toggle changes only update shader variables. No new runtime dependencies were added. `src/terrainMap.ts` separates map lifecycle/loading from React UI state. A failed tile returns an explicit NoData tile; amber remains visible with dimming off. A WebGL availability check prevents an unsupported browser from silently advertising valid coverage. The loader handles both raw gzip files and automatic HTTP gzip decoding; Vite exercises the latter.

Verification completed: all 1,365 output hashes and tile layouts; all 66,408,081 valid detailed samples counted; every parent/child minimum, maximum and missing-data relationship across the entire pyramid; source/checkpoint comparisons; TypeScript and production build. Four prepared/source/height-service spot checks are recorded in `public/data/fribourg/checkpoints.json`: Fribourg cathedral area 586.4 m, Marly 600.8 m, Düdingen 590.9 m, Belfaux 573.4 m. These prepared values agree with the independent swisstopo height-service samples within 0.1 m.

Visual verification succeeded in the in-app browser: Fribourg/Marly terrain renders with the expected 746 m threshold, lower areas dimmed and hills above the threshold clear; screenshot saved locally in `test-results/fribourg-in-app.png`. The native browser was also observed at different zoom/altitude settings. Automated headless verification was attempted but blocked by Chromium failing to create a WebGL context (`WebGLHelper` received null), including after cleanup and a software-rendering attempt. The new `tests/region-browser.cjs` contains the viewport-fetch, slider/toggle, pan/zoom, phone layout and failed-load checks, but the full suite has **not passed in this environment**. No new regional frame-rate or physical-phone performance claim is made. The earlier Uetliberg measurements below remain historical only.

Nationwide work still requires deployment/storage selection, a national inventory and robust incremental tile production, device performance tests and production retry UX. This region remains local; nothing was deployed.

## Original Uetliberg experiment (historical)

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

Headless Chromium 151 on this Mac, 1400 × 950 desktop and 390 × 844 phone-sized layout. Screenshots inspected for map/contour alignment, text and control readability. Pan, zoom, recenter, both overlay states, numeric/slider synchronization and deliberate elevation request abort exercised. Exactly one elevation binary request occurred through repeated threshold/toggle changes. Phone layout had no horizontal overflow. Phone-sized browser emulation is **not a physical phone test**. A separate touch-emulation launch was declined by the user; touch interaction, physical Safari/Chrome and thermal behaviour remain untested.

Thirty input-to-next-animation-frame measurements after loading: approximately 38–57 ms for most samples (one 8 ms sample); median around 43 ms in the second run. Earlier run had a 97 ms outlier. The final run after keeping NoData visible with dimming off was slower: roughly 71–117 ms, median about 84 ms. Host/headless variability is substantial; responsiveness is usable for the prototype but not yet proven adequate for production. This is headless rendering on the available host and includes scheduling; it does not establish 60 fps or input-to-photon latency. The interaction works, but physical-device performance must be validated before calling it production-ready. No elevation network request is made per adjustment.

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

## Progressive loading — 3 November 2026

Added a separate coarse preview worker, with approximate status and preview removal beneath completed detail tiles. The detail queue cancels obsolete work on view changes and prioritizes the view centre. Complete elevation tiles persist for seven days in a versioned browser cache bounded to 192 entries (~48 MiB); storage errors fall back to downloads. Retry bypasses persisted samples for the rest of the session.

Build, elevation checks, worker failure checks and new cache/scheduler checks pass. A deterministic Brave browser test verifies preview-to-detail refinement, cache reuse after page reload and rapid location changes; preview and refined screenshots were inspected. These simulated elevation checks do not establish live-source speed or physical-phone performance.

The live-source browser run reached national and detailed views but timed out after zooming out. Cancellation now defers resetting tile state until OpenLayers has released its request slot. The requested final browser rerun was declined, so full live-source regression verification remains incomplete. Unit and worker-failure checks pass after the fix. The initial `Swiss wide support` commit was created as `c189802`; an external reset subsequently removed it from the branch tip. No subsequent Git history changes were made here.

### Loading recovery follow-up

Cancelled active jobs now terminate and replace their worker immediately, so the queue does not depend on TIFF decoding acknowledging an abort. A main-thread 65-second watchdog also rejects a stalled active tile and replaces its worker; the tile follows the existing unavailable-data path. Cache reads fall back to downloads after 1.5 seconds if CacheStorage stays pending. These safeguards cover indefinite waits; the exact cause of the user's loading report has not been established.

Unit checks cover silent workers, cancellation without a reply, queue recovery after timeout and stalled storage. Build and worker-failure checks pass. Deterministic browser checks pass for zooming during initial loading, preview/refinement, persistent reuse and switching locations away from stalled workers. The live-source browser suite also passes national/detail loading, a zoom round trip, phone-sized layout, failed requests and retry.
