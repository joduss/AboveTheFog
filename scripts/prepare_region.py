"""Prepare Fribourg from real 2 m swissALTI3D; bounded downloads, tiled output.
First run discovers latest assets and writes a pinned inventory. Subsequent runs reuse
that inventory and verify cached/downloaded source SHA256 hashes from STAC.
"""
import concurrent.futures, gzip, hashlib, json, math, re, time, urllib.request
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import transform_bounds, reproject, Resampling

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/data/fribourg'
RAW = ROOT / 'data/source/fribourg'
INVENTORY = ROOT / 'scripts/fribourg-sources.json'
BOUNDS = [2570000, 1176000, 2586000, 1192000]
SIZE = 8192
TILE = 256
NODATA = 65535
OUT.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)

def fetch(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 3: raise
            time.sleep(2 ** attempt)

def inventory():
    if INVENTORY.exists(): return json.loads(INVENTORY.read_text())
    bbox = transform_bounds('EPSG:2056', 'EPSG:4326', *BOUNDS, densify_pts=21)
    url = 'https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items?bbox=' + ','.join(map(str, bbox)) + '&limit=100'
    chosen = {}
    while url:
        page = json.loads(fetch(url))
        for item in page['features']:
            match = re.fullmatch(r'swissalti3d_(\d{4})_(\d+)-(\d+)', item['id'])
            if not match: continue
            year, x, y = map(int, match.groups())
            if not (2570 <= x < 2586 and 1176 <= y < 1192): continue
            for name, asset in item['assets'].items():
                if name.endswith('_2_2056_5728.tif'):
                    checksum = asset['checksum:multihash'].lower()
                    assert checksum.startswith('1220'), 'Expected SHA256 multihash'
                    key = (x, y)
                    if key not in chosen or year > chosen[key]['year']:
                        chosen[key] = dict(id=item['id'], year=year, x=x, y=y, url=asset['href'], sha256=checksum[4:])
        url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)
        print(f'Discovered {len(chosen)}/256 source tiles', flush=True)
    assert len(chosen) == 256, 'Incomplete inventory; do not imply full coverage'
    records = [chosen[key] for key in sorted(chosen)]
    INVENTORY.write_text(json.dumps(records, indent=2) + '\n')
    return records

def download(record):
    path = RAW / (record['id'] + '.tif')
    if not path.exists():
        payload = fetch(record['url'])
        assert hashlib.sha256(payload).hexdigest() == record['sha256'], record['id']
        path.write_bytes(payload)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256'], f'Corrupt cached source: {path}'
    return path

records = inventory()
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    paths = []
    for i, path in enumerate(pool.map(download, records)):
        paths.append(path)
        if i % 16 == 0: print(f'Downloaded / verified {i+1}/256', flush=True)

bounds = transform_bounds('EPSG:2056', 'EPSG:3857', *BOUNDS, densify_pts=21)
side = max(bounds[2]-bounds[0], bounds[3]-bounds[1])
extent = [bounds[0], bounds[1], bounds[0]+side, bounds[1]+side]
transform = from_bounds(*extent, SIZE, SIZE)
# Reproject one source at a time into a bounded mosaic; never load all COGs at once.
terrain = np.full((SIZE, SIZE), -9999, dtype='float32')
for i, path in enumerate(paths):
    with rasterio.open(path) as source:
        assert source.crs.to_epsg() == 2056 and source.res == (2, 2)
        assert source.nodata == -9999
        reproject(rasterio.band(source, 1), terrain, src_transform=source.transform,
                  src_crs=source.crs, src_nodata=-9999, dst_transform=transform,
                  dst_crs='EPSG:3857', dst_nodata=-9999, init_dest_nodata=False,
                  resampling=Resampling.nearest)
    if i % 32 == 0: print(f'Reprojected {i+1}/256', flush=True)
valid = np.isfinite(terrain) & (terrain != -9999)
assert np.all((terrain[valid] >= 0) & (terrain[valid] < 6553.5))
low = np.full(terrain.shape, NODATA, dtype='uint16')
low[valid] = np.rint(terrain[valid] * 10).astype('uint16')
high = low.copy()
minimum, maximum = float(terrain[valid].min()), float(terrain[valid].max())
del terrain
resolutions = [(side / TILE) / 2 ** z for z in range(6)]
files = {}; totals = 0
for z in range(5, -1, -1):
    count = 2 ** z
    for y in range(count):
        for x in range(count):
            a = low[y*TILE:(y+1)*TILE, x*TILE:(x+1)*TILE]
            b = high[y*TILE:(y+1)*TILE, x*TILE:(x+1)*TILE]
            interleaved = np.stack([a, b], axis=-1).astype('<u2').tobytes()
            payload = gzip.compress(interleaved, compresslevel=6, mtime=0)
            relative = f'{z}/{x}/{y}.bin.gz'
            path = OUT / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            totals += len(payload)
            files[relative] = hashlib.sha256(payload).hexdigest()
    print(f'Prepared level {z}: {count*count} tiles', flush=True)
    if z:
        n = low.shape[0]//2
        # Conservative overview: missing child makes parent unknown; otherwise retain
        # full sampled range so a mixed cell can never claim to be entirely above.
        lo = low.reshape(n,2,n,2)
        hi = high.reshape(n,2,n,2)
        missing = (lo == NODATA).any(axis=(1,3))
        low = lo.min(axis=(1,3)); high = hi.max(axis=(1,3))
        low[missing] = NODATA; high[missing] = NODATA
manifest = dict(version=2, name='Fribourg region', areaKm2=256, extent=extent,
                sourceBoundsLV95=BOUNDS, tileSize=TILE, maxZoom=5, resolutions=resolutions,
                nodata=NODATA, scale=0.1, bands=['minimum','maximum'],
                sourceResolutionMetres=2, verticalReference='LN02 (EPSG:5728)',
                minMetres=minimum, maxMetres=maximum, validPixels=int(valid.sum()),
                tileCount=len(files), preparedBytes=totals,
                sourceBytes=sum(p.stat().st_size for p in paths),
                sourceYears=sorted(set(r['year'] for r in records)),
                sourceInventory='scripts/fribourg-sources.json')
(OUT/'checksums.json').write_text(json.dumps(files, indent=2)+'\n')
# Publish the manifest last; incomplete preparation must not be advertised as ready.
(OUT/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps(manifest, indent=2))
