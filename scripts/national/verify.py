"""Check every shipped packet, plus independent controls across the 4 m source grid."""
import gzip
import hashlib
import json
import struct
import sys
from collections import defaultdict

import numpy as np
import rasterio
from rasterio.warp import transform
from detail_grid import CACHE, MISSING
from detail_sources import INVENTORY
from pyramid import INDEX, OUTPUT, WORLD, tile_range


def verify(z, rows):
    level = json.loads((INDEX / f'{z}.json').read_bytes())
    group = level['group']
    assert level['z'] == z and level['bounds'] == tile_range(z)
    controls = defaultdict(list)
    if z >= 13:
        # Pick a screen pixel near the middle of every published kilometre.
        # Its expected band comes from the native source at that exact pixel
        # centre, independently of the packet writer and its tile addressing.
        mx, my = transform('EPSG:2056','EPSG:3857', [r[0]*1000+500 for r in rows], [r[1]*1000+500 for r in rows])
        res = 2*WORLD/(256*2**z)
        px = np.floor((np.asarray(mx)+WORLD)/res).astype(int)
        py = np.floor((WORLD-np.asarray(my))/res).astype(int)
        east, north = transform('EPSG:3857','EPSG:2056', -WORLD+(px+.5)*res, WORLD-(py+.5)*res)
        with rasterio.open(CACHE/'national.vrt') as ds:
            native = np.memmap(CACHE/'national.u16', dtype='<u2', mode='r', shape=ds.shape)
            col = (np.asarray(east)-ds.bounds.left)/4
            row = (ds.bounds.top-np.asarray(north))/4
            ref = native[row.astype(int),col.astype(int)].astype(int)
            ref = np.where(ref==0,MISSING,ref-51)
            for i,(xp,yp) in enumerate(zip(px,py)):
                x,y = int(xp)//256, int(yp)//256
                xmin,ymin,xmax,ymax = level['bounds']
                if not (xmin<=x<=xmax and ymin<=y<=ymax):
                    continue
                key = f'{x//group}/{y//group}'
                # WarpedVRT permits 0.001 source pixels of interpolation error.
                # At a native cell boundary either immediately adjacent source
                # cell can be selected. All other samples must match exactly.
                valid = {int(ref[i])}
                if min(abs(col[i]-round(col[i])),abs(row[i]-round(row[i]))) < .002:
                    for rr in {int(row[i]-.002),int(row[i]+.002)}:
                        for cc in {int(col[i]-.002),int(col[i]+.002)}:
                            value = int(native[rr,cc])
                            valid.add(value-51 if value else MISSING)
                controls[key].append(((y%group)*group+x%group, (yp%256)*256+xp%256, valid))
    count = group*group
    checked = 0
    valid_tiles = 0
    for key, digest in level['packs'].items():
        gx,gy = key.split('/')
        data = (OUTPUT / str(z) / gx / f'{gy}-{digest}.pack').read_bytes()
        assert hashlib.sha256(data).hexdigest()[:20] == digest
        offsets = struct.unpack_from(f'<{count+1}I',data)
        assert offsets[0] == 4*(count+1) and offsets[-1] == len(data)
        assert all(a<=b for a,b in zip(offsets,offsets[1:]))
        valid_tiles += sum(a<b for a,b in zip(offsets,offsets[1:]))
        by_tile = defaultdict(list)
        for slot, pixel, expected in controls.pop(key, []):
            by_tile[slot].append((pixel,expected))
        for slot, samples in by_tile.items():
            a,b = offsets[slot:slot+2]
            tile = np.frombuffer(gzip.decompress(data[a:b]),dtype='<i2') if b>a else None
            assert tile is None or tile.size==65536
            for pixel, expected in samples:
                value = int(tile[pixel]) if tile is not None else MISSING
                if value not in expected:
                    raise AssertionError((z,key,slot,int(pixel),value,expected))
                checked += 1
    for absent in controls.values():
        for _,_,expected in absent:
            assert MISSING in expected, 'Valid source cell absent from coverage manifest'
            checked += 1
    print(f'z{z}: {len(level["packs"])} packet hashes, {valid_tiles} populated tiles, {checked} source checks',flush=True)


if __name__ == '__main__':
    rows = json.loads(gzip.decompress(INVENTORY.read_bytes()))
    for z in map(int,sys.argv[1:] or range(9,17)):
        verify(z,rows)
