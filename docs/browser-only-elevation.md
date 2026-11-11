# Browser-only elevation: evaluation and proposed decision

> Historical evaluation. The subsequent nationwide implementation uses swissALTIRegio native overviews with explicitly approximate sample semantics, plus 2 m swissALTI3D at close zoom. See README.md and FINDINGS.md for the current design. The conservative min/max proposal below was not implemented.

Evaluated 3 November 2026. This is an architecture evaluation; the application has not yet been migrated. Existing uncommitted prototype changes are preserved. No Python was used for this evaluation, and no backend or deployment was introduced.

## Recommendation

Consume official swissALTI3D COGs directly over HTTP, but use an application-controlled browser worker pipeline to decode windows and compute conservative display tiles. Retain OpenLayers DataTile/WebGLTile for display and shader-only threshold changes. Direct COG delivery and browser processing are complementary: even OpenLayers GeoTIFF must decode and, on a Mercator map, reproject in the browser.

Do not simply replace the prepared source with GeoTIFF rendering. Its automatic overview selection does not preserve the existing minimum/maximum and missing-child semantics. Do not port the complete Python regional preparation job into a browser startup task either.

The hard constraint is wide-area startup: exact conservative classification requires all contributing detailed samples unless the upstream source provides suitable minimum and validity overviews. The inspected COGs do not. Nationwide navigation is feasible through bounded viewport loading; instant, exact nationwide classification from a cold cache is not established and should not be promised.

## Evidence from the current project and live sources

The current application reads prepared two-band numeric tiles; it does no source discovery, COG decoding or coordinate transformation. Its coarse cells retain minimum/maximum sampled elevation, and any missing child invalidates a parent. Existing regional inventory reports 272,598,904 compressed source bytes for 256 squares. These are historical pinned 2021 assets, not a claim about today's latest regional inventory.

Three pinned assets were probed: `swissalti3d_2021_2570-1176`, `swissalti3d_2021_2578-1184`, and `swissalti3d_2021_2585-1191`, each with filename suffix `_2_2056_5728.tif` under the official collection.

- A GET with `Range: bytes=0-16383` and a localhost Origin returned HTTP 206 and exactly 16,384 bytes for each file. Total file sizes were 1,118,224; 1,093,339; and 1,018,175 bytes.
- Responses included `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=7200`, and correct Content-Range. No Access-Control-Expose-Headers was present: browser JavaScript cannot assume access to Content-Range, ETag or the SHA256 metadata header. Avoid multipart ranges; test the installed reader with ordinary single-range responses. Missing Accept-Ranges is not evidence of failure when real range GETs succeed.
- Each file has a 500 × 500 base image and only a 250 × 250 overview, with 128 × 128 TIFF blocks. Horizontal CRS is EPSG:2056 and NoData is −9999. Product/asset naming establishes LN02 heights; horizontal GeoKeys alone do not establish vertical datum.
- A regional STAC GET with `bbox=7.1,46.75,7.2,46.85&limit=1` returned 200, wildcard CORS, a feature and a next-page link; cache max-age was 600 seconds.
- In the middle asset, 50,753 of 62,500 overview pixels exceeded their 2 × 2 child minimum by more than 0.001 m. One overview value is 652.087890625 m while its children span 651.7324829101562–652.3773193359375 m. At threshold 652 m the overview would be clear, whereas the current minimum rule dims it. This proves the overview is unsuitable for that rule; it does not establish the precise upstream resampling algorithm.

These probes ran with JavaScript/geotiff.js in Node and inspected real response headers and raster values. They are not browser CORS enforcement tests, device benchmarks, or exhaustive national asset validation. Actual browser decoding and worker bundling remain acceptance gates.

## Options

| Option | Advantages | Costs and correctness | Verdict |
|---|---|---|---|
| OpenLayers GeoTIFF sources, native overviews, Mercator reprojection | Least custom raster code; range-based reads; existing renderer | Native overviews fail minimum semantics; many individual COGs require a viewport source manager; `sources` combines bands, not an arbitrary geographic mosaic; source caches multiply | Useful comparison spike, not a drop-in replacement |
| Worker decoding and conservative tiling, retained Mercator view | Preserves existing basemap and renderer; explicit validity, cancellation and memory budgets | Must implement discovery, seams, reprojection and aggregation carefully; initial wide view requires substantial detail | Recommended migration path |
| Worker decoding, LV95 map and LV95 display grid | Avoids elevation reprojection; easy alignment with source squares | Changes map setup; must verify compatible official basemap grid and controls; does not solve coarse-scale bandwidth | Strong simplification to benchmark before final projection choice |
| Whole-region browser conversion, or GDAL/WASM port | Similar processing model to current scripts | Front-loads roughly 273 MB compressed input for pinned Fribourg data; large transient memory, mobile stalls and repeated work | Reject as startup architecture |

Use geotiff.js explicitly as a pinned direct dependency if application code imports it; it is currently transitive through OpenLayers. Use proj4 with a locally registered EPSG:2056 definition if retaining Mercator; do not depend on a remote projection lookup. Check the installed versions' APIs, worker production build, licensing and bundle size. Avoid adding GDAL/WASM unless a measured unmet requirement justifies its payload and memory cost.

## Processing and correctness contract

1. Discover only a bounded area through the official STAC API at runtime. Transform/densify viewport bounds to WGS84, follow pagination, select the newest eligible 2 m LV95/LN02 asset per source square, and freeze that selection for a session. Validate resolution, geometry, CRS, datum and asset identity; do not infer the latest URL from a year. Handle overlapping editions, partial pages and empty results explicitly. A failed query is unknown coverage, not proof that data does not exist.
2. Schedule visible work with a global concurrency cap, initially two decoding workers and two to four network requests, then tune from measurements. Abort obsolete viewport fetches and discard late results using a generation identifier. Do not create one worker pool or unbounded cache per COG.
3. Read needed base-image windows and required boundary samples. Decode in workers, transfer typed buffers, and avoid repeated full-array copies. Native overviews may be used only for a separately labelled approximate preview, not for the current conservative classification. No such preview is proposed for this migration.
4. Define the sampling contract before coding. To preserve existing behavior, reproduce its nearest-neighbour detailed target grid, then aggregate its children; this remains a sampled terrain model. Aggregating every source pixel intersecting a target cell is a stronger, different contract and must be tested and documented separately. Never treat ordinary nearest-neighbour downsampling as a minimum reducer.
5. Produce threshold-independent minimum/maximum plus validity. Unknown source, NoData, nonfinite samples, failed decode, timeout, missing pagination or incomplete children must never produce a clear cell. Keep failures distinct from valid elevations internally, with amber for unavailable/loading regions even when dimming is disabled. No purple mixed category. Equality remains clear; mixed cells dim based on minimum.
6. Keep amber until a complete valid result is ready. Do not retain a stale clear parent over an unknown replacement. Invalidate coverage on renderer/context failure. Provide bounded retries and a user retry action; retries must not erase known missing-data state prematurely.
7. Preserve LN02 heights without vertical transformation. Probe text must distinguish a detailed sample from a coarse range and must not use stale or evicted tile data.

## Memory, caching and mobile performance

A full 2 m square has 250,000 float samples: 1,000,000 bytes (0.95 MiB). All 256 base squares consume 244 MiB before compressed blocks, derived tiles, workers or GPU copies. A two-band Float32 8192² regional grid alone consumes 512 MiB. Streaming prevents holding either regional dataset in full.

One 256² two-band Float32 tile is 0.5 MiB; 64 retained tiles are 32 MiB of numeric payload before validity, renderer allocations and duplicate CPU/GPU storage. The default GeoTIFF compressed cache ceiling of 100 × 65,536-byte blocks per source could multiply to roughly 1.56 GiB across 256 sources; it is a capacity calculation, not an observed allocation. Use a global byte budget across sources and evict readers as well as output tiles.

Start with a measured/tunable 32 MiB decoded CPU cache, a small renderer cache (for example 32 output tiles), and bounded compressed blocks. These are initial budgets, not guaranteed total-process memory limits. Worker buffers, reprojection buffers, textures and browser overhead count separately. Reduce concurrency on constrained devices. Slider updates must reuse resident tiles and change only uniforms.

Use normal HTTP caching opportunistically, but do not assume 206 responses persist or combine efficiently across browsers. For persistent derived tiles use IndexedDB with a byte-limited LRU; keys include asset identity/checksum when available from STAC, grid/projection, algorithm version and resolution. Store immutable completed arrays only. Quota failure, private mode and eviction must fall back to network computation. Do not require a full-file hash download before displaying each ranged tile; do not claim whole-file checksum verification for partial reads. Cache API is not a drop-in store for 206 responses. Avoid a service worker in the first migration unless independently needed.

Benchmark real iOS Safari and Android Chrome, not just a phone viewport. Record cold/warm bytes, request counts, first valid tile and full visible completion, decode/aggregation time, main-thread long tasks, peak memory where available, panning cancellation, and sustained slider latency. Run both a small detailed view and the full Fribourg extent. No mobile performance claim is currently established.

## Nationwide strategy and limit

Use bounded spatial STAC queries and cached selection metadata; do not enumerate or preload Switzerland at startup. Tile identifiers and caches must be geographic and reusable across region boundaries rather than hard-coded to Fribourg's 8192² pyramid. Enforce request/area budgets before a zoomed-out view queues thousands of squares.

A Switzerland-scale view cannot cheaply obtain exact minimums from these shallow, non-minimum overviews. With the stated constraints the honest initial UX is a basemap with explicit unavailable/zoom-in guidance at overly broad extents, plus bounded local processing when zoomed in. If a fully classified cold-start national overview is mandatory, a suitable authoritative conservative multiscale source must first be found and validated, or the semantics/constraints must change. A coarse DEM is not an equivalent substitute. Do not silently sample fewer points and advertise the result as conservative.

Even the current 256 km² opening extent may require substantial first-load transfer to preserve its existing semantics. Measure it before committing to a fully classified regional opening screen; a detailed initial viewport with a regional boundary is a possible product choice, not an already-approved change.

## Implementation gates

First create an isolated browser spike with three adjacent real source squares, production worker bundling and no prepared data. Verify actual cross-origin single-range decoding in Chromium and Safari, including the unexposed-header behavior. Compare direct OpenLayers and worker-owned rendering, and assess LV95 versus Mercator alignment.

Then test raster invariants with small deterministic fixtures: minima/maxima, equality, missing children, tile edges, invalid samples and interrupted jobs. Check real checkpoints and seams against current prepared output while it remains available as a development reference. Instrument compressed bytes and globally retained buffers. Simulate blocked STAC, blocked ranges, HTTP 200 instead of 206, malformed TIFF, timeout, quota failure and WebGL loss.

Finally migrate runtime discovery/loading, remove preparation from the supported workflow and ensure a clean checkout can run with no Python, pinned offline inventory or prepared elevation files. Run build and interaction checks, confirm no elevation requests on slider changes, and document actual regional/device results. Do not delete historical data or scripts merely to demonstrate the evaluation.

## Primary references

- [swisstopo swissALTI3D product specification](https://www.swisstopo.admin.ch/en/height-model-swissalti3d)
- [Official STAC API root](https://data.geo.admin.ch/api/stac/v0.9/)
- [OpenLayers GeoTIFF API](https://openlayers.org/en/latest/apidoc/module-ol_source_GeoTIFF.html)
- [OpenLayers GeoTIFF reprojection example](https://openlayers.org/en/latest/examples/geotiff-reprojection.html)
- [geotiff.js capabilities and worker/window reading](https://geotiffjs.github.io/geotiff.js/)

No weather prediction, extra mixed-terrain color, backend or deployment is part of this proposal.
