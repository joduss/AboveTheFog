# Swiss Fog Map — prepared elevation and nationwide runtime coverage

React, TypeScript, Vite and OpenLayers. Explore a manual altitude threshold across Switzerland. **This is not a fog forecast.** No application backend or deployment is required. The bounded prepared comparison assets use an optional offline Python preparation step.

## Run

Use Node 22.18+ (or a current Node release):

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Prepared Fribourg and Zermatt views load static numeric band tiles; outside prepared coverage, Internet access is required for runtime catalogue queries and COG ranges. Basemaps require Internet in both cases. Generate the new bounded assets as described in [prepared elevation](docs/prepared-elevation.md); absent prepared assets remain visibly unavailable. Historical `public/data` experiments are excluded from the build.

## Navigation fixes

Fribourg prepared coverage now includes a roughly **14 × 14 km** area using existing local sources. A bounded decoded-tile cache prefetches a one-tile margin with two background slots. Loaded terrain and previews stay visible while dragging, and loading text no longer resizes the map. The measured pan route that previously took 16–37 seconds now settles in 0.7–0.8 seconds including the gesture. This does not establish nationwide fast detail coverage: remote TIFF acquisition still costs more outside the prepared areas. See [navigation results and verification](docs/navigation-fixes.md).

## Prepared comparison areas

The default numeric raster path uses an aligned **4 m LV95 grid** and **10 m height bands** in Fribourg and Zermatt. The controls use 10 m thresholds; tapping prepared terrain shows a half-open height range. Equality stays clear. Whole delivery tiles contained inside the evaluation footprints use prepared data from z13–17 (enlarged above z17); crossing tiles and wider views retain runtime sampling. The status identifies prepared, runtime and mixed coverage. Failed prepared loads stay amber, including with dimming off.

The measured cold production views completed in **722 ms (Fribourg)** and **775 ms (Zermatt)** on the documented desktop, compared with 12.5 s and 14.7 s for runtime COGs. See [format contract, generation instructions, benchmarks and limits](docs/prepared-elevation.md). These are single desktop runs, not physical-phone claims. `?prepared=vector` selects the comparison format; `?prepared=off` forces the current COG pipeline.

## Runtime elevation by zoom

- **Zoom 7–14:** swissALTIRegio, a nationwide 10 m grid with existing reduced-resolution COG images. The browser selects a level suitable for the map scale (approximately 10, 40, 80, 160, 320 or 640 m). At the initial national view, approximately 320 m samples are typical; screen size changes the initial zoom.
- **Zoom 15+:** runtime STAC discovery of nearby 2 m swissALTI3D files, selecting the latest eligible edition per square. Elevation display tiles stop refining at zoom 17; further zoom enlarges those samples.
- Map zooms settle at whole levels. Between levels, elevation selects the coarser level to avoid excess work. The status and resolution label identify the current source.

The wide view is an **approximation**, not a conservative minimum of all underlying 2 m terrain. The shader compares the sampled height with the selected altitude; equality stays clear. Small valleys/ridges can disappear and boundaries may change at resolution or source transitions. This intentionally replaces the old Fribourg minimum/maximum pyramid semantics following the request for lower-resolution national coverage. No purple mixed category is used.

Amber identifies pending, missing or failed elevation, including outside the supported rectangle. Turning dimming off retains amber. Failed detail does not silently fall back to coarse data. Use **Retry elevation** to clear the current rendering cache and restart workers. The supported rectangle encloses Switzerland (5.95–10.5° E, 45.8–47.85° N), so some neighboring territory is visible too. Heights are LN02 within Switzerland; swissALTIRegio retains original vertical references in foreign areas.

## Downloads and resource limits

The roughly 10.1 GB swissALTIRegio COG is **not downloaded in full**. Only required headers and compressed blocks are requested with single HTTP byte ranges. HTTP 200 in response to a range request is rejected before reading the body. Range requests time out after 20 seconds and worker tile jobs after 60 seconds. Source changes are discovered at runtime; no offline asset inventory is used.

Two workers handle elevation tiles. Each worker permits two simultaneous range transfers, reads no more than 1,048,576 samples in one window, and retains at most twelve COG readers. Regional readers use 64 KiB blocks with a 32-block cache setting. Detailed readers use bounded 2 MiB ranges with a one-block cache setting and reuse decoded 1 km source squares while resident. STAC query results are bounded to 64 entries per worker, with an eight-page cap per local query. Quota caps and incomplete catalogues fail explicitly.

OpenLayers has a 128-tile elevation texture cache. One Float32 256² height tile is 256 KiB; 128 such arrays are 32 MiB, before GPU copies and other allocations. Coverage bookkeeping is bounded to 256 tile records. Complete runtime/prepared raster samples use the bounded persistent cache described below. Prepared cache keys include the input fingerprint; failed or incomplete data is never persisted. A large cold detailed viewport still needs multiple source downloads; physical-phone memory, sustained performance and battery consumption have not been benchmarked.

Slider/toggle changes update shader variables only. Source downloads and worker processing are independent of the threshold. Workers stop on disposal, context failure or retry; already-started offscreen work may finish and remain reusable while panning. National coverage does not trigger nationwide enumeration or 2 m downloads.

## Verification

```sh
npm test                 # source selection, loading/cache semantics and prepared codec
npm run test:prepared-browser # real prepared assets, failures, pan/zoom and phone layout
npm run build            # TypeScript + production app and worker bundle
npm run test:worker      # blocked catalogue, ignored ranges, corruption, cancellation
npm run test:live        # real remote elevation in the production worker, six locations
```

The live worker check uses Node's worker transport to exercise the production bundle. It does not substitute for browser CORS/rendering or physical-device tests.

Optional automated browser regression checks require Playwright Chromium:

```sh
npx playwright install chromium
npm run preview -- --port 5174
npm run test:browser
```

Use `MAP_URL` to target a different local server. Browser checks cover source switching, stable tile requests, slider/toggle reuse, phone-sized layout, failed downloads and recovery. This suite was added but not executed here because the Playwright browser executable is absent. The production app was instead exercised in the in-app browser: real CORS/range reads, national/detail views, controls, zoom transitions and retry. See FINDINGS.md for measured results and limitations.

`?debugTiles` adds bounded request diagnostics to the map's DOM attribute for regression testing; it does not change loading behavior. A loading count can legitimately increase when the viewport changes. It should settle when the view is stationary.

## Structure

- `src/main.tsx`: controls, source-resolution explanation and location shortcuts.
- `src/terrainMap.ts`: OpenLayers rendering, coverage mask, shader variables and lifecycle.
- `src/terrain/elevation.worker.ts`: runtime catalogue discovery, bounded COG ranges, decoding and nearest-neighbor coordinate sampling.
- `src/terrain/workerPool.ts`: two-worker scheduling and disposal.
- `src/terrain/math.ts`: resolution selection, missing-data validation and source-edition selection.
- `scripts/prepare_bands.py`, `scripts/prepared/`, `public/prepared/`: bounded 4 m / 10 m comparison pipeline, pinned inventories and ignored reproducible output.
- `src/terrain/prepared*`, `src/terrain/bands.ts`: prepared coverage, codecs and experimental vector renderer.
- `scripts/prepare.py`, `scripts/prepare_region.py` and `public/data/`: historical offline experiments; not used or shipped by this app. `npm run test:legacy` checks these only when their datasets are present.

## Sources

- [swissALTIRegio specification and vertical-reference caveat](https://www.swisstopo.admin.ch/en/height-model-swissaltiregio)
- [swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d)
- [Official STAC catalogue](https://data.geo.admin.ch/api/stac/v0.9/)
- [Background map service](https://docs.geo.admin.ch/visualize-data/xyz.html)
- [geotiff.js](https://geotiffjs.github.io/geotiff.js/)

Retain swisstopo attribution. Nothing has been published or deployed.

### Loading improvements

A separate coarse preview loads while detail is processed; the status labels it approximate. Detailed tiles replace the preview without stacking both dimming overlays. Obsolete elevation work is cancelled and queued tiles are ordered from the current view centre. Complete tiles are cached locally for seven days, bounded to 192 tiles (approximately 48 MiB). Storage failures fall back to normal downloading; failed or incomplete tiles are never persisted. The cache version must change when sampling semantics change.

National zooms 7–8 now load fingerprinted swissALTIRegio samples from the app's static assets. Background imagery is clipped to its advertised extent, and a visible failure can be retried without reloading the map. The investigation includes measurements and a phased rollout for near-instant detailed terrain. [Tile loading plan](docs/tile-loading-plan.md)
