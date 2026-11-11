"""Bake full-extent Web Mercator tiles. Publish each level manifest last."""
import argparse
import concurrent.futures
import fcntl
import gzip
import hashlib
import json
import math
import tempfile
import threading
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window
from detail_grid import CACHE, MISSING, bands
from detail_sources import INVENTORY, ROOT

WORLD = 20037508.342789244
BOUNDS = (5.95, 45.8, 10.5, 47.85)
OUTPUT = ROOT / 'static/terrain'
INDEX = ROOT / 'src/terrain/national-index'
REGIO = ROOT / 'data/source/swissaltiregio.tif'
REGIO_HASH = 'e1cade929d3007d74be67e5d107e517e40b13e0597a114097744b032fc6527e5'


def tile_range(z):
    west, south, east, north = BOUNDS
    n = 2**z
    col = lambda lon: math.floor((lon+180)/360*n)
    row = lambda lat: math.floor((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
    return [col(west), row(north), col(east), row(south)]


def atomic_write(path, body):
    path.parent.mkdir(exist_ok=True, parents=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(body)
    Path(tmp.name).replace(path)


def write_manifest(path, data):
    atomic_write(path, (json.dumps(data, separators=(',', ':'))+'\n').encode())


def verified_shard(path, identity, keys):
    data = json.loads(path.read_bytes())
    if data['identity'] != identity or set(data['results']) != set(keys):
        raise ValueError(f'Wrong or incomplete range: {path}')
    z = identity['z']
    for key, result in data['results'].items():
        if result is None:
            continue  # Writer processed this coordinate and found only NoData.
        digest, length = result
        if len(digest) != 20 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError(f'Invalid packet digest: {key}')
        file = OUTPUT / str(z) / f'{key}-{digest}.pack'
        if file.stat().st_size != length or file_sha(file)[:20] != digest:
            raise ValueError(f'Invalid packet: {file}')
    return data['results']


def make_level(z, source, source_hash, threads, group=None, shards=1, shard=None, merge=False):
    coarse = z < 13
    group = group or (4 if z <= 14 else 8)
    xmin, ymin, xmax, ymax = tile_range(z)
    left, top = xmin//group, ymin//group
    right, bottom = xmax//group, ymax//group
    span = 2*WORLD / 2**z
    native = threading.local()
    handles = []

    def packet(coord):
        gx, gy = coord
        if not hasattr(native, 'image'):
            dataset = rasterio.open(source)
            image = WarpedVRT(dataset, crs='EPSG:3857',
                transform=from_origin(-WORLD+left*group*span, WORLD-top*group*span, span/256, span/256),
                width=(right-left+1)*group*256, height=(bottom-top+1)*group*256,
                resampling=Resampling.nearest, tolerance=0.001,
                nodata=-9999 if coarse else 0, warp_mem_limit=48)
            native.image = image
            handles.append((image, dataset))
        size = group*256
        window = Window((gx-left)*size, (gy-top)*size, size, size)
        values = native.image.read(1, window=window)
        if coarse:
            grid = bands(values, -9999)
        else:
            grid = values.astype('<i2')
            grid -= 51
            grid[values == 0] = MISSING
        # Each entry is an independent gzip member. Only visible 256-pixel
        # tiles are decompressed by the client. Equal offsets mean real NoData.
        chunks = []
        offsets = [(group*group+1)*4]
        for dy in range(group):
            for dx in range(group):
                tile = grid[dy*256:(dy+1)*256, dx*256:(dx+1)*256]
                x, y = gx*group+dx, gy*group+dy
                body = b''
                if xmin <= x <= xmax and ymin <= y <= ymax and np.any(tile != MISSING):
                    body = gzip.compress(tile.tobytes(), compresslevel=2, mtime=0)
                chunks.append(body)
                offsets.append(offsets[-1]+len(body))
        if offsets[-1] == offsets[0]:
            return None
        payload = np.asarray(offsets,dtype='<u4').tobytes() + b''.join(chunks)
        digest = hashlib.sha256(payload).hexdigest()[:20]
        folder = OUTPUT / str(z) / str(gx)
        folder.mkdir(parents=True,exist_ok=True)
        file = folder / f'{gy}-{digest}.pack'
        atomic_write(file, payload)
        return f'{gx}/{gy}', digest, len(payload)

    keys = [(gx,gy) for gx in range(left,right+1) for gy in range(top,bottom+1)]
    identity = dict(format=1, z=z, group=group, source=source_hash,
                    bounds=[xmin,ymin,xmax,ymax], shards=shards)
    spool = CACHE / 'delivery-jobs' / source_hash / f'z{z}-g{group}-n{shards}-v1'

    def run(part, generate):
        coords = keys[len(keys)*part//shards:len(keys)*(part+1)//shards]
        names = [f'{x}/{y}' for x,y in coords]
        path = spool / f'{part}.json'
        if path.exists() or not generate:
            try:
                return verified_shard(path, identity, names)
            except (OSError, KeyError, ValueError):
                if not generate:
                    raise
        results = {}
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=threads) as pool:
                for key, result in zip(names, pool.map(packet, coords)):
                    results[key] = result[1:] if result else None
        finally:
            for image, dataset in handles:
                image.close()
                dataset.close()
            handles.clear()
        write_manifest(path, dict(identity=identity, results=results))
        return verified_shard(path, identity, names)

    if shard is not None:
        run(shard, True)
        return
    packs, lengths = {}, {}
    for part in range(shards):
        for key, result in run(part, not merge).items():
            if result:
                packs[key], lengths[key] = result
    write_manifest(INDEX / f'{z}.json', dict(z=z, group=group, bounds=identity['bounds'],
                   source=source_hash, packs=packs, lengths=lengths))
    print(f'z{z}: {len(packs)} populated packets, {sum(lengths.values()):,} bytes, {len(keys)} checked', flush=True)


def file_sha(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('levels', type=int, nargs='+', choices=range(9,17))
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--group', type=int, choices=[1, 2, 4, 8])
    parser.add_argument('--shards', type=int, default=1)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--shard', type=int, help='Write only this zero-based range')
    action.add_argument('--merge', action='store_true', help='Verify all range results and publish index')
    args = parser.parse_args()
    if args.shards < 1 or args.threads < 1 or (args.shard is not None and not 0 <= args.shard < args.shards):
        parser.error('Invalid thread count or shard range')
    if min(args.levels)<13 and file_sha(REGIO)!=REGIO_HASH:
        raise ValueError('Wrong swissALTIRegio edition or incomplete download')
    CACHE.mkdir(exist_ok=True, parents=True)
    with (CACHE/'grid.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_SH)
        if max(args.levels)>=13:
            detail_hash = file_sha(INVENTORY)
            if (CACHE/'grid-source.sha256').read_text()!=detail_hash:
                raise ValueError('Rebuild native detail grid from the pinned source inventory')
        with rasterio.Env(GDAL_CACHEMAX=384*1024*1024, GDAL_NUM_THREADS='1'):
            for z in args.levels:
                make_level(z, REGIO if z<13 else CACHE/'national.vrt', REGIO_HASH if z<13 else detail_hash, args.threads, args.group, args.shards, args.shard, args.merge)
