// Runs the production browser worker with Node's worker transport. This verifies
// real raster processing, not browser rendering/CORS or phone performance.
import {Worker} from 'node:worker_threads';
import {readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const file = readdirSync('dist-comparison/assets').find(f=>f.startsWith('elevation.worker-'));
const url = pathToFileURL(`${process.cwd()}/dist-comparison/assets/${file}`).href;
const worker = new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=(m)=>parentPort.postMessage(m);import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>globalThis.onmessage({data})));`,{eval:true});
let id=0;
function tile(lon,lat,z) {
 const x=Math.floor((lon+180)/360*2**z),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z);
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker timed out')),65000);worker.once('error',reject);worker.once('message',m=>{clearTimeout(timer);m.error?reject(Error(m.error)):resolve(m)});worker.postMessage({id:++id,z,x,y});});
}
try {
 for(const [name,lon,lat,z] of [['National',8.23,46.8,8],['Fribourg',7.1619,46.8065,15],['Geneva',6.1432,46.2044,15],['Zurich',8.5417,47.3769,15],['Lugano',8.9511,46.0037,15],['St. Moritz',9.8397,46.4908,15]]) {
  const start=performance.now(),r=await tile(lon,lat,z);assert.equal(r.data.length,65536);assert.equal(r.failures,0);assert(r.missing<65536,`${name} must have real elevations`);assert(r.bytes<16*1024*1024,'Bounded downloads');console.log(JSON.stringify({name,ms:Math.round(performance.now()-start),spacing:r.spacing,missing:r.missing,bytes:r.bytes,min:Math.min(...r.data.filter(v=>v!==-99999)),max:Math.max(...r.data)}));
 }
} finally {await worker.terminate();}
