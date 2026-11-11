"""Independent native band at the display texel centre for browser comparisons."""
import gzip
import json
import math
import sys
from pathlib import Path
from rasterio.warp import transform
from pyramid import WORLD
import struct

root = Path(sys.argv[1])
z = int(sys.argv[2])
mx,my = map(float,sys.argv[3:5])
res = 2*WORLD/(256*2**z)
col,row = math.floor((mx+WORLD)/res), math.floor((WORLD-my)/res)
east,north = transform('EPSG:3857','EPSG:2056',[(col+.5)*res-WORLD],[WORLD-(row+.5)*res])
e,n = math.floor(east[0]/4),math.floor(north[0]/4)
manifest = json.loads((root/'src/terrain/native-index/release.json').read_bytes())
px,py = col//(256*2**(z-12)),row//(256*2**(z-12))
base = root/'static/terrain/native'
ref = manifest['pages'].get(f'{px}/{py}')
band = -32768
if ref:
    digest = ref[0]
    page = json.loads((base/'pages'/digest[:2]/(digest+'.json')).read_bytes())
    block = page['blocks'].get(f'{e//250}/{n//250}')
    if block:
        digest = block[0]
        data = gzip.decompress((base/'blocks'/digest[:2]/(digest+'.band')).read_bytes())
        band = struct.unpack_from('<h',data,2*((249-n%250)*250+e%250))[0]
print(json.dumps(dict(height=-99999 if band==-32768 else band*10,dataset=manifest['source'])))
