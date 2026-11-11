"""Write immutable LV95 blocks and z12 placement pages; publish release index last."""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
from rasterio.warp import transform
from detail_grid import CACHE, MISSING
from detail_sources import INVENTORY, ROOT
from pyramid import WORLD, atomic_write, tile_range

PAGE_Z = 12
STEPS = 8  # Four quadratic patches in each direction across a z12 tile.


def hashed(folder, body, suffix):
    digest = hashlib.sha256(body).hexdigest()
    file = folder / digest[:2] / (digest + suffix)
    if not file.exists() or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
        atomic_write(file,body)
    return [digest,len(body)]


def build(root, bounds=None, threads=4, destination=None):
    rows = json.loads(gzip.decompress(INVENTORY.read_bytes()))
    inventory = {(x,y):digest for x,y,_,_,digest in rows}
    footprint = bounds or tile_range(PAGE_Z)
    pages = {}
    referenced = set()
    span = 2*WORLD/2**PAGE_Z
    for x in range(footprint[0],footprint[2]+1):
        for y in range(footprint[1],footprint[3]+1):
            xx,yy = np.meshgrid(np.linspace(x,x+1,STEPS+1)*span-WORLD,
                                WORLD-np.linspace(y,y+1,STEPS+1)*span)
            east,north = transform('EPSG:3857','EPSG:2056',xx.ravel(),yy.ravel())
            # One neighbouring square covers curved edges between controls.
            keys = [(sx,sy) for sx in range(int(min(east)//1000)-1,int(max(east)//1000)+2)
                    for sy in range(int(min(north)//1000)-1,int(max(north)//1000)+2)
                    if (sx,sy) in inventory]
            pages[x,y] = (list(zip(east,north)),keys)
            referenced.update(keys)
    if not bounds:
        # Inventory can extend beyond the supported rectangular map extent.
        # Check every square whose centre lies in that extent.
        coords = list(inventory)
        mx,my = transform('EPSG:2056','EPSG:3857',[x*1000+500 for x,y in coords],[y*1000+500 for x,y in coords])
        for key,e,n in zip(coords,mx,my):
            px,py = int((e+WORLD)//span),int((WORLD-n)//span)
            if footprint[0]<=px<=footprint[2] and footprint[1]<=py<=footprint[3] and key not in referenced:
                raise ValueError(f'Missing covered square {key}')
    out = root/'static/terrain/native'
    def block(key):
        source = inventory[key]
        file = CACHE/source[:2]/(source+'.gz')
        body = file.read_bytes()
        values = np.frombuffer(gzip.decompress(body),dtype='<i2')
        if values.size!=62500 or not np.all((values==MISSING)|((values>=-50)&(values<=999))):
            raise ValueError(f'Invalid native square {key}')
        return key,hashed(out/'blocks',body,'.band')
    with concurrent.futures.ThreadPoolExecutor(max_workers=threads) as pool:
        blocks = dict(pool.map(block,sorted(referenced)))
    index = {}
    for (x,y),(controls,keys) in pages.items():
        page = dict(x=x,y=y,controls=controls,blocks={f'{sx}/{sy}':blocks[sx,sy] for sx,sy in keys})
        body = json.dumps(page,separators=(',',':')).encode()
        index[f'{x}/{y}'] = hashed(out/'pages',body,'.json')
    release = dict(version=1,source=hashlib.sha256(INVENTORY.read_bytes()).hexdigest(),
                   bounds=footprint, pages=index, blocks=len(blocks))
    atomic_write(destination or root/'src/terrain/native-index/release.json',json.dumps(release,separators=(',',':')).encode())
    print(f'{len(index)} pages, {len(blocks)} distinct squares, {sum(n for _,n in blocks.values()):,} block bytes')


def release_ranges(root, shards, part=None, merge=False):
    left,top,right,bottom = tile_range(PAGE_Z)
    if shards<1 or shards>right-left+1 or (part is not None and not 0<=part<shards):
        raise ValueError('Invalid native delivery range')
    digest = hashlib.sha256(INVENTORY.read_bytes()).hexdigest()
    jobs = CACHE/'native-jobs'/digest/f'v1-{shards}'
    out = root/'static/terrain/native'
    def verify_file(kind,ref,suffix):
        sha,size = ref
        if len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):
            raise ValueError('Invalid output digest')
        body = (out/kind/sha[:2]/(sha+suffix)).read_bytes()
        if len(body)!=size or hashlib.sha256(body).hexdigest()!=sha:
            raise ValueError('Invalid output '+sha)
        return body
    seen = set()
    pages = {}
    squares = {}
    for number in range(shards) if part is None else [part]:
        x0 = left+(right-left+1)*number//shards
        x1 = left+(right-left+1)*(number+1)//shards-1
        bounds = [x0,top,x1,bottom]
        dest = jobs/f'{number}.json'
        def check():
            result = json.loads(dest.read_bytes())
            expected = {f'{x}/{y}' for x in range(x0,x1+1) for y in range(top,bottom+1)}
            if result['source']!=digest or result['bounds']!=bounds or set(result['pages'])!=expected:
                raise ValueError('Unverified native delivery range')
            for key,ref in result['pages'].items():
                page = json.loads(verify_file('pages',ref,'.json'))
                if key!=f"{page['x']}/{page['y']}":
                    raise ValueError('Page address mismatch')
                for coord,block in page['blocks'].items():
                    if coord in squares and squares[coord]!=block:
                        raise ValueError('Inconsistent native square')
                    if block[0] not in seen:
                        verify_file('blocks',block,'.band')
                        seen.add(block[0])
                    squares[coord]=block
            return result['pages']
        try:
            checked = check()
        except (FileNotFoundError,ValueError,KeyError):
            if merge:
                raise
            build(root,bounds,destination=dest)
            checked = check()
        if pages.keys() & checked.keys():
            raise ValueError('Duplicate delivery range')
        pages.update(checked)
    if part is None:
        candidate = jobs/'release.json'
        release = dict(version=1,source=digest,bounds=[left,top,right,bottom],pages=pages,blocks=len(squares))
        atomic_write(candidate,json.dumps(release,separators=(',',':')).encode())
        subprocess.run(['node',str(ROOT/'scripts/verify_native_assets.mjs'),str(root),str(candidate)],check=True)
        atomic_write(root/'src/terrain/native-index/release.json',candidate.read_bytes())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fixture',type=Path)
    parser.add_argument('--bounds',nargs=4,type=int,metavar=('XMIN','YMIN','XMAX','YMAX'))
    parser.add_argument('--shards',type=int,default=8)
    action=parser.add_mutually_exclusive_group()
    action.add_argument('--shard',type=int)
    action.add_argument('--merge',action='store_true')
    args = parser.parse_args()
    if args.bounds and (not args.fixture or args.fixture.resolve()==ROOT.resolve()):
        parser.error('Regional bounds require a disposable fixture checkout')
    if args.fixture:
        build(args.fixture,args.bounds)
    else:
        release_ranges(ROOT,args.shards,args.shard,args.merge)
