# Task: Pre-generate elevation at 4 m spacing with 10 m height bands

Improve first-visit performance of the AboveTheFog by moving elevation preparation out of the browser. Implement and benchmark pre-generated numeric raster tiles and vector elevation-band tiles, then integrate the better measured option for representative coverage.

## Project context

The app uses React, TypeScript, Vite and OpenLayers. It visualizes a manually selected altitude, not a fog forecast. Current detailed elevation comes from 2 m swissALTI3D COGs discovered and processed by browser workers.

Read `README.md`, `FINDINGS.md`, `docs/performance-investigation.md`, applicable `AGENTS.md` instructions and `docs/requirements/prepared-elevation.md`. Inspect `src/terrainMap.ts`, `src/terrain/`, and the existing preparation scripts before implementing. Preserve existing unrelated workspace changes.

Measured first Fribourg loading took approximately 12.6 seconds with 317 TIFF range requests; revisits are already much faster. Improve the first visit rather than relying only on browser caches.

## Confirmed resolution requirements

- **Horizontal:** a regular **4 m terrain grid**, defined in an appropriate metric CRS such as EPSG:2056. Do not equate 4 Web Mercator units with 4 ground metres across Switzerland.
- **Vertical:** **10 m elevation bands**. Encode `floor(height / 10)` or an equivalent representation. Do not round to the nearest band.
- Use half-open intervals: 659 m belongs to [650,660); it dims at threshold 660 m. A sample exactly at 660 m stays clear at threshold 660 m.
- Keep NoData separate from valid bands, including any valid negative heights. Document encoding, units, CRS, datum, sampling and bounds.
- Preserve LN02 heights within Switzerland. Avoid implying the new resolution provides survey accuracy.

## Work

1. **Build a repeatable preparation pipeline.** Use official swissALTI3D data and bounded, configurable areas. Reuse valid local source data where practical. Define one aligned 4 m grid before splitting into output tiles. Choose and document resampling; retain the current nearest-neighbour interpretation unless evidence justifies a different choice. Record source editions, preparation parameters and format versions. Support incremental/resumable generation.

2. **Produce two comparable candidates** from the same source extent and sampling contract:
   - Numeric raster tiles holding 10 m height-band values, suitable for GPU threshold comparison. Use a compact integer encoding with a distinct missing-data value and document compression and GPU conversion costs.
   - Vector tiles holding non-overlapping polygons for 10 m elevation bands, with band attributes. Preserve islands, holes and unavailable areas. Do not create a separate nationwide layer for every possible threshold. Use zoom-dependent geometry simplification, clipping and buffers that prevent seams.

   State explicitly if contour interpolation changes boundaries relative to the discrete 4 m raster. Quantify that difference instead of claiming exact equivalence. At thresholds that are multiples of 10 m, classification of the quantized raster must match classification of its unquantized 4 m samples.

3. **Generate multiscale output.** Native detail uses the 4 m grid. Use coarser representations at broad zooms; do not ship full-resolution geometry or samples at national scale. Document overview semantics and simplification error. Preserve the app's explicitly approximate coarse-view behavior and distinguish missing data from clear terrain.

4. **Benchmark Fribourg and a mountainous area.** Choose and document bounded areas with comparable viewport sizes. Measure the current pipeline and both candidates with the same view, threshold, browser and connection conditions. Separate cold application storage, warm HTTP caches and warm application caches. Record:
   - Time to first meaningful overlay and full visible completion.
   - Elevation request counts and transferred bytes.
   - Output size, generation time and representative peak memory where measurable.
   - Pan/zoom and threshold interaction behavior, including main-thread long tasks.
   - Boundary fidelity, small terrain features, NoData and tile seams.

   Aim for a useful overlay within 500 ms and full detailed completion within 2 seconds on the documented desktop setup. These are proposed performance goals, not permission to hide missing coverage or reduce resolution silently. Report achieved results and limitations honestly. Phone-sized emulation is not a physical-device benchmark.

5. **Select and integrate the winner.** Decide from loading, rendering, fidelity, storage and maintenance evidence; do not assume vectors are smaller. Keep the existing OpenLayers map and controls where practical. In prepared coverage, normal rendering must use prepared assets without runtime STAC discovery, TIFF decoding or terrain reprojection jobs. Threshold changes must reuse loaded data without elevation requests. Use 10 m steps in slider and numeric controls and explain the resolution in the UI. Update sample inspection to show a band/range when exact heights are no longer available.

6. **Keep coverage explicit.** Integrate the selected prepared format for the bounded evaluation areas. Preserve the existing path outside those areas and clearly document source/coverage transitions. Missing or failed prepared tiles must appear unavailable rather than silently clear; do not mask errors with an undisclosed fallback. Make wider generation configurable, but do not automatically download/process all Switzerland or publish anything.

## Acceptance checklist

- [ ] Output metadata and fixtures verify an aligned 4 m metric grid.
- [ ] Heights immediately below, at and above 10 m boundaries classify correctly; equality stays clear.
- [ ] Negative valid heights, source NoData, invalid values and failed requests remain distinct.
- [ ] Prepared tiles align with the basemap and adjacent tiles have no visible cracks or overlapping dimming.
- [ ] Vector/raster boundary differences and broad-zoom approximations are measured and documented.
- [ ] The integrated prepared path makes no browser STAC queries or TIFF range requests.
- [ ] Slider and numeric input use 10 m thresholds without elevation downloads during adjustment.
- [ ] Missing-data indication remains visible with dimming disabled.
- [ ] Loading, retry, pan/zoom, reload/cache reuse and phone-sized layout work.
- [ ] Relevant automated correctness checks and production build pass; inspect browser rendering on both evaluation areas.
- [ ] Both formats have a comparable benchmark report, with a reasoned final selection and nationwide size/production estimates marked as estimates.

## Deliverables and constraints

Deliver the preparation scripts/configuration, representative generated assets or reproducible local generation instructions, integrated client changes, meaningful correctness tests, benchmark results and updated run/documentation instructions. Retain swisstopo attribution.

Static hosting must remain possible without a required application server. Explain any added dependency and pin it consistently with the project. Keep large source/generated data out of Git unless existing project policy calls for it. Do not add weather features, authentication or payment features, rewrite the UI framework, deploy, or run full-country generation as part of this task.
