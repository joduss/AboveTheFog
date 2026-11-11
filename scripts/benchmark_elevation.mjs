// Read-only live-source investigation. Runs current worker logic in Node, not a
// browser/device benchmark. No application cache, renderer or preview is involved.
// Usage: node scripts/benchmark_elevation.mjs [workerCount=2] [side=3] [source-cache]
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import ts from 'typescript';

const count = Number(process.argv[2] ?? 2), side = Number(process.argv[3] ?? 3);
if (![count, side].every(n => Number.isInteger(n) && n > 0 && n <= 4)) throw Error('Arguments must be integers from 1 to 4');
const moduleURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = source => ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
let source = readFileSync(new URL('../src/terrain/elevation.worker.ts', import.meta.url), 'utf8');
const replace = (a, b) => {if (!source.includes(a)) throw Error(`Instrumentation anchor missing: ${a}`); source = source.replace(a,b);};
const profile = process.argv[4] ?? 'baseline';
if (!['baseline', 'source-cache'].includes(profile)) throw Error('Unknown profile');
if (profile === 'source-cache') {
  replace('cacheSize: overviews ? 32 : 1', 'cacheSize: overviews ? 32 : 2');
  replace('while (readers.size > 12)', 'while (readers.size > 16)');
}
replace("from 'geotiff'", `from '${import.meta.resolve('geotiff')}'`);
replace("from 'proj4'", `from '${import.meta.resolve('proj4')}'`);
replace("from './math'", `from '${moduleURL(compile(readFileSync(new URL('../src/terrain/math.ts', import.meta.url), 'utf8')))}'`);
replace('const extent = tileExtent(z, x, y)', 'const coordinateStart = performance.now(); const extent = tileExtent(z, x, y)');
replace('const output = missingTile();', 'stats.coordinatesMs = performance.now() - coordinateStart; const output = missingTile();');
replace('const selected = await discover(bounds, `${z}/${x}/${y}`);', 'const discoveryStart = performance.now(); const selected = await discover(bounds, `${z}/${x}/${y}`); stats.discoveryMs = performance.now() - discoveryStart;');
replace('let values = completeSource ?', 'const readStart = performance.now(); let values = completeSource ?');
replace('for (const [index, x, y] of pixels)', 'stats.readMs += performance.now() - readStart; for (const [index, x, y] of pixels)');
replace('try {await sample(await open(asset.url, false), 0, indices, coords, output);}', 'try {const openStart = performance.now(); const raster = await open(asset.url, false); stats.openMs += performance.now()-openStart; await sample(raster, 0, indices, coords, output);}');
replace('transferred = 0;\n  try', 'transferred = 0; stats = {coordinatesMs: 0, discoveryMs: 0, openMs: 0, readMs: 0, requests: []};\n  try');
replace('bytes: transferred}, {transfer:', 'bytes: transferred, stats}, {transfer:');
source = `let stats; const originalFetch = globalThis.fetch; globalThis.fetch = async (url, options) => {
  const start = performance.now(), response = await originalFetch(url,options);
  stats.requests.push({url: String(url), range: new Headers(options?.headers).get('range'), headerMs: performance.now()-start});
  return response;
};\n` + source;
const workerURL = moduleURL(compile(source));
const workers = Array.from({length: count}, () => new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=m=>parentPort.postMessage(m);import(${JSON.stringify(workerURL)}).then(()=>parentPort.on('message',data=>globalThis.onmessage({data})));`, {eval:true,workerData:{}}));
const x = Math.floor((7.1619+180)/360*2**15), y = Math.floor((1-Math.asinh(Math.tan(46.8065*Math.PI/180))/Math.PI)/2*2**15);
const jobs = Array.from({length: side*side}, (_,i) => ({z:15,x:x+i%side-Math.floor(side/2),y:y+Math.floor(i/side)-Math.floor(side/2)}));
let id = 0;
async function run(label) {
  let next=0; const results=[], start=performance.now();
  await Promise.all(workers.map(async worker => {
    while (next<jobs.length) {
      const job=jobs[next++], tileStart=performance.now();
      const result=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Benchmark tile timed out')),65000);
        const error=e=>{clearTimeout(timer);worker.off('message',message);reject(e);};
        const message=m=>{clearTimeout(timer);worker.off('error',error);m.error?reject(Error(m.error)):resolve(m);};
        worker.once('error',error);worker.once('message',message);worker.postMessage({id:++id,...job});
      });
      results.push({...job,ms:performance.now()-tileStart,bytes:result.bytes,missing:result.missing,failures:result.failures,...result.stats});
    }
  }));
  const requests=results.flatMap(r=>r.requests), ranges=requests.filter(r=>r.range), unique=new Set(ranges.map(r=>`${r.url}/${r.range}`));
  const sum = field => Math.round(results.reduce((n,r)=>n+r[field],0));
  console.log(JSON.stringify({label,profile,workers:count,tiles:jobs.length,wallMs:Math.round(performance.now()-start),firstTileMs:Math.round(Math.min(...results.slice(0,count).map(r=>r.ms))),bytes:sum('bytes'),catalogueRequests:requests.length-ranges.length,rangeRequests:ranges.length,repeatedIdenticalRanges:ranges.length-unique.size,sourceFiles:new Set(ranges.map(r=>r.url)).size,stageSumMs:{coordinates:sum('coordinatesMs'),discovery:sum('discoveryMs'),open:sum('openMs'),read:sum('readMs')},tilesWithFailures:results.filter(r=>r.failures||r.missing).length,tilesDetail:results.map(({requests,...r})=>r)},null,2));
}
try {await run('cold worker caches');await run('repeat same tiles / worker source caches only');}
finally {await Promise.all(workers.map(w=>w.terminate()));}
