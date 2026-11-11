# Prepared elevation experiment — 4 November 2026

Navigation follow-up: prepared Fribourg coverage has since been widened to roughly 14 × 14 km; [navigation fixes](navigation-fixes.md) describe the current cache/rendering changes. The original format-comparison measurements below retain their original bounds and setup.

Numeric raster is the selected default for the bounded Fribourg and Zermatt evaluation areas. Both candidates are generated and usable for comparison; `?prepared=vector` selects actual OpenLayers vector-tile rendering and `?prepared=off` selects the existing COG worker pipeline. Nothing has been deployed or generated nationwide.

## Reproduce

The application still runs with `npm ci && npm run dev`. A checkout without generated assets shows prepared coverage as **unavailable**, with no undisclosed source fallback. Generate the bounded assets before evaluating that coverage:

```sh
python3.12 -m venv .prep-env
.prep-env/bin/pip install -r scripts/requirements-lock.txt
.prep-env/bin/python scripts/prepare_bands.py
.prep-env/bin/python tests/prepared_pipeline.py
npm test
npm run build
npm run preview -- --port 5177
# In another terminal; BROWSER_PATH may select a different installed Chromium.
node tests/prepared-browser.cjs
MAP_URL=http://127.0.0.1:5177 node scripts/benchmark_prepared.cjs
```

The default browser executable in the two new scripts is macOS Brave. `BROWSER_PATH` overrides it. No new JS or Python dependency was added: the existing pinned Rasterio/NumPy preparation environment and Playwright are reused. `requirements-lock.txt` pins transitive preparation dependencies; Python 3.12 was used. Node 26.8.2 ran this experiment.

`--area fribourg` or `--area zermatt` limits generation. `--config path.json` supports further **explicitly bounded** areas (odd `sideTiles` 1–17, at z15), with the confirmed 4 m / 10 m resolution contract enforced. Each area's aligned native allocation is capped at 25 million samples. Downloads are sequential, individual responses are capped at 32 MB, and catalogue traversal at 16 pages. Requests retry up to four times with backoff. Sources are SHA256-verified before reuse; valid historical Fribourg downloads are reused. The source inventories under `scripts/prepared/` pin editions, URLs and official checksums. Inspect and intentionally replace an inventory when updating editions.

Generation writes assets atomically, checksums each pair of output tiles, and checkpoints them in `progress.json`. Restarting verifies and skips completed pairs; a completed manifest is reused only after all checksums pass. A changed input fingerprint invalidates the checkpoint. The manifest is written last. The generated `src/terrain/prepared-index.json` is the small committed client coverage/version contract; rebuild the application after regenerating data. Fingerprints also version application-cache keys and HTTP tile URLs. Large generated/source files remain ignored by Git.

Only delivery raster/vector files are copied into `dist/prepared`; native fixtures, inventories, manifests and checkpoints stay out of the static build. The Vite development middleware serves the same files at `/prepared`. Copy `dist` to ordinary static hosting when deployment is separately authorized. Both raw gzip files and automatic HTTP `Content-Encoding: gzip` decoding are supported.

## Sampling and formats

Official [swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d) 2 m EPSG:2056 / LN02 sources supply the height values. Heights remain in LN02 (EPSG:5728), with no vertical conversion. Fribourg uses 2021 sources (25 files, 26.73 MB); Zermatt uses 2024 sources (30 files, 35.11 MB).

Before splitting into any tile, preparation constructs a north-up **4 m LV95 lattice anchored at (0,0)**. Bounds are rounded outwards to multiples of four; samples are at cell centres. GDAL nearest-neighbour samples the 2 m sources on that lattice. Ties follow GDAL's deterministic nearest-pixel rule. There is no averaging, contour interpolation, vertical offset or claim of survey accuracy. Fribourg's native bounds are E 2576440–2580652 / N 1181568–1185768 (1053 × 1050 cells). Zermatt's are E 2622040–2626316 / N 1094820–1099080 (1069 × 1065 cells).

Each valid sample is `floor(height / 10)`. Signed little-endian int16 **−32768** means unavailable; valid negative bands such as −1 mean [−10,0) m. Non-finite values, −9999 source NoData and samples outside the declared supported physical height range (−500,10000) m become unavailable. The task's 659 m example encodes 65, which dims at 660 m. Exactly 660 m encodes 66 and stays clear at 660 m. The generator verifies that every native height lies in its encoded half-open interval, which guarantees matching classification at every multiple of ten. Tests include negative heights, equality, invalid inputs, islands and holes.

Delivery uses ordinary EPSG:3857 / 256² XYZ tiles, z13–17. These are **nearest-neighbour views of the 4 m metric lattice**, prepared offline, not a claim that four Mercator units equal four ground metres. At z17, delivery pixels are about 0.82–0.83 m on the ground and oversample the native lattice to keep display aliasing small. The native grid remains 4 m; extra display pixels add no terrain detail. At z15 delivery pixels are about 3.3 m; at z13 about 13.1–13.3 m. The display boundary can move by up to half a delivery pixel diagonal (about 0.59 m at z17) relative to the projected native cell boundary, in addition to source sampling error. Full native fixtures are retained locally for verification.

Raster tiles are one signed int16 band compressed with gzip level 6. Each decompresses to 128 KiB, then converts in one pass to a 256 KiB Float32 height array (`band * 10`), with the existing −99999 GPU sentinel for missing data. The GPU shader keeps strict `< threshold` comparison. A 128-tile texture cache can hold roughly 32 MiB of CPU sample arrays before GPU copies; the existing seven-day completed-tile cache is bounded to 192 entries (about 48 MiB). Missing or failed results are not persisted.

Vector tiles are gzip-compressed GeoJSON in EPSG:3857, one non-overlapping polygon per connected **band**, including explicit unavailable polygons. They are not a nationwide layer per threshold. Four-connected polygonization preserves islands and holes. Polygonization follows delivery cell edges exactly: no contour interpolation. Lower zooms polygonize the coarser nearest-neighbour representation, which reduces geometry without topological smoothing or independent edge simplification. Clipping is exactly at shared XYZ edges with zero geometry buffer; fill-only rendering has no strokes or overhanging buffered geometry. Rasterizing all generated vector polygons back onto their delivery grids produced **zero mismatches over 70,516,736 pixels**, including unavailable cells. Browser screenshots at z15 and z17 were inspected for alignment and seams. Vector antialiasing may still differ from the raster along subpixel edges; the zero-mismatch result describes cell classification, not identical framebuffer pixels.

## Coverage and broad views

Each evaluation footprint is a 5 × 5 group of z15 tiles centred near the named place, roughly 4.2 × 4.2 km on the ground. Exact Mercator footprints and native LV95 bounds are recorded in the generated index and [generation record](prepared-elevation-generation.json).

The client uses prepared data for **whole visible delivery tiles contained within a footprint**, from z13 to z17, and enlarges z17 above that zoom. This makes coverage zoom-dependent at the boundary: a coarse tile crossing the footprint boundary retains the runtime path. The status explicitly labels prepared, runtime, or mixed coverage. Below z13 the existing approximate swissALTIRegio path remains; national views never load full-resolution prepared data. This bounded experiment does not claim every pixel of the rectangular native mosaic is prepared coverage at every zoom. Failed prepared requests remain amber rather than switching sources. Source-based previews are suppressed in fully prepared views and never replace failed prepared tiles.

Overviews use nearest samples, not conservative minima or averaged heights. A clear overview does not guarantee every child is clear. The following measures the fraction of valid 2× finer delivery samples whose classification differs from the enclosing overview, using the same underlying 4 m samples:

| Overview | Fribourg at 650 m | Zermatt at 2500 m |
|---|---:|---:|
| z13 vs z14 | 0.433% | 0.077% |
| z14 vs z15 | 0.241% | 0.043% |
| z15 vs z16 | 0.130% | 0.026% |
| z16 vs z17 | 0.068% | 0.012% |

These are measured sample disagreements, not bounds on physical terrain error or a guarantee for other thresholds. Small features may disappear at broad zooms. Native/source spot checks passed at ten Fribourg and eight Zermatt grid points; synthetic tests exercise NoData holes and negative heights absent from these Swiss views.

## Browser measurements and selection

[Raw browser measurements](prepared-elevation-benchmark.json) and [generation metrics](prepared-elevation-generation.json) are retained for review. The production build ran headless Brave/Chromium 155.0.8059.85 on macOS, Intel i7-9750H (12 logical CPUs), 32 GiB RAM. Viewport 1100 × 850, **map fixed at 759 × 751**, z15, same place and threshold (650 m) for all three formats. Mountain interactions also select 2000/2500/3000 m; the correctness comparison above uses 2500 m.

The app/static assets were served on localhost; source COGs use the live Internet. CDP configured the page for 20 ms latency and 50 Mbit/s, but this does not establish cold provider caches or guaranteed worker-transfer bandwidth. Each cold row uses a fresh browser context with empty application/HTTP caches. Warm HTTP reuses the context after deleting CacheStorage; warm application storage retains it. These are single runs per cell, not statistically robust device targets or a physical-phone benchmark.

“First” and “complete” mean the first meaningful available tile/preview and all visible tiles reported ready, followed by two animation frames. They are navigation-relative and include application startup; they are not optical input-to-photon measurements. Requests include worker traffic. Bytes are transferred response bodies, excluding headers; HTTP cache hits report zero transfer.

| Area / cold format | First | Complete | Elevation requests | Transferred |
|---|---:|---:|---:|---:|
| Fribourg current COG | 2,855 ms | 12,504 ms | 336 (17 STAC, 319 TIFF) | 25.61 MB |
| Fribourg raster | **418 ms** | **722 ms** | 16 | **55.0 kB** |
| Fribourg vector | 440 ms | 835 ms | 16 | 431.9 kB |
| Zermatt current COG | 3,061 ms | 14,744 ms | 389 (17 STAC, 372 TIFF) | 38.60 MB |
| Zermatt raster | **415 ms** | **775 ms** | 16 | **130.9 kB** |
| Zermatt vector | 422 ms | 915 ms | 16 | 1,323.7 kB |

| Format | Fribourg complete: warm HTTP / warm app | Zermatt complete: warm HTTP / warm app |
|---|---:|---:|
| Current COG | 3,973 / 293 ms | 5,821 / 288 ms |
| Raster | 361 / 281 ms | 365 / 281 ms |
| Vector | 421 / 444 ms | 488 / 484 ms |

Raster warm-app reloads made zero elevation requests; vector reloads reparsed 16 HTTP-cached tile responses, with zero transferred body bytes. Every prepared threshold phase made zero elevation requests. One warm-HTTP COG phase still issued two trailing source requests during interaction; this is background activity, not evidence that thresholds need elevation downloads.

Cold loading produced three/two/two main-thread long tasks (>50 ms) for Fribourg COG/raster/vector, and one/two/zero for Zermatt. These include startup and are too few to establish a sustained responsiveness claim. Across the four threshold changes per phase, raster input-to-two-frame times were about 10–33 ms; mountainous vectors reached 106 ms (about 55–63 ms when warm). The live vector geometry redraw is more expensive than raster shader variables. Single-level zoom completion was about 0.47–0.48 s for raster and 0.48–0.70 s for vectors, versus 6.6–7.2 s for current COGs; that check includes a 400 ms synchronization floor. Pan, zoom through z17, retry, reload, band inspection, and 390 × 844 layout are separately covered by browser regression checks. No calibrated pan frame-rate, physical phone battery/thermal data or peak browser/GPU memory is claimed. JS heap snapshots are in the raw record, not process peaks.

| Generation output | Fribourg | Zermatt |
|---|---:|---:|
| Raster, all five levels | 0.634 MB | 1.170 MB |
| Vector, all five levels | 2.641 MB | 7.970 MB |
| Both formats + validation wall time | 23.7 s | 41.1 s |
| Raster stage | 7.25 s | 5.59 s |
| Vector stage incl. round-trip validation | 7.00 s | 12.42 s |
| Preparation peak process RSS | 196 MB | 244 MB |

Generation times include inventory/source work and correctness checks; Fribourg reused local sources and Zermatt downloaded them. Stage timings share the native mosaic and do not represent separate complete pipelines. macOS `ru_maxrss` reports bytes and is process-high-water, so Zermatt's measurement includes the earlier Fribourg run. A checksum-only complete rerun verified/reused both outputs successfully.

**Selection: raster.** It met the proposed 500 ms useful-overlay / 2 s completion targets on this desktop run, keeps exact sampled-band classification, uses the existing GPU shader, has smaller storage and viewport transfer costs, and avoids vector geometry parse/redraw overhead. Vectors remain reproducible and selectable for comparison. No extra rendering library, required server or new package is necessary.

For planning only, scaling the two roughly 17–18 km² mosaics linearly to an **assumed rounded 41,000 km²** gives about **2.1 GB raster** or **12.3 GB vector** for all five delivery levels, roughly **21 hours sequential combined-format preparation** at the observed mixed-cache rate, and roughly **70 GB source input** at the measured source density. These are estimates, not nationwide measurements: terrain complexity, rectangular edges, source reuse, duplicate overview tiles, storage blocks, verification and hardware materially change them. A production generator should deduplicate shared XYZ tiles across area jobs (the original comparison areas do not overlap; the later Fribourg-wide extension overlaps and reuses the same grid), add national coarse levels as needed and budget source updates before wider rollout. No nationwide job was run.
