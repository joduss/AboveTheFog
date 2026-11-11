"""Prepare the country's native 4 m band grid once. Only bands are retained."""
import argparse
import concurrent.futures
import fcntl
import gzip
import hashlib
import json
import zlib
from pathlib import Path

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from detail_sources import INVENTORY, ROOT, fetch

CACHE = ROOT / 'data/source/national-bands'
MISSING = -32768


def bands(heights, nodata):
    valid = np.isfinite(heights) & (heights != nodata) & (heights > -500) & (heights < 10000)
    result = np.full(heights.shape, MISSING, dtype='<i2')
    result[valid] = np.floor(heights[valid] / 10).astype('<i2')
    return result


def prepare_square(row):
    x, y, _, url, digest = row
    path = CACHE / digest[:2] / (digest + '.gz')
    if path.exists():
        try:
            if len(gzip.decompress(path.read_bytes())) == 125000:
                return path
        except (gzip.BadGzipFile, EOFError, zlib.error):
            pass  # Recreate incomplete cached output from its checksum-pinned TIFF.
    name = url.rsplit('/', 1)[1]
    existing = [ROOT / 'data/source' / name, ROOT / 'data/source/fribourg' / name]
    local = next((item for item in existing if item.is_file()), None)
    body = local.read_bytes() if local else fetch(url, 8_000_000)
    if hashlib.sha256(body).hexdigest() != digest:
        raise ValueError(f'Source checksum mismatch: {name}')
    with MemoryFile(body) as memory, memory.open() as ds:
        if ds.crs.to_epsg() != 2056 or ds.shape != (500, 500) or ds.transform != from_origin(x*1000, (y+1)*1000, 2, 2):
            raise ValueError(f'Unexpected source grid: {name}')
        # Cell centres at multiples of 4 m plus 2 m. Source pixels use floor
        # indexing, including the exact 2 m pixel boundary at each cell centre.
        array = bands(ds.read(1)[1::2, 1::2], ds.nodata)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    tmp.write_bytes(gzip.compress(array.tobytes(), compresslevel=2, mtime=0))
    tmp.replace(path)
    return path


def build(threads):
    rows = json.loads(gzip.decompress(INVENTORY.read_bytes()))
    xmin = min(r[0] for r in rows)
    ymax = max(r[1] for r in rows) + 1
    width = (max(r[0] for r in rows) + 1 - xmin)*250
    height = (ymax - min(r[1] for r in rows))*250
    CACHE.mkdir(exist_ok=True, parents=True)
    raw = CACHE / 'national.partial.u16'
    # Zero in the sparse file represents absent source coverage. Band -50 is
    # stored as one. Fixed offsets keep missing kilometre squares unambiguous.
    data = np.memmap(raw, dtype='<u2', mode='w+', shape=(height, width))
    finished = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=threads) as pool:
        for start in range(0, len(rows), 512):
            batch = rows[start:start+512]
            for row, path in zip(batch, pool.map(prepare_square, batch)):
                src = np.frombuffer(gzip.decompress(path.read_bytes()), dtype='<i2').reshape(250,250)
                col = (row[0]-xmin)*250
                top = (ymax-row[1]-1)*250
                data[top:top+250, col:col+250] = np.where(src == MISSING, 0, src + 51)
            finished += len(batch)
            print(f'{finished}/{len(rows)} verified national squares', flush=True)
    data.flush()
    del data
    raw.replace(CACHE / 'national.u16')
    vrt = f'''<VRTDataset rasterXSize="{width}" rasterYSize="{height}">
<SRS>EPSG:2056</SRS><GeoTransform>{xmin*1000},4,0,{ymax*1000},0,-4</GeoTransform>
<VRTRasterBand dataType="UInt16" band="1" subClass="VRTRawRasterBand"><NoDataValue>0</NoDataValue>
<SourceFilename relativeToVRT="1">national.u16</SourceFilename><ImageOffset>0</ImageOffset><PixelOffset>2</PixelOffset>
<LineOffset>{width*2}</LineOffset><ByteOrder>LSB</ByteOrder></VRTRasterBand></VRTDataset>'''
    (CACHE/'national.vrt').write_text(vrt)
    (CACHE/'grid-source.sha256').write_text(hashlib.sha256(INVENTORY.read_bytes()).hexdigest())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--threads',type=int,default=12)
    parser.add_argument('--squares-only',action='store_true',help='Prepare native blocks without assembling a Mercator writer input grid')
    args = parser.parse_args()
    if args.threads < 1:
        parser.error('Thread count must be positive')
    CACHE.mkdir(exist_ok=True,parents=True)
    with (CACHE/'grid.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if args.squares_only:
            rows = json.loads(gzip.decompress(INVENTORY.read_bytes()))
            with concurrent.futures.ThreadPoolExecutor(max_workers=args.threads) as pool:
                for start in range(0,len(rows),512):
                    list(pool.map(prepare_square,rows[start:start+512]))
                    print(f'Prepared {min(start+512,len(rows))}/{len(rows)} squares',flush=True)
            raise SystemExit
        marker = CACHE/'grid-source.sha256'
        digest = hashlib.sha256(INVENTORY.read_bytes()).hexdigest()
        if not (marker.exists() and marker.read_text()==digest and
                (CACHE/'national.u16').exists() and (CACHE/'national.vrt').exists()):
            marker.unlink(missing_ok=True)
            build(args.threads)
