import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root = 'public/data/fribourg/';
const m = JSON.parse(readFileSync(root + 'manifest.json'));
const checksums = JSON.parse(readFileSync(root + 'checksums.json'));
assert.equal(m.tileCount,1365);
assert.equal(m.areaKm2,256);
let bytes=0,valid=0;
function tile(z,x,y) {
  const b=gunzipSync(readFileSync(`${root}${z}/${x}/${y}.bin.gz`));
  assert.equal(b.length,256*256*4);
  return new Uint16Array(b.buffer,b.byteOffset,b.byteLength/2);
}
for(const [file,hash] of Object.entries(checksums)) {
  const zipped=readFileSync(root+file);
  assert.equal(createHash('sha256').update(zipped).digest('hex'),hash,file);
  bytes+=zipped.length;
  const a=tile(...file.replace('.bin.gz','').split('/').map(Number));
  for(let i=0;i<a.length;i+=2) {
    assert(a[i]<=a[i+1]);
    assert.equal(a[i]===65535,a[i+1]===65535);
    if(file.startsWith('5/')) {assert.equal(a[i],a[i+1]);if(a[i]!==65535)valid++;}
  }
}
assert.equal(bytes,m.preparedBytes);
assert.equal(valid,m.validPixels);
// Full parent/child consistency, including missing children and cross-tile seams.
for(let z=0;z<5;z++) for(let x=0;x<2**z;x++) for(let y=0;y<2**z;y++) {
  const parent=tile(z,x,y);
  const children=[tile(z+1,x*2,y*2),tile(z+1,x*2+1,y*2),tile(z+1,x*2,y*2+1),tile(z+1,x*2+1,y*2+1)];
  for(let row=0;row<256;row++) for(let col=0;col<256;col++) {
    const child=children[Math.floor(row/128)*2+Math.floor(col/128)];
    let lo=65535,hi=0,missing=false;
    for(let dy=0;dy<2;dy++) for(let dx=0;dx<2;dx++) {
      const idx=((row%128*2+dy)*256+col%128*2+dx)*2;
      lo=Math.min(lo,child[idx]); hi=Math.max(hi,child[idx+1]);missing ||= child[idx]===65535;
    }
    const i=(row*256+col)*2;
    assert.equal(parent[i],missing?65535:lo);
    assert.equal(parent[i+1],missing?65535:hi);
  }
}
console.log(`Verified ${m.tileCount} tiles, ${valid} valid detailed pixels, all hashes and complete min/max pyramid.`);
