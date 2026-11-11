"""Compare static-GET packet layouts using identical prepared z16 members."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

from detail_sources import ROOT


def compare(area, group, zoom=16, fixture=None):
    root = ROOT / 'public/prepared' / area
    manifest = json.loads((root / 'manifest.json').read_text())
    tiles = {}
    packets = {}
    for file in sorted((root / 'raster' / str(zoom)).glob('*/*.i16.gz')):
        x, y = int(file.parent.name), int(file.name.split('.')[0])
        body = gzip.compress(gzip.decompress(file.read_bytes()), compresslevel=2, mtime=0)
        tiles[x, y] = len(body)
        slots = packets.setdefault((x//group, y//group), [b''] * group**2)
        slots[(y % group)*group + x % group] = body
    lengths, hashes = {}, {}
    for (gx, gy), slots in packets.items():
        offsets = [(len(slots)+1)*4]
        for slot in slots:
            offsets.append(offsets[-1]+len(slot))
        payload = b''.join(v.to_bytes(4, 'little') for v in offsets) + b''.join(slots)
        key = f'{gx}/{gy}'
        lengths[key] = len(payload)
        hashes[key] = hashlib.sha256(payload).hexdigest()[:20]
        if fixture:
            path = fixture / 'static/terrain' / str(zoom) / f'{key}-{hashes[key]}.pack'
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
    xs, ys = zip(*tiles)
    bounds = [min(xs), min(ys), max(xs), max(ys)]
    index = dict(z=zoom, group=group, bounds=bounds, source=manifest['fingerprint'], packs=hashes, lengths=lengths)
    encoded = json.dumps(index, separators=(',', ':'))+'\n'
    if fixture:
        dest = fixture / 'src/terrain/national-index' / f'{zoom}.json'
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(encoded)
        return
    index_bytes = len(encoded.encode())
    # Enter one new 8x8 block at its western edge. Use the same tile for all groups.
    x = (min(xs)//8 + 1)*8
    y = (min(ys)+max(ys))//2
    return dict(area=area, fingerprint=manifest['fingerprint'], group=group,
                nativeGridGzipBytes=(root/'native.i16.gz').stat().st_size,
                totalZ16Bytes=sum(lengths.values())+index_bytes, indexBytes=index_bytes,
                firstTouchTile=[16,x,y], visibleMemberBytes=tiles[x,y],
                firstTouchPacketBytes=lengths[f'{x//group}/{y//group}'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fixture', type=Path, help='Write a regional fixture into a disposable Vite checkout')
    parser.add_argument('--group', type=int, choices=(1,2,8), default=2)
    args = parser.parse_args()
    if args.fixture:
        if args.fixture.resolve() == ROOT.resolve():
            parser.error('Regional fixtures require a separate checkout')
        for zoom in (15,16):
            compare('fribourg-wide', args.group, zoom, args.fixture)
    else:
        print(json.dumps([compare(area, g) for area in ('fribourg-wide','zermatt') for g in (1,2,8)], indent=2))
