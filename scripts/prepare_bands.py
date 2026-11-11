"""Bounded, resumable swissALTI3D comparison. Run with .prep-env/bin/python.
No server needed: output is public/prepared, source data stays in data/source.
"""
import argparse, gzip, hashlib, json, math, resource, time, urllib.request
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_origin, from_bounds
from rasterio.warp import transform_bounds, reproject, Resampling
from rasterio.features import shapes, rasterize

ROOT = Path(__file__).resolve().parents[1]
WORLD = 20037508.342789244
MISSING = -32768

def fetch(url):
    for n in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                body=r.read(32_000_001)
                if len(body)>32_000_000: raise ValueError('Source/catalogue response exceeds 32 MB bound')
                return body
        except Exception:
            if n == 3: raise
            time.sleep(2**n)

def digest(b): return hashlib.sha256(b).hexdigest()
def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_bytes(data); temp.replace(path)
def js(value): return json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
def tile_bounds(z,x,y):
    s = 2*WORLD/2**z
    return [-WORLD+x*s,WORLD-(y+1)*s,-WORLD+(x+1)*s,WORLD-y*s]
def encode(heights):
    valid = np.isfinite(heights) & (heights != -9999) & (heights > -500) & (heights < 10000)
    result = np.full(heights.shape,MISSING,dtype='<i2')
    result[valid] = np.floor(heights[valid]/10).astype('<i2')
    return result

def prepare(area, config, out):
    start = time.perf_counter()
    lon,lat = area['center']; side = area['sideTiles']; zbase=15
    assert side > 0 and side <= 17 and side % 2 == 1, 'Bounded odd sideTiles <= 17'
    cx = int((lon+180)/360*2**zbase); cy=int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**zbase)
    x0,y0=cx-side//2,cy-side//2
    a=tile_bounds(15,x0,y0); b=tile_bounds(15,x0+side-1,y0+side-1)
    coverage=[a[0],b[1],b[2],a[3]]
    bb=transform_bounds('EPSG:3857','EPSG:2056',*coverage,densify_pts=41)
    # One global 4 m lattice, anchored at LV95 (0,0), before tiling.
    bounds=[math.floor(bb[0]/4)*4,math.floor(bb[1]/4)*4,math.ceil(bb[2]/4)*4,math.ceil(bb[3]/4)*4]
    w,h=int((bounds[2]-bounds[0])/4),int((bounds[3]-bounds[1])/4)
    assert w*h <= 25_000_000, 'Per-area preparation memory bound exceeded'
    native_transform=from_origin(bounds[0],bounds[3],4,4)
    folder=out/area['id']; folder.mkdir(parents=True,exist_ok=True)
    inventory=ROOT/'scripts/prepared'/(area['id']+'-sources.json')
    if inventory.exists(): records=json.loads(inventory.read_text())
    else:
        bbox=transform_bounds('EPSG:2056','EPSG:4326',*bounds,densify_pts=41)
        url='https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items?bbox='+','.join(map(str,bbox))+'&limit=100'
        chosen={}; pages=0
        while url:
            pages+=1; assert pages<=16, 'Catalogue page cap exceeded'
            page=json.loads(fetch(url))
            for item in page['features']:
                for name,asset in item['assets'].items():
                    if not name.endswith('_2_2056_5728.tif'): continue
                    parts=item['id'].split('_'); year=int(parts[1]); x,y=map(int,parts[2].split('-'))
                    if x*1000>=bounds[2] or (x+1)*1000<=bounds[0] or y*1000>=bounds[3] or (y+1)*1000<=bounds[1]: continue
                    sha=asset['checksum:multihash']; assert sha.startswith('1220')
                    key=(x,y)
                    if key not in chosen or chosen[key]['year']<year:
                        chosen[key]=dict(id=item['id'],year=year,x=x,y=y,url=asset['href'],sha256=sha[4:])
            url=next((v['href'] for v in page['links'] if v['rel']=='next'),None)
        records=sorted(chosen.values(),key=lambda r:r['id'])
        assert records, 'Empty source inventory'
        save(inventory,js(records))
    for record in records: record['sha256'] = record['sha256'].lower()
    # Verify cached sources and reuse the previous Fribourg downloads.
    paths=[]
    for record in records:
        name=record['id']+'.tif'; p=ROOT/'data/source'/name
        cached=ROOT/'data/source/fribourg'/name
        if cached.exists() and digest(cached.read_bytes())==record['sha256']: p=cached
        if not p.exists() or digest(p.read_bytes())!=record['sha256']: save(p,fetch(record['url']))
        assert digest(p.read_bytes())==record['sha256'], 'Source checksum mismatch: '+str(p)
        paths.append(p)
    fingerprint=digest(js(dict(area=area,config=config,sources=records,format=1)))
    manifest=folder/'manifest.json'
    if manifest.exists():
        old=json.loads(manifest.read_text())
        if old['fingerprint']==fingerprint and all((folder/k).exists() and digest((folder/k).read_bytes())==v for k,v in old['checksums'].items()):
            print(area['id']+': verified complete output, reused',flush=True); return old
    heights=np.full((h,w),-9999,dtype='float32')
    for p in paths:
        with rasterio.open(p) as src:
            assert src.crs.to_epsg()==2056 and src.res==(2,2) and src.nodata==-9999
            reproject(rasterio.band(src,1),heights,src_transform=src.transform,src_crs=src.crs,src_nodata=-9999,
                      dst_transform=native_transform,dst_crs='EPSG:2056',dst_nodata=-9999,init_dest_nodata=False,resampling=Resampling.nearest)
    bands=encode(heights)
    valid=bands!=MISSING
    # Quantization must preserve every multiple-of-ten comparison, including equality.
    # Every valid height lies in its encoded half-open interval. This proves
    # equivalence at all multiples of ten without rescanning the mosaic 1051 times.
    assert np.all(heights[valid] >= bands[valid]*10)
    assert np.all(heights[valid] < (bands[valid]+1)*10)
    save(folder/'native.i16.gz',gzip.compress(bands.tobytes(),mtime=0))
    del heights
    progress_path=folder/'progress.json'
    progress=json.loads(progress_path.read_text()) if progress_path.exists() else {}
    if progress.get('fingerprint')!=fingerprint: progress=dict(fingerprint=fingerprint,tiles={})
    checksums={}; sizes={'raster':0,'vector':0}; times={'raster':0.,'vector':0.}; features=0; mismatch=0; pixels=0; overview_disagreement={}
    for z in range(config['minZoom'],config['maxZoom']+1):
        scale=2**(z-15)
        xmin,xmax=math.floor(x0*scale),math.ceil((x0+side)*scale)-1
        ymin,ymax=math.floor(y0*scale),math.ceil((y0+side)*scale)-1
        changed=total=0
        for x in range(xmin,xmax+1):
            for y in range(ymin,ymax+1):
                tb=tile_bounds(z,x,y); transform=from_bounds(*tb,256,256)
                key=f'{z}/{x}/{y}'; previous=progress['tiles'].get(key)
                if previous and all((folder/k).exists() and digest((folder/k).read_bytes())==v for k,v in previous['checksums'].items()):
                    checksums.update(previous['checksums'])
                    for kind in sizes: sizes[kind]+=previous['sizes'][kind]; times[kind]+=previous['seconds'][kind]
                    features+=previous['features']; mismatch+=previous['mismatch']; pixels+=65536
                    changed+=previous['changed']; total+=previous['total']
                    continue
                tile_sizes={}; tile_checks={}; tile_times={}; sub_changed=sub_total=0
                t=time.perf_counter()
                tile=np.full((256,256),MISSING,dtype='<i2')
                reproject(bands,tile,src_transform=native_transform,src_crs='EPSG:2056',src_nodata=MISSING,
                          dst_transform=transform,dst_crs='EPSG:3857',dst_nodata=MISSING,resampling=Resampling.nearest)
                # Discrete coverage clipping: never advertise data beyond evaluation footprint.
                xs=tb[0]+(np.arange(256)+.5)*(tb[2]-tb[0])/256
                ys=tb[3]-(np.arange(256)+.5)*(tb[3]-tb[1])/256
                mask=(xs[None,:]>=coverage[0])&(xs[None,:]<coverage[2])&(ys[:,None]>=coverage[1])&(ys[:,None]<coverage[3])
                tile[~mask]=MISSING
                payload=gzip.compress(tile.tobytes(),compresslevel=6,mtime=0)
                path=f'raster/{z}/{x}/{y}.i16.gz'; save(folder/path,payload); checksums[path]=digest(payload); sizes['raster']+=len(payload)
                tile_times['raster']=time.perf_counter()-t; times['raster']+=tile_times['raster']; tile_sizes['raster']=len(payload); tile_checks[path]=digest(payload)
                t=time.perf_counter()
                # Polygonize cells, including NoData: no contour interpolation or smoothing.
                fs=[dict(type='Feature',properties=dict(band=int(value)),geometry=geometry) for geometry,value in shapes(tile,transform=transform,connectivity=4)]
                back=rasterize([(f['geometry'],f['properties']['band']) for f in fs],out_shape=(256,256),transform=transform,fill=MISSING,dtype='int16')
                mismatch+=int((back!=tile).sum()); pixels+=tile.size; features+=len(fs)
                payload=gzip.compress(js(dict(type='FeatureCollection',features=fs)),compresslevel=6,mtime=0)
                path=f'vector/{z}/{x}/{y}.json.gz'; save(folder/path,payload); checksums[path]=digest(payload); sizes['vector']+=len(payload)
                tile_times['vector']=time.perf_counter()-t; times['vector']+=tile_times['vector']; tile_sizes['vector']=len(payload); tile_checks[path]=digest(payload)
                # Compare broad samples with four subcell samples at threshold 650/2500 m.
                if z<17:
                    fine=np.full((512,512),MISSING,dtype='<i2')
                    reproject(bands,fine,src_transform=native_transform,src_crs='EPSG:2056',src_nodata=MISSING,dst_transform=from_bounds(*tb,512,512),dst_crs='EPSG:3857',dst_nodata=MISSING,resampling=Resampling.nearest)
                    parent=tile.repeat(2,0).repeat(2,1); both=(parent!=MISSING)&(fine!=MISSING)
                    threshold=65 if area['id']=='fribourg' else 250
                    sub_changed=int(((parent<threshold)!=(fine<threshold))[both].sum()); sub_total=int(both.sum()); changed+=sub_changed; total+=sub_total
                progress['tiles'][key]=dict(checksums=tile_checks,sizes=tile_sizes,seconds=tile_times,features=len(fs),mismatch=int((back!=tile).sum()),changed=sub_changed,total=sub_total)
                save(progress_path,js(progress))
        overview_disagreement[str(z)]=dict(thresholdMetres=650 if area['id']=='fribourg' else 2500,comparedSubsamples=total,changed=changed)
        print(f'{area["id"]} z{z}: {sizes}',flush=True)
    result=dict(version=1,id=area['id'],fingerprint=fingerprint,coverage=coverage,nativeBounds=bounds,nativeShape=[h,w],nativeCRS='EPSG:2056',nativeOrigin=[0,0],gridMetres=4,bandMetres=10,nodata=MISSING,encoding='little-endian signed int16 floor(height/10); -32768 missing',verticalDatum='LN02 EPSG:5728',sampling='nearest; pixel centres',deliveryCRS='EPSG:3857',minZoom=config['minZoom'],maxZoom=config['maxZoom'],tileSize=256,sourceYears=sorted(set(r['year'] for r in records)),sourceBytes=sum(p.stat().st_size for p in paths),sourceCount=len(paths),nativeValid=int(valid.sum()),sizes=sizes,stageSeconds=times,generationSeconds=time.perf_counter()-start,peakRSSBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,vectorFeatures=features,vectorRasterMismatchPixels=mismatch,comparedPixels=pixels,overviewDisagreement=overview_disagreement,checksums=checksums)
    save(manifest,js(result)); return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--config',default=str(ROOT/'scripts/prepared/areas.json')); parser.add_argument('--area'); args=parser.parse_args()
    config=json.loads(Path(args.config).read_text()); out=ROOT/'public/prepared'
    # Controls are intentionally explicit; this experiment is fixed at confirmed resolution.
    assert config['gridMetres']==4 and config['bandMetres']==10 and config['tileSize']==256
    assert 7<=config['minZoom']<=config['maxZoom']<=17
    for area in config['areas']:
        if not args.area or args.area==area['id']: prepare(area,config,out)
    manifests=[json.loads(p.read_text()) for p in sorted(out.glob('*/manifest.json'))]
    index=dict(version=1,areas=[{k:m[k] for k in ['id','fingerprint','coverage','minZoom','maxZoom','gridMetres','bandMetres','nodata']} for m in manifests])
    save(out/'index.json',js(index))
    save(ROOT/'src/terrain/prepared-index.json',js(index))
