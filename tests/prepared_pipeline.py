"""Independent discrete-grid, topology, georeferencing and real-data checks."""
import gzip, hashlib, importlib.util, json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.features import shapes, rasterize
from rasterio.transform import from_origin, rowcol, xy
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('bands',root/'scripts/prepare_bands.py'); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
h=np.array([[-.1,0,9.999,10,659,659.999,660,660.001,np.nan,np.inf,-9999]],dtype='float32')
expected=np.array([[-1,0,0,1,65,65,66,66,-32768,-32768,-32768]],dtype='int16')
assert np.array_equal(module.encode(h),expected)
valid=expected!=-32768
for threshold in [-10,0,10,650,660,670]: assert np.array_equal((h<threshold)[valid],(expected*10<threshold)[valid])
# Islands, holes, edge crossings, and NoData share the same discrete polygon contract.
fixture=np.array([[1,1,1,2,2,2],[1,-32768,1,2,3,2],[1,1,1,2,2,2],[0,0,0,0,-1,-1]],dtype='int16')
t=from_origin(2570000,1180000,4,4)
polygons=list(shapes(fixture,transform=t))
assert any(len(g['coordinates'])>1 for g,v in polygons), 'hole must survive'
assert np.array_equal(rasterize(polygons,out_shape=fixture.shape,transform=t,dtype='int16'),fixture)
for name in ['fribourg','zermatt','fribourg-wide']:
 folder=root/'public/prepared'/name
 manifest=json.loads((folder/'manifest.json').read_text())
 assert manifest['gridMetres']==4 and manifest['nativeCRS']=='EPSG:2056'
 bounds=manifest['nativeBounds']; assert all(v%4==0 for v in bounds)
 assert [(bounds[3]-bounds[1])//4,(bounds[2]-bounds[0])//4]==manifest['nativeShape']
 assert manifest['vectorRasterMismatchPixels']==0
 native=np.frombuffer(gzip.decompress((folder/'native.i16.gz').read_bytes()),dtype='<i2').reshape(manifest['nativeShape'])
 transform=from_origin(bounds[0],bounds[3],4,4)
 records=json.loads((root/'scripts/prepared'/f'{name}-sources.json').read_text())
 checked=0
 for r in records[::max(1,len(records)//12)]:
  p=root/'data/source/fribourg'/(r['id']+'.tif')
  if not p.exists(): p=root/'data/source'/(r['id']+'.tif')
  with rasterio.open(p) as src:
   # Independent nearest-pixel lookup at a prepared grid cell centre.
   rr,cc=rowcol(transform,r['x']*1000+502,r['y']*1000+502)
   if not (0<=rr<native.shape[0] and 0<=cc<native.shape[1]): continue
   e,n=xy(transform,rr,cc); height=next(src.sample([(e,n)]))[0]
   assert native[rr,cc]==module.encode(np.array([[height]],dtype='float32'))[0,0]
   checked+=1
 assert checked>=5
 for key,sha in manifest['checksums'].items(): assert hashlib.sha256((folder/key).read_bytes()).hexdigest()==sha
 # Adjacent delivery tiles have precisely shared edges; no independent grid rounding.
 for z in range(13,18):
  a=module.tile_bounds(z,17000,11600);b=module.tile_bounds(z,17001,11600)
  assert abs(a[2]-b[0])<1e-8
 print(name,': native/source checks',checked,'; all tile hashes; zero vector/raster mismatches across',manifest['comparedPixels'],'pixels')
print('Grid, quantization, topology and generated-asset checks passed.')
# Exercise an interrupted run and one corrupt output without touching app assets.
import contextlib, io, tempfile
with tempfile.TemporaryDirectory(prefix='prepared-resume-') as temp:
 out=Path(temp)
 config=json.loads((root/'scripts/prepared/areas.json').read_text())
 config['minZoom']=14;config['maxZoom']=15
 area=dict(config['areas'][0],sideTiles=3)
 with contextlib.redirect_stdout(io.StringIO()): first=module.prepare(area,config,out)
 folder=out/area['id']; files=list(first['checksums']); untouched=folder/files[0]; corrupt=folder/files[-1]
 stamp=untouched.stat().st_mtime_ns
 # Absence of final manifest simulates a process interrupted before commit.
 (folder/'manifest.json').unlink();corrupt.write_bytes(b'bad')
 with contextlib.redirect_stdout(io.StringIO()): recovered=module.prepare(area,config,out)
 assert untouched.stat().st_mtime_ns==stamp,'Complete checkpoint tile should not be regenerated'
 assert recovered['checksums']==first['checksums'],'Corrupt tile must regenerate deterministically'
 with contextlib.redirect_stdout(io.StringIO()): module.prepare(area,config,out)
 assert untouched.stat().st_mtime_ns==stamp,'Complete run should verify and resume'
print('Interrupted/corrupt tile recovery and checksum-only complete reuse passed.')
