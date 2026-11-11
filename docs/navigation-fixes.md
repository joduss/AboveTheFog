# Navigation and loading fixes

The original first-visit benchmark missed a major navigation problem: a short pan left the small prepared footprint and returned to source TIFF processing. The reproduced eastward pan took 37.0 seconds and issued 188 TIFF requests and nine catalogue requests. Further pans took 19.9 and 15.7 seconds. The availability mask also updated late during interaction, and preview data was cleared on view changes. Loading and resolution text could change the map's dimensions.

The implementation now:

- Expands prepared Fribourg coverage from roughly 4.2 × 4.2 km to roughly 14 × 14 km, reusing the existing 256 official source downloads. It preserves the globally aligned 4 m LV95 grid and floor-quantized 10 m bands. Native bounds are E 2571384–2585696 / N 1176532–1190800. This is bounded regional generation, not nationwide generation.
- Shares visible and speculative loads through a 64-tile decoded cache (at most 16 MiB of sample arrays). Two background slots warm a one-tile margin; completed prepared parent tiles are preloaded where available for zoom transitions. Failed tiles are not cached as successful terrain, and retry generations cannot reinsert old results.
- Updates availability geometry before rendering, including during drags and animation, and keeps mask holes for resident tiles beyond the current viewport. Available parent data can remain visible and is labelled approximate while new detail is pending. Failed detail still shows unavailable.
- Keeps up to 24 resident preview tiles, reuses their rendered images, and avoids clearing the whole preview during neighbouring pans. Overlapping preview levels replace rather than stack their fills. Fixed desktop map and toolbar/footer sizes prevent loading text from changing the tile viewport.
- Gives active runtime jobs a one-tile pan margin, reuses spatial catalogue queries, and caches decoded detailed source squares through the bounded reader pool. Each worker keeps at most twelve readers; detailed compressed caches hold sixteen 64 KiB blocks each. Typical 500² Float32 source squares add about 1 MiB per resident detailed reader. Regional overview requests retain their existing bounded windows. The coordinate transform and nearest-neighbour selection are unchanged.

The wider area generated 6.20 MB of compressed raster delivery assets and 22.37 MB of vector comparison assets. Native/source spot checks and all delivery hashes passed. Its vector polygons round-trip with zero differences over 404,684,800 delivery pixels. Generation took 610 seconds including both formats, checks and per-tile checkpoints; the local source inventory was reused.

The same recorded pointer-pan route now took **660, 808, 750 and 720 ms**, with **zero STAC/TIFF requests**. The test deliberately spends roughly 650 ms moving/pausing the pointer, so these totals do not represent pure data latency. [Recorded before/after results](navigation-results.json) retain the request counts and timing qualifications. These are individual desktop measurements, not a nationwide or physical-phone guarantee. The desktop layout is now bounded to the viewport and scrolls the sidebar; its map height differs from the old overflowing layout, so this is a before/after user route rather than an isolated algorithm speed ratio.

`tests/navigation-stability.cjs` samples the actual availability canvas over loaded tile centres during real pointer drags, with incoming edge tiles delayed by 450 ms. It checked 564 samples with zero amber flashes and a constant viewport. It also checks browser errors. This verifies resident terrain stays visible; newly exposed terrain can still legitimately be marked unavailable while loading.

Reproduce with a completed production build and preview server (do not rebuild while these checks run):

```sh
npm test
npm run build
npm run preview -- --port 5177
# Separate terminal; BROWSER_PATH overrides the installed Brave default.
npm run test:navigation-browser
npm run test:prepared-browser
.prep-env/bin/python tests/prepared_pipeline.py
```

The wider assets can be regenerated with `.prep-env/bin/python scripts/prepare_bands.py --area fribourg-wide`. The original smaller comparison areas remain separately reproducible. Existing source inventories pin their source editions. No assets were published or deployed.

Outside prepared coverage, cold runtime TIFF acquisition can still take seconds and requires the Internet. The source-cache changes reduce repeated work; they do not make all Swiss detailed terrain instantaneous. The status continues to identify prepared, mixed and runtime coverage.
