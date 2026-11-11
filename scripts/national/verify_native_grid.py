"""Check delivered native square values and placement against pinned source controls."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import numpy as np
from rasterio.warp import transform
from rasterio.io import MemoryFile
from detail_grid import CACHE,bands
from detail_sources import INVENTORY, ROOT, fetch
from pyramid import WORLD


def verify(root):
    index = json.loads((root/'src/terrain/native-index/release.json').read_bytes())
    rows = json.loads(gzip.decompress(INVENTORY.read_bytes()))
    sources = {(x,y):digest for x,y,_,_,digest in rows}
    base = root/'static/terrain/native'
    seen = set()
    max_error = 0
    for key,ref in index['pages'].items():
        px,py = map(int,key.split('/'))
        page = json.loads((base/'pages'/ref[0][:2]/(ref[0]+'.json')).read_bytes())
        controls = np.asarray(page['controls']).reshape(9,9,2)
        # Compare every patch at independent interior positions, including
        # shared page edges. Neither validation points nor taps are mesh nodes.
        coords = [(u,v) for u in (0,.13,.49,.87,1) for v in (0,.19,.51,.93,1)]
        samples = []
        mx,my = [],[]
        for ix in range(4):
            for iy in range(4):
                for u,v in coords:
                    wu=[(1-u)*(1-2*u),4*u*(1-u),u*(2*u-1)]
                    wv=[(1-v)*(1-2*v),4*v*(1-v),v*(2*v-1)]
                    samples.append(np.einsum('i,j,ijc->c',wv,wu,controls[2*iy:2*iy+3,2*ix:2*ix+3]))
                    mx.append((px+(ix+u)/4)*2*WORLD/4096-WORLD)
                    my.append(WORLD-(py+(iy+v)/4)*2*WORLD/4096)
        expected = np.column_stack(transform('EPSG:3857','EPSG:2056',mx,my))
        error = float(np.max(np.linalg.norm(expected-np.array(samples),axis=1)))
        max_error=max(max_error,error)
        if error>.002:
            raise ValueError(f'Placement error {error} m at {key}')
        for coord,(digest,length) in page['blocks'].items():
            if coord in seen:
                continue
            seen.add(coord)
            x,y = map(int,coord.split('/'))
            source = sources[x,y]
            original = CACHE/source[:2]/(source+'.gz')
            delivered = base/'blocks'/digest[:2]/(digest+'.band')
            if original.read_bytes()!=delivered.read_bytes():
                raise ValueError(f'Delivered block differs from pinned square {coord}')
    # Validate the cache against original 2 m TIFFs independently of delivery.
    east,north = transform('EPSG:4326','EPSG:2056',[7.1619,7.7491,6.2528797654],[46.8065,46.0207,46.3110551405])
    controls = {(int(e//1000),int(n//1000)) for e,n in zip(east,north)}
    for x,y,_,url,digest in rows:
        if (x,y) not in controls:
            continue
        name = url.rsplit('/',1)[1]
        local = next((p for p in (ROOT/'data/source'/name,ROOT/'data/source/fribourg'/name) if p.is_file()),None)
        original = local.read_bytes() if local else fetch(url,8000000)
        if hashlib.sha256(original).hexdigest()!=digest:
            raise ValueError(f'Wrong source TIFF: {name}')
        with MemoryFile(original) as mem, mem.open() as ds:
            expected = bands(ds.read(1)[1::2,1::2],ds.nodata)
        raw = gzip.decompress((CACHE/digest[:2]/(digest+'.gz')).read_bytes())
        if expected.tobytes()!=raw:
            raise ValueError(f'Native band mismatch against original source: {name}')
    # Check that every omitted inventory square lies wholly outside the
    # application's Swiss extent; sample all four edges in the map projection.
    for x,y in sources:
        if f'{x}/{y}' in seen:
            continue
        perimeter = [(t,edge) for t in np.linspace(0,1,11) for edge in (0,1)]
        perimeter += [(b,a) for a,b in perimeter]
        lon,lat = transform('EPSG:2056','EPSG:4326',[(x+a)*1000 for a,b in perimeter],[(y+b)*1000 for a,b in perimeter])
        if max(lon)>=5.95 and min(lon)<=10.5 and max(lat)>=45.8 and min(lat)<=47.85:
            raise ValueError(f'Supported source square omitted: {x}/{y}')
    print(f'{len(controls)*62500} native cells compared with original TIFFs; {len(sources)-len(seen)} squares outside footprint')
    print(f'{len(seen)} complete native squares compared, {len(index["pages"])*400} placement checks, '
          f'max inverse projection error {max_error:.7f} m',flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',type=Path,default=ROOT)
    verify(parser.parse_args().root)
