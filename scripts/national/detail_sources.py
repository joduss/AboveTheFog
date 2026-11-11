"""Build the complete, checksum-pinned 2 m swissALTI3D inventory from STAC."""
import concurrent.futures
import gzip
import json
import re
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COLLECTION = 'https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swissalti3d/items'
INVENTORY = Path(__file__).with_name('detail-sources.json.gz')


def fetch(url, limit):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                body = response.read(limit + 1)
            if len(body) > limit:
                raise ValueError('Source exceeds size limit')
            return body
        except OSError:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def inventory(strip):
    # Disjoint longitude strips of the published collection, overlapping at
    # their boundaries. Deduplicate by the official kilometre square and date.
    west = 5 + strip * 0.25
    url = f'{COLLECTION}?limit=100&bbox={west},45,{west+0.25},48.5'
    records = []
    visited = set()
    while url:
        if not url.startswith(COLLECTION + '?') or url in visited:
            raise ValueError('Invalid STAC pagination')
        visited.add(url)
        page = json.loads(fetch(url, 8_000_000))
        for item in page['features']:
            match = re.fullmatch(r'swissalti3d_(\d{4})_(\d{4})-(\d{4})', item['id'])
            if not match:
                continue
            asset = item['assets'].get(item['id'] + '_2_2056_5728.tif')
            if asset:
                digest = asset['file:checksum'].lower()
                assert digest.startswith('1220') and len(digest) == 68
                assert asset['href'].startswith('https://data.geo.admin.ch/ch.swisstopo.swissalti3d/')
                records.append([int(match[2]), int(match[3]), item['properties']['datetime'], asset['href'], digest[4:]])
        url = next((link['href'] for link in page['links'] if link['rel'] == 'next'), None)
    print(f'Strip {west} completed with {len(records)} editions', flush=True)
    return records


if __name__ == '__main__':
    selected = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for rows in pool.map(inventory, range(24)):
            for x, y, date, url, checksum in rows:
                key = (x, y)
                candidate = (date, url, checksum)
                if key not in selected or candidate > selected[key]:
                    selected[key] = candidate
    assert len(selected) > 40000, 'Incomplete national inventory'
    rows = [[x, y, *record] for (x, y), record in sorted(selected.items())]
    tmp = INVENTORY.with_suffix('.tmp')
    tmp.write_bytes(gzip.compress(json.dumps(rows, separators=(',', ':')).encode(), mtime=0))
    tmp.replace(INVENTORY)
    print(f'Pinned {len(rows)} distinct source squares.')
