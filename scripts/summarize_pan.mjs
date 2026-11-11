// Summarize one benchmark JSONL without mixing route, build or cache state.
import {readFileSync} from 'node:fs';
const groups = new Map();
for (const line of readFileSync(process.argv[2],'utf8').trim().split('\n')) {
  if (!line) continue;
  const row = JSON.parse(line);
  const key = JSON.stringify([row.build,row.dataset,row.place,row.zoom,row.state]);
  if (!groups.has(key)) groups.set(key,[]);
  groups.get(key).push(row);
}
function distribution(values) {
  const valid = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!valid.length) return {measured:0,missing:values.length};
  const at = q => valid[Math.ceil(q*valid.length)-1];
  return {measured:valid.length,missing:values.length-valid.length,
    median:at(.5),p95:at(.95),max:valid.at(-1)};
}
const summary = [...groups].map(([key,rows]) => {
  const [build,dataset,place,zoom,state]=JSON.parse(key);
  const byRun = new Map();
  for (const row of rows) {
    const run=row.run ?? 1;
    if (!byRun.has(run)) byRun.set(run,[]);
    byRun.get(run).push(row);
  }
  const runs=[...byRun.values()];
  const metrics={};
  for (const metric of ['fineFogMs','firstFullResolutionImageryMs','combinedMs','stripReadyMs',
    'viewportReadyMs','settledAfterReleaseMs','frameP95Ms','trackedBytes','textureBytes']) {
    metrics[metric]=distribution(rows.map(r=>r.edgeTiming[metric]));
  }
  return {build,dataset,place,zoom,state,repetitions:runs.length,observations:rows.length,
    sourceRequests:Math.max(...rows.map(r=>r.sourceRequests)),metrics,
    routeTransferBytes:distribution(runs.map(run=>run.reduce((n,r)=>n+r.edgeTiming.transferBytes,0))),
    worstFineEdgePerRouteMs:distribution(runs.map(run=>run.every(r=>Number.isFinite(r.edgeTiming.fineFogMs)) ?
      Math.max(...run.map(r=>r.edgeTiming.fineFogMs)) : null)),
    directCombinedMs:state==='decoded-revisit' ? null : distribution(runs.map(run=>run[0].direct?.firstCombinedMs))};
});
console.log(JSON.stringify(summary,null,2));
