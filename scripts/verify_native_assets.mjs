// Reconstruct each page's expected square list from the pinned catalogue.
// A missing file or dictionary entry is a release error, including at borders.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

export function verifyNative(root,bounds,inventory,manifest=resolve(root,'src/terrain/native-index/release.json')) {
  const index=JSON.parse(readFileSync(manifest));
  const hash=body=>createHash('sha256').update(body).digest('hex');
  if (index.version!==1 || index.source!==hash(inventory) || String(index.bounds)!==String(bounds)) {
    throw Error('Native release bounds or inventory mismatch');
  }
  const squares=new Set(JSON.parse(gunzipSync(inventory)).map(([x,y])=>x+'/'+y));
  const verified=new Map(), coords=new Map();
  let bytes=0;
  function checked(kind,ref,suffix) {
    const [digest,size]=ref;
    if (!/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid native hash');
    const file=resolve(root,'static/terrain/native',kind,digest.slice(0,2),digest+suffix);
    const body=readFileSync(file);
    if(body.length!==size || hash(body)!==digest) throw Error('Native checksum mismatch '+file);
    bytes+=size;
    return body;
  }
  const [left,top,right,bottom]=bounds;
  if(Object.keys(index.pages).length!==(right-left+1)*(bottom-top+1)) throw Error('Incomplete native page index');
  for(let x=left;x<=right;x++) for(let y=top;y<=bottom;y++) {
    const page=JSON.parse(checked('pages',index.pages[x+'/'+y],'.json'));
    if(page.x!==x || page.y!==y || page.controls.length!==81 ||
       page.controls.some(p=>p.length!==2 || !p.every(Number.isFinite))) throw Error('Invalid placement page');
    const east=page.controls.map(p=>p[0]),north=page.controls.map(p=>p[1]);
    let expected=0;
    for(let sx=Math.floor(Math.min(...east)/1000)-1;sx<=Math.floor(Math.max(...east)/1000)+1;sx++) {
      for(let sy=Math.floor(Math.min(...north)/1000)-1;sy<=Math.floor(Math.max(...north)/1000)+1;sy++) {
        const key=sx+'/'+sy;
        if(!squares.has(key)) continue;
        expected++;
        const ref=page.blocks[key];
        if(!ref || (coords.has(key) && coords.get(key)!==ref[0])) throw Error('Missing or inconsistent square '+key);
        coords.set(key,ref[0]);
        if(verified.has(ref[0])) {
          if(verified.get(ref[0])!==ref[1]) throw Error('Inconsistent square length');
          continue;
        }
        const raw=gunzipSync(checked('blocks',ref,'.band'),{maxOutputLength:125000});
        if(raw.length!==125000) throw Error('Invalid native grid length');
        for(let i=0;i<raw.length;i+=2) {
          const band=raw.readInt16LE(i);
          if(band!==-32768 && (band< -50 || band>999)) throw Error('Invalid native band');
        }
        verified.set(ref[0],ref[1]);
      }
    }
    if(Object.keys(page.blocks).length!==expected) throw Error('Unexpected native square');
  }
  if(coords.size!==index.blocks) throw Error('Wrong native square count');
  return {files:Object.keys(index.pages).length+verified.size,bytes};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [root,manifest]=process.argv.slice(2);
  const inventory=readFileSync(resolve(root,'scripts/national/detail-sources.json.gz'));
  console.log('Verified native release',verifyNative(root,[2115,1426,2167,1460],inventory,manifest));
}
