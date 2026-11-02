import assert from 'node:assert/strict';
import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync('public/data/manifest.json'));
const raw = fs.readFileSync('public/data/elevation.bin');
assert.equal(raw.byteLength, m.size * m.size * 2);
const a = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
assert.equal(a.filter(v => v !== 65535).length, m.validPixels);
assert(a.includes(65535), 'Warped edges must retain missing data');
for (const p of m.checkpoints) {
    const [x, y] = p.pixel;
    assert(x >= 0 && y >= 0 && x < m.size && y < m.size);
    const v = a[y * m.size + x] / 10;
    assert.equal(v, p.preparedMetres);
    assert(Math.abs(v - p.sourceMetres) < 0.2, `${p.name}: alignment error`);
}
let previous = 0;
for (const h of [0, 493.6, 600, 650, 800, 900, 2000]) {
    const dim = a.filter(v => v !== 65535 && v < h * 10).length;
    assert(dim >= previous);
    previous = dim;
    console.log(`${h} m: ${dim} dimmed pixels`);
}
assert.equal(previous, m.validPixels);
console.log('Real-data size, coverage, alignment and threshold checks passed.');
