"""Compare overzoomed z16 and native 4 m sampling at identical z19 pixels."""
import gzip
import hashlib
import json
from functools import lru_cache

import numpy as np
from rasterio.warp import transform
from detail_grid import CACHE, MISSING
from detail_sources import INVENTORY
from pyramid import WORLD

rows = json.loads(gzip.decompress(INVENTORY.read_bytes()))
inventory = {(x,y): digest for x,y,_,_,digest in rows}


@lru_cache(maxsize=32)
def square(x,y):
    digest = inventory.get((x,y))
    if not digest:
        return np.full((250,250), MISSING, dtype='<i2')
    path = CACHE / digest[:2] / (digest+'.gz')
    return np.frombuffer(gzip.decompress(path.read_bytes()), dtype='<i2').reshape(250,250)


def sample(mx,my):
    east,north = transform('EPSG:3857','EPSG:2056',mx,my)
    col,row = np.floor(np.asarray(east)/4).astype(int), np.floor(np.asarray(north)/4).astype(int)
    coords = np.column_stack((col//250,row//250))
    out = np.empty(col.size, dtype='<i2')
    for x,y in np.unique(coords,axis=0):
        mask = (coords[:,0]==x) & (coords[:,1]==y)
        out[mask] = square(x,y)[249-row[mask]%250,col[mask]%250]
    return out


def compare(label,lon,lat):
    mx,my = transform('EPSG:4326','EPSG:3857',[lon],[lat])
    res = WORLD*2/(256*2**19)
    i,j = np.meshgrid(np.arange(512)+int((mx[0]+WORLD)/res)-256,
                      np.arange(512)+int((WORLD-my[0])/res)-256)
    i,j = i.ravel(),j.ravel()
    # Candidate wire format: one signed 250x250 LV95 band block per GET and
    # nine projected control points per kilometre. Invert the placement at
    # the observed pixel centres, then use native nearest-neighbour sampling.
    mx = (i+.5)*res-WORLD
    my = WORLD-(j+.5)*res
    east,north = map(np.asarray,transform('EPSG:3857','EPSG:2056',mx,my))
    approx = np.full(mx.size,MISSING,dtype='<i2')
    assigned = np.zeros(mx.size,dtype=bool)
    indexes = {}
    payload_bytes = 0
    max_error = 0
    for x in range(int(east.min()//1000)-1,int(east.max()//1000)+2):
        for y in range(int(north.min()//1000)-1,int(north.max()//1000)+2):
            xx,yy = transform('EPSG:2056','EPSG:3857',
                [x*1000,(x+1)*1000,x*1000,(x+1)*1000],
                [y*1000,y*1000,(y+1)*1000,(y+1)*1000])
            points = np.column_stack([xx,yy])
            active = (mx>=min(xx)) & (mx<=max(xx)) & (my>=min(yy)) & (my<=max(yy))
            if not active.any():
                continue
            origin = points[0]
            du,dv = points[1]-origin,points[2]-origin
            twist = points[3]-origin-du-dv
            delta = np.column_stack([mx[active],my[active]])-origin
            inverse = np.linalg.inv(np.column_stack([du,dv]))
            uv = delta @ inverse.T
            for _ in range(3):
                uv = (delta-(uv[:,0]*uv[:,1])[:,None]*twist) @ inverse.T
            # A four-corner interpolation can move an exact threshold or
            # NoData boundary by centimetres. Include the mid-edge and centre
            # controls to capture curvature across each kilometre.
            uu,vv = np.meshgrid([0,.5,1],[0,.5,1])
            ax,ay = transform('EPSG:2056','EPSG:3857',((x+uu)*1000).ravel(),((y+vv)*1000).ravel())
            mesh = np.column_stack([ax,ay]).reshape(3,3,2)
            for _ in range(2):
                u,v = uv.T
                wu = np.column_stack([(1-u)*(1-2*u),4*u*(1-u),u*(2*u-1)])
                wv = np.column_stack([(1-v)*(1-2*v),4*v*(1-v),v*(2*v-1)])
                correction = np.einsum('ni,nj,ijc->nc',wv,wu,mesh-origin)-delta
                uv -= correction @ inverse.T
            # Datum transformations in opposite directions need not round
            # trip exactly. Anchor the inverse to the same transform as taps.
            ex,ny = transform('EPSG:3857','EPSG:2056',ax,ay)
            residual = np.column_stack([ex-(x+uu.ravel())*1000,
                                        ny-(y+vv.ravel())*1000]).reshape(3,3,2)
            uv += np.einsum('ni,nj,ijc->nc',wv,wu,residual)/1000
            inside = np.all((uv>=0)&(uv<1),axis=1)
            ids = np.flatnonzero(active)[inside]
            if not ids.size:
                continue
            if assigned[ids].any():
                raise AssertionError('Overlapping block placement')
            assigned[ids] = True
            u,v = uv[inside].T
            max_error = max(max_error,float(np.hypot((x+u)*1000-east[ids],(y+v)*1000-north[ids]).max()))
            if (x,y) in inventory:
                cells = square(x,y)
                approx[ids] = cells[249-(v*250).astype(int),(u*250).astype(int)]
                body = gzip.compress(cells.tobytes(),compresslevel=2,mtime=0)
                indexes[f'{x}/{y}'] = [hashlib.sha256(body).hexdigest()[:20],len(body),mesh.tolist(),residual.tolist()]
                payload_bytes += len(body)
    if not assigned.all():
        raise AssertionError('Gap in block placement')
    native = sample((i+.5)*res-WORLD,WORLD-(j+.5)*res)
    coarse = sample((i//8+.5)*(8*res)-WORLD,WORLD-(j//8+.5)*(8*res))
    valid = (native!=MISSING) & (coarse!=MISSING)
    threshold = int(np.median(native[valid])) if valid.any() else 0
    return dict(place=label,longitude=lon,latitude=lat,z=19,pixels=int(i.size),
                thresholdMetres=10*threshold,nativeBlockBytes=payload_bytes,
                nativePlacementIndexBytes=len(json.dumps(indexes,separators=(',',':')).encode()),
                maxPlacementErrorMetres=max_error,placementBandMismatches=int((native!=approx).sum()),
                placementFogMismatches=int((((native<threshold)!=(approx<threshold))&(approx!=MISSING)&(native!=MISSING)).sum()),
                placementNoDataMismatches=int(((native==MISSING)!=(approx==MISSING)).sum()),validPairs=int(valid.sum()),
                differentBands=int(((native!=coarse)&valid).sum()),
                differentFog=int((((native<threshold)!=(coarse<threshold))&valid).sum()),
                differentNoData=int(((native==MISSING)!=(coarse==MISSING)).sum()))


if __name__ == '__main__':
    print(json.dumps([compare(*region) for region in (
        ('Fribourg',7.1619,46.8065),('Zermatt',7.7491,46.0207),
        ('Geneva dataset edge',6.252879765400131,46.31105514051027))],indent=2))
