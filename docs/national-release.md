# National terrain release

The production map loads swissALTIRegio overviews at z7–12 and immutable swissALTI3D blocks at z13–19. A block contains one kilometre of the original LV95 grid at 4 m spacing. A placement page supplies projected control points and hashes for the blocks that intersect its neighbourhood. Adjacent zooms reuse the same gzip members. Each display pixel selects a native cell by nearest neighbour. The shader evaluates its 10 m band against the selected altitude.

## Build and verify locally

Use Node 24+ and a Python environment with the dependencies in `scripts/requirements.txt`. An extracted successful national-terrain Actions artifact supplies the production indexes and the `static/terrain` tree. To generate them locally:

```sh
python scripts/national/ensure_overviews.py
python scripts/national/detail_grid.py --squares-only --threads 6
python scripts/national/native_release.py
python scripts/national/verify_native_grid.py
npm ci
npm test
npm run build -- --base /AboveTheFog/
npm run preview -- --base /AboveTheFog/
```

The generator defaults to eight disjoint x ranges. To distribute a build, give each job a different `--shard 0` through `--shard 7` with the same `--shards 8` and shared data directories. Run `--shards 8 --merge` after all jobs finish. The merger verifies range coverage, file hashes, member lengths and square coverage before replacing the release index. Range manifests and prepared squares survive a retry.

## Local verification

The pinned inventory contains 43,650 source squares. The delivery pages reference 43,636 within their supported neighbourhoods. Every delivered native block matched its prepared source bytes. Across 742,000 independent placement checks, the maximum inverse projection error was 0.0000014 m. The release contains 1,855 placement pages.

At z19, magnifying the z16 pyramid changed 2,576 of 262,144 fog classifications in the Zermatt sample and 1,845 NoData classifications in the Geneva edge sample. The native placement experiment matched the reference classifications at all three locations. [Source-grid comparison](native-band-samples.json)

The same four-hop Fribourg pointer route crossed the original Fribourg pilot boundary within the larger regional fixture. At 20 Mbit/s and 40 ms simulated latency, the four cold z16 gestures transferred approximately 60 KB of native terrain, 134 KB with individual Mercator tiles, 135 KB with 2 × 2 packets and 330 KB with 8 × 8 packets. Browser resource timing covers requests initiated and completed in each observation window. Separate first-touch byte counts include otherwise invisible packet members. [Static layout measurements](packet-layout-samples.json)

## Repeat the pan measurement

```sh
MAP_URL=http://127.0.0.1:4173/AboveTheFog/ PAN_PLACE=Fribourg PAN_ZOOM=16 PAN_HOPS=4 PAN_CACHE_STATES=1 PAN_RUNS=30 npm run test:national-tiles-browser
```

Use `TERRAIN_PYTHON` for the rasterio-enabled interpreter and `BROWSER_PATH` for Chromium. Use `DATA_ROOT` for a separate release directory. `DECODE_WORKERS=0|1|2` selects the decoder, and `TERRAIN_REQUESTS=2|4|6` sets the independent request limit. The test reads the rendered fog pixel, checks its band against the source at the sampled coordinate and records when a full-resolution basemap tile covers that point. It records strip and viewport texture readiness separately. Upload timings measure CPU time inside WebGL calls. Texture bytes are estimates.

The regional experiments contain one route repetition per configuration. Read the cache state alongside each result. Local runs do not establish deployed or physical-phone p95 performance.

The preserved pilot bundle used `index-DdIM_j-n.js`. One Fribourg startup run with the historical harness recorded the first centre detail at 544 ms, viewport settlement at 644 ms and the first opaque basemap sample at 760 ms. That harness used its original desktop network configuration and centre observables. The candidate comparison uses a separate exposed-edge trace. [Regional browser measurements](national-fixture-comparisons.json)

The final production build occupies **555,785,877 bytes**. The verifier checked 44,286 regional packets, native blocks and placement pages by hash. All 14 omitted inventory squares were outside the supported footprint. A further 187,500 native cells matched three original checksum-verified 2 m TIFFs, including a NoData boundary. The release contains neither pilot data nor the live GeoTIFF worker.

The desktop production smoke route covered Zurich, St. Moritz, Lugano, Geneva and Basel and issued zero elevation-source requests. In those single cold visits, combined centre imagery and terrain took **702–1,070 ms**. The 500 ms direct-entry target remains open. The checks used a local production server under `/OutOfTheFog/`, real swisstopo imagery and simulated network conditions. [Production smoke results](national-desktop-smoke.json)

## Thirty repetitions across the Fribourg boundary

Each repetition started with empty browser storage, followed by an HTTP-warm navigation and a decoded revisit in the same tab. Each route contained twelve eastward drags at z16 across the former outer pilot boundary. This yielded 360 newly exposed samples per cache state. Every sample matched the expected native band and rendered fog colour. No elevation catalogue or TIFF request occurred.

| Desktop p95 | Cold | HTTP-warm | Decoded revisit |
| --- | ---: | ---: | ---: |
| Correct sampled fine fog | 24 ms | 25 ms | 6 ms |
| Full-resolution imagery at the sample | 89 ms | 25 ms | 6 ms |
| Imagery and correct fine fog together | 89 ms | 25 ms | 6 ms |
| Newly exposed strip at requested detail | 191 ms | 246 ms | 6 ms |
| Observed viewport settlement after pointer release | 37 ms | 43 ms | 6 ms |

Cold route terrain transfers totalled 139,414 bytes in the observation windows. Both revisit states had zero transferred bytes there. The highest end-of-hop tracked CPU-buffer sample was 23,192,556 bytes. This is sampled application memory. Physical-phone peak memory, worker and GPU allocations, process footprint, slow-storage behaviour and the five-minute repeated route remain unverified.

Cold direct-entry combined p95 was 815 ms across the 29 visits with a completed centre observation. One visit had no combined sample before the harness moved on. The direct-entry target remains unmet. [Complete distribution by cache state](national-desktop-crossing.json)

The independent pixel test sampled a resident Fribourg band and a Geneva NoData texel, changed the threshold and checked the actual premultiplied framebuffer colours. No terrain transfer occurred. [Shader checks](national-shader-checks.jsonl)

The native-release concurrency sweep held the Fribourg route and block layout fixed. It varied requests at zero workers and varied workers at four requests. Each setting has one cold route. The shipped defaults remain provisional at four requests and main-thread decoding pending phone measurements. [Concurrency observations](national-native-concurrency.json)
