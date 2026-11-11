# Swiss map tile loading, 10 November 2026

## Why the warning persists

On an 1100 × 850 desktop the initial fit selected zoom 7. The previous production build requested 16 background JPEGs. Four requests in row 43 returned HTTP 400. The provider's response for 7/66/43 explicitly said “Tile out of bounds”. The application used a worldwide XYZ source for a regional layer. React latched the first error for the lifetime of the page. The warning remained after navigating to Fribourg even though its background requests succeeded. The configured order of the URL coordinates and the JPEG suffix match the provider's example. [swisstopo XYZ service](https://docs.geo.admin.ch/visualize-data/xyz.html)

The revised layer clips requests to the provider's published geographic extent and keeps the standard Web Mercator tile origin. Failed tiles get one automatic retry through the map queue. Only a repeated failure for a tile wanted by the current frame raises an alert. Moving away releases the failure, and the retry button or a connection-restored event requeues the failed tiles individually. [swisstopo EPSG:3857 capabilities](https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml)

## Where the time goes

The background JPEGs, elevation overview and full-resolution samples have separate completion times. The previous production build spent 4.49 s reaching settled national elevation, including 29 remote range responses. At Zurich the last background JPEG response arrived around 5.2 s after the shortcut, even though the first arrived in 148 ms. Eight map-wide loading slots were shared with long-running terrain jobs. The Zurich elevation run exceeded the benchmark's wait limit. A separate development-server run did settle in 18.34 s. These are individual observations, and the development run includes Vite overhead.

For a controlled nine-tile Fribourg **runtime** workload, two workers made 184 TIFF range requests for nine distinct files. The worker already decodes complete detail squares but used the same 64 KiB range block size as the multigigabyte regional TIFF. With 2 MiB blocks for detail and one retained block per detailed reader, the same workload made 13 range requests. The first batch fell from 7.67 s to 3.14 s, with zero failed or missing samples in either run. Transferred TIFF bytes rose from 12.43 MB to 14.13 MB. Catalogue time varied between runs. The request count is a more reliable measure of the change than the wall-time ratio. The national TIFF retains small bounded reads and rejects full-file responses.

## Changes in this build

- Zooms 7 and 8 use 16 static, individually fingerprinted elevation tiles. Each holds the original Float32 samples, source spacing and NoData. All 1,048,576 samples and spacing values matched a fresh run of the production sampler byte for byte. The complete set is 3.61 MB compressed. The default desktop view requests four tiles, about 0.88 MB. Vite emits separate asset URLs so location shortcuts can fetch just the relevant overview.
- Unprepared close views can display the bundled zoom-8 surface while 2 m detail loads. The preview is coarse enough that a street-scale view can share a single height sample across many buildings. The status marks it approximate, and missing samples stay amber with dimming on or off. Fully prepared views continue to fetch their local detail directly. The diagnostic comparison mode `?prepared=off` retains live source processing.
- The browser preconnects to the imagery origin. The basemap displays decoded tiles without the former 250 ms fade. OpenLayers has its standard 16 shared loading slots, while expensive full-resolution processing stays bounded to two workers. Those workers start on the first actual runtime cache miss. National and fully prepared starts avoid the worker bundle and initialization.
- The performance check records the first painted background centre pixel at national startup, centre terrain availability, centre detail and settled visible elevation independently. The terrain measurements use frame-level availability metadata. NoData at the boundary is a valid terminal result. The first background pixel and terminal elevation status do not establish that every background pixel is sharp.

## Revised production build measurements

Three runs in headless Brave 155, desktop viewport 1100 × 850, fresh browser context per run, localhost static assets and live upstream services. Each run opened the national view before selecting the three destinations below. Figures are observed ranges. Browser storage was cold on entry and upstream edge caches were uncontrolled.

| View | First centre terrain, including approximate | Centre at requested detail | Visible elevation settled |
| --- | ---: | ---: | ---: |
| National startup, z7 | 337–426 ms | 337–426 ms | 337–426 ms |
| First Fribourg selection, prepared z15 | 5–15 ms | 56–66 ms | 115–129 ms |
| First Zurich selection, runtime z15 | 13–16 ms | 1.11–1.18 s | 2.98–3.13 s |
| Return to Fribourg, resident z15 | 14–15 ms | 14–15 ms | 14–15 ms |

On the national view the first opaque centre pixel on the background canvas appeared in 522–646 ms. Eight WMTS JPEGs were requested. National startup and prepared Fribourg issued zero remote elevation requests. Zurich issued 9–11 catalogue and 18–21 TIFF requests. The return to Fribourg issued zero WMTS, catalogue or TIFF requests. The map's availability metadata can report resident terrain before its underlying imagery arrives. The 5–16 ms shortcut figures include reuse of the national parent tile and apply to navigation within an open map.

Three additional cold navigations went straight to Zurich with no resident national parent. The first sampled frame showing both the centre background and approximate terrain was at 322–346 ms, centre detail at 1.57–2.81 s, and settled visible 2 m detail at 3.50–6.03 s. Run with `START_PLACE=Zurich RUNS=3 node scripts/benchmark_tile_loading.cjs` to repeat. Local static hosting, an unthrottled desktop and three samples establish a development baseline. Hosted and physical-phone p95 measurements remain open.

## Rollout for near-instant detail

1. **Move detail preparation off the visitor's device.** Extend the existing 4 m LV95 / 10 m band raster pipeline to Zurich and the other unprepared place shortcuts, including their pan corridors. Generate each intersecting XYZ key once, including shared boundary and parent tiles. Keep the source edition in the manifest, LN02 within Switzerland, strict threshold equality, explicit NoData and the location probe's band label. Quantized terrain needs the existing prepared-area label wherever it replaces a 2 m runtime sample. Wide intermediate zooms 9–12 also need prepared swissALTIRegio overviews to remove the remaining cold overview processing.
2. **Publish versioned coverage in batches.** For each region, verify seams, representative heights, missing samples and every delivery checksum. Upload raster tiles to static hosting or a CDN, then switch the small coverage manifest after all referenced assets are readable. Retain the previous version while clients can still reference it. Use immutable HTTP caching for fingerprinted assets, and revalidate the coverage manifest. The existing two-region extrapolation estimated about 2.1 GB of compressed nationwide raster payload at z13–17. Measure actual size, object count, build time and update cost for the Zurich batch before committing to a national run. [Prepared data measurements](prepared-elevation.md)
3. **Schedule for what the user sees.** Draw available imagery and the closest resident parent immediately. Fetch current centre and visible detail before one-ring look-ahead. Share each in-flight tile across preview, detail and prefetch consumers. On a new gesture, drop obsolete queued work and keep completed tiles resident under the existing memory budget. Defer speculative traffic while any visible tile lacks coverage, especially on constrained connections. If cold JPEGs dominate after static terrain rollout, evaluate a versioned same-origin national basemap overview against live WMTS and measure its paint improvement and update cost separately.
4. **Release against a measured latency budget.** Proposed targets on a specified 20 Mbit/s, 40 ms RTT connection are p95 ≤500 ms for a usable centre (basemap plus approximate terrain) from cold navigation, ≤500 ms for new prepared centre detail after a pan, and ≤1 s for settled visible prepared detail. A fully resident revisit should show the centre within 100 ms with zero terrain transfers. Record the cold-start budget from navigation and the pan budget from the final pointer event. Account for transfer size as well as CPU. Four national tiles alone need about 350 ms at 20 Mbit/s before browser startup or latency. If startup misses the budget, benchmark a small 10 m band overview for the first frame with the full Float32 samples fetched on refinement or inspection. Validate identical threshold classifications and preserve exact probe heights.
5. **Verify the slow routes before widening coverage.** Run at least 30 cold, HTTP-warm and decoded-cache-warm visits per route on desktop and a physical midrange phone. Cover national startup, Fribourg, Zurich, an alpine region, an unprepared area, crossing a prepared boundary, rapid pan/zoom and offline recovery. Record p50/p95 for centre imagery, first valid centre terrain, sharp centre detail and complete visible coverage. Also record bytes by origin, cancellations, decode time, peak memory and alert duration. Require zero live STAC/TIFF requests in fully prepared views, zero retries for out-of-coverage coordinates and zero lost NoData samples. Publish the next batch only after its own measurements meet the budget.

## Verification

The production build, unit suite and worker failure checks passed. Browser checks covered automatic and manual background recovery, a persistent failed tile beside a recovered tile, navigation away and back, prepared-area cache reuse, threshold changes, phone-sized layout, unavailable terrain and stalled obsolete workers. A pointer-drag regression sampled 564 loaded tile centres with delayed incoming edge tiles and observed zero amber flashes.

## Reproduction

Run `npm run build` and `npm run preview -- --port 5177`. In a second terminal:

```sh
npm run test:basemap-browser
RUNS=3 node scripts/benchmark_tile_loading.cjs
node scripts/benchmark_elevation.mjs 2 3
node scripts/prepare_overview.mjs --check
```

The browser commands accept `BROWSER_PATH` and `MAP_URL`. Each benchmark repetition creates fresh browser storage, navigates to the national view and then selects Fribourg, Zurich and Fribourg again. The final visit measures decoded reuse. To refresh national data, build the production sampler, run `node scripts/prepare_overview.mjs`, verify with `--check`, then rebuild so the asset hashes update. This build uses the swissALTIRegio catalogue item dated 28 May 2026. [Source item](https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissaltiregio/items/swissaltiregio)
