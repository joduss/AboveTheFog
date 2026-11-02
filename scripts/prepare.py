"""Download four pinned 2 m swissALTI3D COGs; create a browser data tile.
Requires Python 3.12 and rasterio 1.4.3 (GDAL included in wheel).
"""
import json, hashlib, urllib.request, time
from pathlib import Path
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.warp import transform_bounds, reproject, Resampling, transform
from rasterio.transform import from_bounds
ROOT = Path(__file__).resolve().parents[1]
raw = ROOT/'data/source'; raw.mkdir(parents=True, exist_ok=True)
out = ROOT/'public/data'; out.mkdir(parents=True, exist_ok=True)
records=[]; sources=[]
for x in (2679,2680):
    for y in (1244,1245):
        name=f'swissalti3d_2026_{x}-{y}'
        url=f'https://data.geo.admin.ch/ch.swisstopo.swissalti3d/{name}/{name}_2_2056_5728.tif'
        path=raw/(name+'.tif')
        start=time.perf_counter()
        if not path.exists(): urllib.request.urlretrieve(url,path)
        ds=rasterio.open(path)
        assert ds.crs.to_epsg()==2056 and ds.res==(2,2)
        sources.append(ds)
        records.append(dict(url=url,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),crs=str(ds.crs),resolution=ds.res,nodata=ds.nodata,downloadSeconds=time.perf_counter()-start))
arr,tr=merge(sources)
bounds=rasterio.transform.array_bounds(arr.shape[1],arr.shape[2],tr)
# Square Web Mercator grid, nearest neighbour: no invented elevations at holes/edges.
b=transform_bounds('EPSG:2056','EPSG:3857',*bounds,densify_pts=21)
side=max(b[2]-b[0],b[3]-b[1]); extent=[b[0],b[1],b[0]+side,b[1]+side]
n=1024; dst=np.full((n,n),-9999,dtype='float32'); dt=from_bounds(*extent,n,n)
reproject(arr[0],dst,src_transform=tr,src_crs='EPSG:2056',src_nodata=sources[0].nodata,dst_transform=dt,dst_crs='EPSG:3857',dst_nodata=-9999,resampling=Resampling.nearest)
# Decimetres, 65535 reserved for unavailable. Float source retained in raw COGs.
valid=(dst!=-9999)&np.isfinite(dst)
encoded=np.full((n,n),65535,dtype='<u2'); encoded[valid]=np.rint(dst[valid]*10).astype('uint16')
encoded.tofile(out/'elevation.bin')
points=[]
for label,lon,lat in [('Uetliberg summit',8.4914,47.3495),('Eastern slope',8.499,47.351),('Albisguetli',8.509,47.352)]:
    xx,yy=transform('EPSG:4326','EPSG:2056',[lon],[lat]); row,col=rasterio.transform.rowcol(tr,xx[0],yy[0]); assert 0 <= row < arr.shape[1] and 0 <= col < arr.shape[2]
    h=float(arr[0,row,col])
    mx,my=transform('EPSG:4326','EPSG:3857',[lon],[lat]); r,c=rasterio.transform.rowcol(dt,mx[0],my[0]); assert 0 <= r < n and 0 <= c < n
    prepared=float(encoded[r,c])/10
    points.append(dict(name=label,lon=lon,lat=lat,sourceMetres=h,preparedMetres=prepared,pixel=[int(c),int(r)]))
meta=dict(extent=extent,size=n,nodata=65535,scale=0.1,verticalReference='LN02 (EPSG:5728)',sourceResolutionMetres=2,sourceBoundsLV95=list(bounds),sources=records,checkpoints=points,minMetres=float(dst[valid].min()),maxMetres=float(dst[valid].max()),validPixels=int(valid.sum()),preparedBytes=(out/'elevation.bin').stat().st_size)
(out/'manifest.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta,indent=2))
