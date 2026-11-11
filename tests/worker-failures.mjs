import {Worker} from 'node:worker_threads';
import {readdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const file=readdirSync('dist-comparison/assets').find(f=>f.startsWith('elevation.worker-'));
const url=pathToFileURL(`${process.cwd()}/dist-comparison/assets/${file}`).href;
async function run(mode) {
 const worker=new Worker(`
 const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;
 let cancelled=false,read=false;
 globalThis.postMessage=m=>parentPort.postMessage({...m,cancelled,read});
 globalThis.fetch=async (url,options)=>{
  if(url.includes('/api/stac/')){
   if(${JSON.stringify(mode)}==='catalogue')return new Response('',{status:503});
   return Response.json({assets:{'swissaltiregio_2056_5728.tif':{href:'https://data.geo.admin.ch/test.tif'}}});
  }
  if(${JSON.stringify(mode)}==='abort')return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true});parentPort.postMessage({waiting:true});});
  if(${JSON.stringify(mode)}==='full-file')return {status:200,body:{cancel:async()=>{cancelled=true}},arrayBuffer:async()=>{read=true;throw Error('Must not read a full file')}};
  return new Response(new Uint8Array(64),{status:206});
 };
 import(${JSON.stringify(url)}).then(()=>parentPort.on('message',data=>globalThis.onmessage({data})));
 `,{eval:true});
 try {return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error(`${mode} timed out`)),10000);
  worker.on('error',reject);worker.on('message',m=>{if(m.waiting){worker.postMessage({cancel:true});return;}clearTimeout(timer);resolve(m);});worker.postMessage({id:1,z:8,x:133,y:90});
 });} finally {await worker.terminate();}
}
for(const mode of ['catalogue','full-file','corrupt','abort']) {
 const result=await run(mode);assert(result.error,`${mode} must report failure`);assert.equal(result.data,undefined,'Failure must never produce clear elevations');
 if(mode==='full-file'){assert(result.cancelled);assert.equal(result.read,false);}
 console.log(`${mode}: explicit failure confirmed`);
}
