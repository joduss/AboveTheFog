# Swiss Fog Map — local technical prototype

A manual altitude scenario around Uetliberg, Zürich. React + TypeScript + Vite + OpenLayers. No weather ingestion, backend, database, or deployment. **This is not a fog forecast.** Check [MeteoSwiss](https://www.meteoswiss.admin.ch/) yourself; actual fog varies by region.

## Run

Use Node 22.12+ (verified with Node 26.8.2):

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Prepared real elevation data is included, so Python is unnecessary to run the app. Internet access is needed for the swisstopo background. The slider and numeric input control metres above sea level (LN02). The dashed boundary marks the prepared sample. Amber always means unavailable, never above threshold. Tap the map to inspect elevations. The toggle disables dimming while retaining unavailable-data markings.

```sh
npm test
npm run build
npm run preview
```

`dist/` is a static site; all application JS is bundled locally. No publication has been performed. For subdirectory hosting, configure Vite's `base` at build time. Background tiles remain third-party requests with attribution.

## Reproduce the data

Only four 1 km² **2 m swissALTI3D** COGs are downloaded (about 5.3 MB total), covering LV95 E 2679000–2681000 / N 1244000–1246000. These are real 2026 release assets, not the restricted illustrative sample download from the product page.

```sh
python3.12 -m venv .prep-env
.prep-env/bin/pip install -r scripts/requirements.txt
.prep-env/bin/python scripts/prepare.py
```

Rasterio's wheel supplies GDAL; no separate GDAL CLI is needed. The script caches originals in ignored `data/source/`, verifies CRS and resolution, mosaics the 2 m source, reprojects horizontally to EPSG:3857 with nearest-neighbour sampling, and writes:

- `public/data/elevation.bin`: 1024² little-endian uint16 decimetres, north-to-south rows. 65535 means missing. Approx. 2 m ground spacing; 2.925 Mercator units per pixel.
- `public/data/manifest.json`: extent, units, vertical reference, URLs, hashes, checks and provenance.

No vertical datum conversion is applied: source heights remain **LN02 / EPSG:5728, metres**, not ellipsoidal heights or LHN95. NoData −9999 becomes 65535. Nearest-neighbour resampling avoids filling holes and mixing elevations across source boundaries. Quantization is at most 0.05 m; spatial resampling can change steep-slope samples more. Retain © swisstopo when redistributing prepared data.

## Reproduce verification

With the dev server running:

```sh
npx playwright install chromium
node tests/browser.cjs
node scripts/compare.mjs
```

Browser screenshots go to ignored `test-results/`. Chromium headless needs OS permissions to launch. Tests cover loading, inputs, overlay toggle, pan/zoom, phone viewport, no extra elevation fetches, and deliberate fetch failure. Measurements are input-to-next-animation-frame latency, not a hardware GPU benchmark. See [FINDINGS.md](FINDINGS.md) for actual results and remaining work.

## Structure

`src/main.tsx` owns React state and one imperative OpenLayers map with cleanup. The numeric DataTile is uploaded once; shader variables change the threshold. `scripts/` contains the offline pipeline and comparison experiment. `tests/` contains real-data and browser checks. Direct dependency versions and `package-lock.json` are pinned; update deliberately.

## References

- [swissALTI3D format, resolution and LV95/LN02](https://www.swisstopo.admin.ch/en/height-model-swissalti3d)
- [swisstopo XYZ background service](https://docs.geo.admin.ch/visualize-data/xyz.html)
- [OpenLayers dynamic tile styles](https://openlayers.org/en/latest/examples/cog-style.html)
- [swisstopo open-data attribution and terms](https://www.swisstopo.admin.ch/en/faq-free-geodata)
