# Elevation performance investigation — 4 November 2026

The largest opportunity is to stop repeating source discovery, TIFF reads and
coordinate conversion for each display tile. Keep React and the existing GPU
threshold shader. Evaluate the official tiled terrain service as a separate
architecture spike if approximate mesh-derived heights are acceptable.

This investigation adds a benchmark, not runtime changes. Existing workspace
changes are preserved. No deployment or new dependency was introduced.

## Measurements

`node scripts/benchmark_elevation.mjs 2 3` runs the current worker source with
timing instrumentation, using nine adjacent z15 tiles around Fribourg. It uses
TypeScript transpilation and Node worker transport; it does not measure browser
rendering, CacheStorage, preview, mobile devices or a complete app viewport.
The repeat phase intentionally bypasses the application's completed-tile cache
to expose source-cache behavior, as encountered when generating new nearby tiles.

| Experiment | First result / tile work* | Nine tiles | TIFF bytes delivered to JS | Catalogue / range requests |
| --- | ---: | ---: | ---: | ---: |
| Two workers, initially empty worker caches | 1.73 s | 6.74 s | 12.13 MB | 9 / 159 |
| Same workers, repeat tiles | 0.53 s | 2.77 s | 12.19 MB | 0 / 156 |
| Four workers, initially empty worker caches | 2.46 s | 4.69 s | 12.79 MB | 9 / 163 |
| Two workers, larger source caches | 1.39 s | 4.31 s | 11.10 MB | 9 / 145 |
| Larger source caches, repeat tiles | 0.48 s | 2.78 s | **0** | **0 / 0** |

\*First tile processing time excludes worker startup. MB are decimal; bytes
exclude catalogue JSON and protocol overhead. Every tile in these runs had zero
missing samples and zero reported failures.

These are exploratory sequential runs, not controlled speedup comparisons.
Catalogue/backend caches warmed substantially: initial catalogue time summed
across jobs was 6.88 seconds, versus 0.46 seconds in the larger-cache run. A later
baseline rerun completed in 4.14 seconds, so the larger-cache cold time is **not**
evidence of a 36% speedup. Four workers also benefited from warmer catalogue
responses. Increasing concurrency is not established as a net improvement.

The larger-cache profile changes only four to 32 compressed blocks per detailed
reader and five to 16 readers per worker, inside the benchmark. With two workers
its compressed-cache capacity ceiling rises from roughly 2.5 MiB to 64 MiB,
before metadata, decoded arrays and GPU memory. This is evidence for cache reuse,
not a mobile-ready cache configuration. Prefer a global byte budget.

Raw logs are in `test-results/performance-*.json` (ignored local artifacts).
The script prints one JSON object per phase. Reproduce the cache experiment with
`node scripts/benchmark_elevation.mjs 2 3 source-cache`.

## Specific bottlenecks and fixes

### 1. Catalogue discovery repeats per display tile

`elevation.worker.ts:77–100,149` keys discovery by z/x/y inside each worker.
Adjacent display tiles ask overlapping catalogue questions independently;
different workers cannot reuse each other's results. The first nine-tile run
made nine catalogue requests. A changed zoom repeats discovery again.

Introduce a shared catalogue broker keyed by bounded geographic cells. Cache
complete source-square selections and deduplicate in-flight queries. Retain
latest eligible editions and complete pagination; a failed query must remain
unavailable, never become an empty successful inventory. Source revisions should
participate in cache invalidation. This removes a repeated startup dependency
while retaining runtime discovery and browser-only operation.

### 2. Source caches are too small and isolated

`elevation.worker.ts:57,65` retains only four 64 KiB compressed blocks per detailed
file and five readers per worker. Individual source files are commonly around
1 MB in this area. Adjacent display tiles overlap these source files, causing
blocks to be fetched again; the initial run included 35 identical range repeats
within the batch, across nine distinct source files. This count excludes partially
overlapping ranges, and does not imply all repeats have the same cause.

Use source-aware worker assignment plus a globally budgeted compressed/decoded
source cache, or a main-thread broker that deduplicates byte-range requests and
transfers source buffers. Keep source cache ownership outside disposable job
workers where possible. Benchmark full-file reads for small detailed COGs only;
never permit a full download of the 10 GB regional source. Use explicit size
limits and verified response handling. Larger caches alone left about 2.8 s of
repeat processing, so they must be paired with CPU improvements.

### 3. Exact reprojection runs 65,536 times for every tile

`elevation.worker.ts:129–138` performs a full proj4 transformation per pixel,
allocates per-pixel arrays, builds source groups even for the regional branch,
and creates string keys. Coordinate/group construction took 2.68 seconds summed
over the first nine jobs, roughly 300 ms per tile; later runs varied with CPU load.

A separate Fribourg z15 coordinate-only experiment measured exact conversion at
329 ms. A 16×16-cell bilinear projection grid, with 289 exact transforms, took
about 6 ms including interpolation/error comparison. Maximum horizontal error
against the exact coordinates was 0.000057 m for that tile. This is a CPU
microbenchmark, not an end-to-end 55× speedup or a nationwide accuracy guarantee.

Prototype an adaptive projection grid with an explicit error bound. Near a source
pixel or kilometre boundary, perform an exact transform to preserve nearest-pixel
selection. Validate source indices, actual sampled heights and NoData at seams
across Switzerland and all zooms, especially broad national tiles. Avoid creating
detailed-source grouping structures in the regional branch. An LV95 map/grid is
another option, but requires a compatible WMTS basemap configuration.

### 4. Cancellation throws away reusable source state

`workerPool.ts:restart,prioritize` terminates workers when active jobs leave the
view. This reliably releases stalled jobs, but also discards catalogues, readers,
compressed blocks and worker initialization. Preview has its own third worker
and independent source state. Repeated navigation can keep paying startup costs.

Separate source/network caching from disposable decode jobs. Cancel obsolete
outputs promptly while preserving shared immutable cached input. Keep hard
termination/watchdogs for stalled jobs. Add brief zoom-settle scheduling for
expensive detail work if traces show repeated aborts during interaction.

### 5. Preview repeats CPU rendering on slider changes

`preview.ts:15–25,33–34` creates canvases and ImageData, and scans all preview
samples whenever the preview is invalidated. `mask()` reruns this work when each
detail tile becomes available. The main detail overlay already uses shader
variables, but the preview does not; README's claim that controls only update
shader variables is therefore incomplete.

Render preview heights with the same GPU threshold approach, or cache thresholded
rasters and redraw masks without rebuilding pixels. Skip previews when complete
detail is already available; retain overlapping preview tiles while panning.
Frame-rate benefit remains unmeasured.

## Architecture options for a larger improvement

| Option | Potential | Cost / compromise | Recommendation |
| --- | --- | --- | --- |
| Shared discovery + source cache + fast projection | Large reduction in redundant work while preserving existing sources | Moderate refactor; mobile memory and pixel-equivalence validation | First implementation path |
| Official swisstopo terrain service | Small, already tiled data; removes STAC/COG pipeline from normal display | Quantized mesh interpolation, different grid; accuracy, vertical reference, availability and browser CORS need validation | Strongest alternative to spike |
| Pre-generated elevation XYZ tiles on static hosting/CDN | Moves discovery, decode and reprojection out of clients; consistent first visits | Nationwide preparation, hosting/update pipeline, storage/bandwidth; changes browser-only source-processing constraint | Strong option if that constraint can change |
| LV95 map and source-aligned elevation tiles | Removes most elevation reprojection and improves source reuse | Basemap/grid/interaction migration; download duplication still needs fixing | Compare against projection-grid prototype |
| More workers / more parallel requests | May improve total completion | More memory, contention and duplicate downloads; first tile can worsen | Tune after reducing work |
| Delay 2 m detail until a closer zoom | Less work during ordinary exploration | Changes visible precision; explicitly approximate intermediate views | Product choice, measure separately |

### Official terrain service probe

The official service supplies multiresolution **quantized meshes**, not numeric
height-map PNGs. Its `layer.json` currently advertises EPSG:4326/TMS, zooms 0–18,
publication 20250101 and version 1.43646.0. Resolve the provided tile template;
undated tile paths tried during the probe returned 403.

Four real Fribourg-area samples using that template returned HTTP 200:

| Mesh zoom | Decoded response bytes | Vertices | Fetch + body read |
| --- | ---: | ---: | ---: |
| 8 | 18,715 | 941 | 40 ms |
| 12 | 16,595 | 829 | 85 ms |
| 14 | 50,354 | 2,524 | 66 ms |
| 15 | 55,930 | 2,806 | 66 ms |

Mesh zooms use a different geographic grid from the app's Mercator zooms.
These are individual Node network probes; sizes are after HTTP content decoding,
and exclude rendering/reprojection. They cannot establish an app speedup ratio.
To use them, rasterize/interpolate mesh triangles into numeric samples (or render
the threshold directly on the mesh). Verify height reference against LN02 source
checkpoints, terrain error near thresholds, Swiss coverage, missing-data semantics
and actual browser CORS before selecting this architecture. Do not retain the
current “2 m samples” label for mesh-derived heights.

## Suggested implementation order and acceptance targets

1. Capture reproducible browser baselines: first meaningful overlay, centre tile,
   complete visible detail, bytes/requests, main-thread long tasks and slider
   latency. Separate cold app storage, warm storage, warm source caches and pan/
   zoom cancellation. Include national view and a fixed detailed viewport.
2. Implement shared bounded discovery/source reuse and source-aware scheduling.
   Target zero elevation network requests when rebuilding the same small area
   from resident source data, without increasing memory without a bound.
3. Prototype fast projection with boundary fallback and remove avoidable per-pixel
   allocation. Preserve sample indices, height comparisons, equality and NoData.
4. Move preview thresholding to GPU; verify slider changes trigger no elevation
   network activity and no repeated CPU raster construction.
5. Compare the result with a minimal official-terrain-service spike. Decide from
   measured display latency and height error, not download size alone.

Proposed product targets, not achieved results: usable preview within 500 ms,
central detailed terrain within 1 s and a fixed desktop detail viewport within
2 s on a documented connection/device; slider work fits the frame budget. Define
separate physical-phone targets and include peak memory before accepting a cache
or concurrency increase.

The production build and benchmark syntax check pass. An initial headless-browser
check incorrectly required the literal “ready” status: national edge tiles contain
missing samples, so that condition timed out at 90 seconds even after loading
settled. With a completion check permitting explicitly unavailable edge samples,
the rebuilt app's national view settled in 4.78 seconds (52 requests total, three
catalogue requests and 27 ranges) in headless Brave at 1100×850. This includes a
200 ms synchronization pause. It is a single desktop run with empty app storage,
not cold provider caches or a physical-phone benchmark.

The same browser run then completed the following sequence. The map itself was
759×751 pixels; Fribourg required 16 detailed display tiles, Zurich 12. Request
counts include preview work and all network requests initiated in that phase.

| Browser view | Time to settled elevation status | All requests | Catalogue / range requests |
| --- | ---: | ---: | ---: |
| First Fribourg visit | **12.58 s** | 352 | 17 / **317** |
| First Zurich visit | 6.98 s | 232 | 12 / 208 |
| Return to Fribourg in session | 0.21 s | 0 | 0 / 0 |
| National view after reload | 1.54 s | 45 | 3 / 20 |
| Fribourg after reload, persisted samples | 0.38 s | 17 | 0 / 0 |

The 0.21-second revisit is near the benchmark's 200 ms synchronization floor;
do not interpret it as exact rendering latency. The national overview includes
missing edge samples, which are not persisted, explaining some repeat national
source activity. “Settled” permits explicitly unavailable samples at those edges;
both detailed city visits reached the actual “ready” status. These results identify
first-visit elevation acquisition as the primary problem: completed tile reuse
already works. They do not establish slider input-to-photon latency or sustained
physical-device frame rate.

## Primary references checked

- [geotiff.js: windows, overviews, caches and decoder pools](https://geotiffjs.github.io/geotiff.js/)
- [OpenLayers GeoTIFF reprojection example](https://openlayers.org/en/latest/examples/geotiff-reprojection.html)
- [Official swisstopo terrain service and metadata](https://docs.geo.admin.ch/visualize-data/terrain-service.html)
- [Official XYZ projection restriction and WMTS guidance](https://docs.geo.admin.ch/visualize-data/xyz.html)

OpenLayers already supports GeoTIFF reprojection, but swapping source classes
alone does not eliminate TIFF decoding, discovery/mosaic coordination or source
bandwidth. A rendering-library rewrite or WASM decoder should follow profiling,
rather than precede the proven reductions in repeated work.
