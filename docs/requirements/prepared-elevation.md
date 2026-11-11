# Feature: Prepared elevation at 4 m spacing and 10 m height bands

## Context

- React, TypeScript, Vite and OpenLayers implement a manually selected altitude overlay.
- Elevation currently loads through browser workers, runtime STAC discovery and COG byte ranges.
- Current detailed sampling uses 2 m swissALTI3D. The user explicitly requests a 4 m horizontal grid and 10 m vertical bands.
- The agreed next investigation compares pre-generated numeric raster tiles with vector elevation-band tiles before choosing a delivery format.
- See `docs/performance-investigation.md` for measured first-visit costs and caching limitations.

## Functional requirements

| ID | Requirement | Priority | Acceptance criteria |
| --- | --- | --- | --- |
| FR-01 | Prepare elevation on a consistent 4 m horizontal grid. | MUST | Grid spacing is 4 m in a suitable metric CRS; output metadata records CRS, origin, alignment and sampling method. |
| FR-02 | Encode heights in 10 m vertical bands. | MUST | 659 m maps to [650,660); at threshold 660 m it is dimmed; equality at 660 m remains clear. |
| FR-03 | Compare pre-generated raster and vector delivery. | MUST | The same representative data and thresholds are tested in Fribourg and mountainous terrain, with size, loading, rendering and fidelity results. |
| FR-04 | Preserve unavailable data. | MUST | Missing input, invalid samples and failed loads remain visibly unavailable, including with dimming disabled. |
| FR-05 | Remove expensive source processing from the prepared-data display path. | MUST | Within prepared coverage, opening the map uses prepared assets without browser STAC queries, TIFF range reads or terrain reprojection jobs. |
| FR-06 | Reuse prepared data during altitude changes. | MUST | Adjusting the threshold causes no elevation downloads or source preprocessing. |

## Non-functional requirements

| ID | Requirement | Metric |
| --- | --- | --- |
| NFR-01 | Establish comparable performance evidence. | Record cold/warm first overlay, full visible completion, request counts, bytes, interaction timings and available memory metrics on documented devices/viewports. |
| NFR-02 | Bound processing and client memory. | Document source-download bounds, concurrency, peak allocations and cache limits; preparation can resume without regenerating unchanged output. |
| NFR-03 | Preserve rendering correctness. | Automated checks cover band boundaries, equality, NoData, spatial alignment and adjacent tile seams. |
| NFR-04 | Retain static hosting capability. | Prepared assets can be served as static files without a required application backend. |

## Scope and implementation assumptions

The resolution choices are confirmed. These scope defaults make the coding task executable without silently committing to nationwide data production:

- Start with bounded Fribourg and mountainous comparison areas; make the generator configurable for wider production.
- Choose and integrate a format based on evidence. Vector delivery is a candidate, not a decided requirement.
- A 4 m grid describes horizontal sampling, not guaranteed terrain accuracy or 4 m Mercator units everywhere.
- Preserve LN02 heights within Switzerland and keep missing data separate from valid height bands.
- Altitude controls will select multiples of 10 m, consistent with the requested bands.
- Keep existing rendering outside prepared coverage while clearly documenting which path is active.

## Out of scope

Weather prediction, accounts, payments, publishing/deployment, a required backend, and an automatic full-Switzerland production run.

## Open questions resolved by the implementation experiment

- Which format has the best measured loading, rendering, storage and fidelity balance?
- Which preparation sampler and overview method best preserve the intended approximate display semantics?
- What are the measured storage and production-time estimates for nationwide expansion?

The coding prompt requests explicit reporting of these decisions and their consequences.
