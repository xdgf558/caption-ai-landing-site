import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'smol-toml';
import { createStationRouteRuntime } from './helpers/station-route-runtime.mjs';
import { migrationServicePath, legacyFamily, migrationPath, routeParts } from '../src/redesign/routeMigrationPaths.js';
import { stationHref } from '../src/redesign/routes.js';
import { inspectMigrationRouting } from '../src/redesign/routeMigrationProfile.js';
import { assessRouteProposal } from '../src/redesign/legacyRouteStore.js';
const root = new URL('../',import.meta.url), out = resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'.generated/station-route-audit');
await mkdir(out,{recursive:true});
const csv = await readFile(new URL('docs/station-cat-redesign/T02-route-inventory.csv',root),'utf8');
function csvRows(source) {
  const rows=[], row=[];let cell='',quoted=false;
  for(let i=0;i<source.length;i++) {
    const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&c===','){row.push(cell);cell='';}
    else if(!quoted&&c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row.splice(0));cell='';}
    else cell+=c;
  }
  if(cell||row.length){row.push(cell);rows.push(row);}if(quoted)throw new Error('Malformed source CSV');
  const headings=rows.shift();return rows.map(values=>Object.fromEntries(headings.map((name,i)=>[name,values[i]])));
}
const inventory=csvRows(csv), config=parse(await readFile(new URL('wrangler.toml',root),'utf8'));
const profile = { production:false, configurationChanged:false, primaryRouting:inspectMigrationRouting(config.assets.run_worker_first),
  isolatedRouting:inspectMigrationRouting(true), localFlagsOnly:true, productionBindingsAndSchemaVerified:false, nativeAssetsRouter:true,
  sourceInventoryRows:inventory.length, csvSha256:createHash('sha256').update(csv).digest('hex') };
const runtime=await createStationRouteRuntime();
try {
  // This fixture-only recovery/reference export happens before the first HTTP
  // experiment. The production store is never opened or exported by this tool.
  await writeFile(join(out,'fixture-reference-backup.json'),JSON.stringify(runtime.references,null,2)+'\n');
  const source = { baseline:'062ee92416f391099711bf397c9d15cedd7d8ef9', gitIsRecoverySource:true,
    codeFilesRemoved:false, productionBackupPerformed:false, productionPhysicalCleanup:false };
  await writeFile(join(out,'recovery-boundary.json'),JSON.stringify(source,null,2)+'\n');
  let ip=1;const observations=new Map();
  const get=async (path,mode) => {
    const response=await runtime.mf.dispatchFetch('http://127.0.0.1'+path,{redirect:'manual',headers:{'CF-Connecting-IP':'192.0.'+Math.floor(ip/250)+'.'+(ip++%250+1),...(mode?{'x-sc-fixture-mode':mode}:{})}});
    const record={method:'GET',status:response.status,location:response.headers.get('Location'),cacheControl:response.headers.get('Cache-Control'),robots:response.headers.get('X-Robots-Tag')};
    const hash=createHash('sha256'), reader=response.body?.getReader();let bytes=0,complete=true;
    if(reader) try {
      while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;
        if(bytes>2*1024*1024){complete=false;await reader.cancel();break;}hash.update(next.value);}
    } finally {reader.releaseLock();}
    Object.assign(record,{bodyBytes:bytes,bodyComplete:complete,bodySha256:complete?hash.digest('hex'):null});
    return record;
  };
  const records=[];
  for(const row of inventory) {
    const literal=row.old_path.startsWith('/')&&!/[:{}*^$\\?]/.test(row.old_path);
    const record={id:row.record_id,path:row.old_path,sourceAction:row.proposed_action,sourceMethodHint:row.methods,
      productionVerified:false,methodsAndPermissionContractVerified:false};
    if(!literal) {record.verification='source-template-or-matcher';record.requiresInstantiation=true;records.push(record);continue;}
    if(!observations.has(row.old_path)) observations.set(row.old_path,{closed:await get(row.old_path,'closed'),candidate:await get(row.old_path)});
    Object.assign(record,observations.get(row.old_path));
    const path=migrationPath(row.old_path), family=path&&legacyFamily(path), service=path&&migrationServicePath(path);
    const location = value => { if (value === null) return null; const url = new URL(value,'http://127.0.0.1'); return url.origin==='http://127.0.0.1'?url.pathname+url.search+url.hash:url.href; };
    if(service) {
      const same=record.closed.status===record.candidate.status&&location(record.closed.location)===location(record.candidate.location);
      const parts=routeParts(path), memberAlias=parts.segments.length===1&&parts.segments[0]==='library'&&
        record.candidate.status===301&&location(record.candidate.location)===stationHref(parts.locale,'member');
      record.verification=same?(record.candidate.status>=500?'unchanged-fixture-unavailable':'original-handler-status-retained'):
        memberAlias?'existing-member-page-canonicalization':'service-status-difference';
    }
    else if(family) record.verification=[301,404,410,503].includes(record.candidate.status)?'isolated-exit-status-observed':'unexpected-public-response';
    else record.verification='isolated-response-observed';
    records.push(record);
  }
  const proposals=runtime.references.routeProposals.map(row=>({oldPath:row.old_path,action:row.action,assessment:assessRouteProposal(row),executable:false}));
  const counts=key=>Object.fromEntries([...new Set(records.map(row=>row[key]))].map(value=>[value,records.filter(row=>row[key]===value).length]));
  const report={...profile,createdAt:new Date().toISOString(),uniqueLiteralRequests:observations.size,
    rowCounts:{sourceActions:counts('sourceAction'),verification:counts('verification')},proposals,records,
    limits:['GET observations are not a method/permission contract','Templates and matchers require separately instantiated HTTP cases',
      'Dynamic production slugs, external links, official native clients and production D1/R2 remain unverified',
      'Empty-body Astro build is not a production package','Primary Assets routing is insufficient for activation; T22 must satisfy the contract'],
  };
  await writeFile(join(out,'route-http-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output:out,rows:records.length,uniqueLiteralRequests:observations.size,counts:report.rowCounts,primaryRoutingReady:profile.primaryRouting.satisfied}));
  if(records.some(row=>['service-status-difference','unexpected-public-response'].includes(row.verification))) throw new Error('Review the isolated address differences');
} finally {await runtime.close();}
