import {readFile,realpath,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {musicProductionCandidate,productionRoot} from './build-music-production-candidate.mjs';
import {PRODUCTION_MOBILE_PROFILE,PRODUCTION_BINDING_MARKER_KEY,validateProductionBindingManifest} from '../src/mobile/environment.js';

const requireCondition=(condition,code)=>{if(!condition)throw new Error(code);};
export const closedMobileVariables=Object.freeze({
  MOBILE_ENVIRONMENT:'production', MOBILE_PRODUCTION_PROFILE:PRODUCTION_MOBILE_PROFILE.id,
  MOBILE_AUTH_ENABLED:'false', MOBILE_MUSIC_ENABLED:'false', MOBILE_PERSONAL_SYNC_ENABLED:'false',
  MOBILE_FREE_OFFLINE_ENABLED:'false', MOBILE_ACCOUNT_DELETION_ENABLED:'false',
  MOBILE_AUTH_ORIGIN:'', MOBILE_REDIRECT_URI:'', MOBILE_RESULT_KEY_VERSION:''
});

function reviewedManifest(manifest) {
  try {return validateProductionBindingManifest(manifest);}
  catch {throw new Error('MOBILE_PRODUCTION_BINDING_MANIFEST');}
}

export function mobileProductionCandidate(source,resources,manifest,root=productionRoot) {
  const checked=reviewedManifest(manifest),config=musicProductionCandidate(source,resources,root);
  requireCondition(resources.account_id===checked.accountId &&
    resources.d1_databases[0].database_id===checked.catalog.id && resources.r2_buckets[0].bucket_name===checked.audio.name &&
    config.d1_databases.find(db=>db.binding==='WAITLIST_DB')?.database_id===checked.reader.id,'MOBILE_PRODUCTION_RESOURCE_MISMATCH');
  Object.assign(config.vars,closedMobileVariables,{MOBILE_BINDING_MANIFEST_JSON:JSON.stringify(checked)});
  return config;
}

export function assertMobileProductionCandidate(candidate,source,resources,manifest,root=productionRoot) {
  requireCondition(isDeepStrictEqual(candidate,mobileProductionCandidate(source,resources,manifest,root)),'MOBILE_PRODUCTION_CANDIDATE_CHANGED');
  return candidate;
}

// Generates review material only. These nonces are binding labels, not credentials.
// No upload, database connection, key creation, or migration is performed here.
// Markers detect a wrong binding; they are NOT Cloudflare ownership evidence.
export function productionBindingMarkerMaterials(manifest) {
  const checked=reviewedManifest(manifest);
  const row=(kind,id,nonce)=>({profile_id:checked.profileId,account_id:checked.accountId,resource_kind:kind,resource_id:id,binding_nonce:nonce});
  const insert=metadata=>'INSERT INTO station_native_binding_identity (singleton,profile_id,account_id,resource_kind,resource_id,binding_nonce) VALUES (1,'+
    Object.values(metadata).map(value=>"'"+value+"'").join(',')+');\n';
  return {
    warning:'CANDIDATE ONLY. Requires separate resource ownership review. Never import synthetic test markers into production.',
    readerSql:insert(row('reader',checked.reader.id,checked.reader.nonce)),
    catalogSql:insert(row('catalog',checked.catalog.id,checked.catalog.nonce)),
    audio:{key:PRODUCTION_BINDING_MARKER_KEY,body:'station-native-production-v1\n',customMetadata:row('audio',checked.audio.name,checked.audio.nonce)}
  };
}

export async function writeMobileProductionCandidate(resourcesPath,bindingsPath,outputPath) {
  const root=await realpath(productionRoot),resourceFile=await realpath(resourcesPath),bindingsFile=await realpath(bindingsPath);
  const output=path.resolve(outputPath),parent=await realpath(path.dirname(output));
  const outside=value=>{const relative=path.relative(root,value);return relative==='..'||relative.startsWith('..'+path.sep);};
  requireCondition([resourceFile,bindingsFile,parent].every(outside),'MOBILE_PRODUCTION_PRIVATE_PATH_REQUIRED');
  const source=await readFile(path.join(root,'wrangler.toml'),'utf8');
  let resources,manifest;
  try {resources=JSON.parse(await readFile(resourceFile,'utf8'));manifest=JSON.parse(await readFile(bindingsFile,'utf8'));}
  catch {throw new Error('MOBILE_PRODUCTION_RESOURCE_READ');}
  const candidate=mobileProductionCandidate(source,resources,manifest,root);
  const file=await open(path.join(parent,path.basename(output)),'wx',0o600);
  try {await file.writeFile(JSON.stringify(candidate,null,2)+'\n');} finally {await file.close();}
  return candidate;
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);
    requireCondition(args.length===6 && args[0]==='--resources' && args[2]==='--bindings' && args[4]==='--output','MOBILE_PRODUCTION_ARGUMENTS');
    await writeMobileProductionCandidate(args[1],args[3],args[5]);
    console.log('Prepared closed native candidate. No remote operation or production marker provisioning performed.');
  } catch(error) {
    const safe=/^(?:MOBILE|MUSIC)_PRODUCTION_[A-Z_]+$/.test(error?.message||'')?error.message:'MOBILE_PRODUCTION_PREPARATION_FAILED';
    console.error(safe);process.exitCode=1;
  }
}
