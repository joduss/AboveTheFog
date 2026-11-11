"""Check prepared tiles against source pixels and independent swisstopo heights."""
import gzip, json, math, urllib.request
from pathlib import Path
import numpy as np
import rasterio
from rasterio.warp import transform
ROOT = Path(__file__).resolve().parents[1]
folder = ROOT/'public/data/fribourg'
m = json.loads((folder/'manifest.json').read_text())
inventory = json.loads((ROOT/'scripts/fribourg-sources.json').read_text())
lookup = {(s['x'],s['y']):s for s in inventory}
points = [('Fribourg cathedral area',7.162,46.8065),('Marly',7.154,46.776),('Düdingen',7.191,46.849),('Belfaux',7.106,46.821)]
results=[]
for name,lon,lat in points:
    e,n = transform('EPSG:4326','EPSG:2056',[lon],[lat]); e,n=e[0],n[0]
    source = lookup[math.floor(e/1000),math.floor(n/1000)]
    with rasterio.open(ROOT/'data/source/fribourg'/f"{source['id']}.tif") as ds:
        original=float(next(ds.sample([(e,n)]))[0])
    x,y=transform('EPSG:4326','EPSG:3857',[lon],[lat]); x,y=x[0],y[0]
    col=math.floor((x-m['extent'][0])/m['resolutions'][-1])
    row=math.floor((m['extent'][3]-y)/m['resolutions'][-1])
    tile=np.frombuffer(gzip.decompress((folder/f'5/{col//256}/{row//256}.bin.gz').read_bytes()),dtype='<u2').reshape(256,256,2)
    prepared=float(tile[row%256,col%256,0])/10
    assert abs(prepared-original)<3, (name,original,prepared)
    levels=[]
    for z in range(6):
        shift=2**(5-z); c,r=col//shift,row//shift
        a=np.frombuffer(gzip.decompress((folder/f'{z}/{c//256}/{r//256}.bin.gz').read_bytes()),dtype='<u2').reshape(256,256,2)
        low,high=map(int,a[r%256,c%256]); assert low<=round(prepared*10)<=high
        levels.append([low/10,high/10])
    url=f'https://api3.geo.admin.ch/rest/services/height?easting={e}&northing={n}'
    remote=float(json.load(urllib.request.urlopen(url,timeout=30))['height'])
    results.append(dict(name=name,lon=lon,lat=lat,sourceMetres=original,preparedMetres=prepared,heightServiceMetres=remote,pixel=[col,row],ranges=levels))
(folder/'checkpoints.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
