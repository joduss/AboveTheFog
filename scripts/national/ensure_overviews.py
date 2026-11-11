"""Restore missing z9–12 delivery levels from the pinned swissALTIRegio edition."""
import hashlib
import json
import urllib.request
from pyramid import INDEX, OUTPUT, REGIO, REGIO_HASH, file_sha, make_level

ITEM = 'https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swissaltiregio/items/swissaltiregio'


def complete(z):
    try:
        level = json.loads((INDEX/f'{z}.json').read_bytes())
        return level['source']==REGIO_HASH and level['packs'] and all(
            file_sha(OUTPUT/str(z)/f'{key}-{digest}.pack')[:20]==digest
            for key,digest in level['packs'].items())
    except (OSError,ValueError,KeyError):
        return False


def ensure():
    missing = [z for z in range(9,13) if not complete(z)]
    if not missing:
        return
    if not REGIO.exists() or file_sha(REGIO)!=REGIO_HASH:
        with urllib.request.urlopen(ITEM,timeout=60) as response:
            url = json.load(response)['assets']['swissaltiregio_2056_5728.tif']['href']
        if not url.startswith('https://data.geo.admin.ch/'):
            raise ValueError('Unexpected regional elevation host')
        REGIO.parent.mkdir(parents=True,exist_ok=True)
        tmp=REGIO.with_suffix('.partial')
        digest=hashlib.sha256()
        with urllib.request.urlopen(url,timeout=120) as src, tmp.open('wb') as dest:
            while chunk:=src.read(1024*1024):
                dest.write(chunk)
                digest.update(chunk)
        if digest.hexdigest()!=REGIO_HASH:
            raise ValueError('Regional elevation source differs from pinned edition')
        tmp.replace(REGIO)
    for z in missing:
        make_level(z,REGIO,REGIO_HASH,2)


if __name__=='__main__':
    ensure()
