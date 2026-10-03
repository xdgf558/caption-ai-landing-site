import {MobileError, requireValue} from './errors.js';

export const PRODUCTION_MOBILE_PROFILE = Object.freeze({
  id:'station-native-production-v1', origin:'https://wwwstationcat.org',
  redirect:'https://wwwstationcat.org/auth/mobile/callback', appID:'2AM5S7BM2N.org.stationcat.music'
});
export const PRODUCTION_ACCOUNT_ID = '3f5394e0ef5a531c63c0ceaa74262e0d';
export const PRODUCTION_READER_DATABASE_ID = 'c4a8cb1a-6a94-4e8f-a6fb-a734afafca63';
export const PRODUCTION_MUSIC_BUCKET = 'station-cat-music-production-private';
export const NONPRODUCTION_DATABASE_IDS = Object.freeze([
  '8fe1a3e1-7325-4d87-a7e6-2c51338b9158', 'cb7bbad3-bfbb-457d-b2f2-6fd3b02df651',
  '254cd4bd-49e3-4459-8d68-5c9995e8465f', '19595ea0-7359-4ab3-b168-d82247edefa5'
]);
export const PRODUCTION_BINDING_MARKER_KEY = '_station/native-production-binding-v1';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const unavailable = condition => requireValue(condition,'SERVICE_UNAVAILABLE',503);
const nonce = value => typeof value === 'string' && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

// A deployment manifest detects accidental cross-environment bindings. It does
// not establish Cloudflare ownership: that requires separately reviewed inventory.
export function validateProductionBindingManifest(manifest) {
  unavailable(exact(manifest,['profileId','accountId','reader','catalog','audio']));
  unavailable(manifest.profileId===PRODUCTION_MOBILE_PROFILE.id && manifest.accountId===PRODUCTION_ACCOUNT_ID);
  unavailable(exact(manifest.reader,['id','nonce']) && exact(manifest.catalog,['id','nonce']) && exact(manifest.audio,['name','nonce']));
  unavailable(manifest.reader.id===PRODUCTION_READER_DATABASE_ID && uuid(manifest.catalog.id) &&
    manifest.catalog.id!==PRODUCTION_READER_DATABASE_ID && !NONPRODUCTION_DATABASE_IDS.includes(manifest.catalog.id));
  unavailable(manifest.audio.name===PRODUCTION_MUSIC_BUCKET);
  const nonces=[manifest.reader.nonce,manifest.catalog.nonce,manifest.audio.nonce];
  unavailable(nonces.every(nonce) && new Set(nonces).size===3);
  return manifest;
}

export function mobileEnvironmentProfile(env) {
  unavailable(env.MOBILE_AUTH_ENABLED==='true');
  try {
    if(env.MOBILE_ENVIRONMENT==='production') {
      unavailable(env.MOBILE_PRODUCTION_PROFILE===PRODUCTION_MOBILE_PROFILE.id &&
        env.MOBILE_AUTH_ORIGIN===PRODUCTION_MOBILE_PROFILE.origin && env.MOBILE_REDIRECT_URI===PRODUCTION_MOBILE_PROFILE.redirect);
      const manifest=validateProductionBindingManifest(JSON.parse(env.MOBILE_BINDING_MANIFEST_JSON || 'null'));
      return {environment:'production',origin:PRODUCTION_MOBILE_PROFILE.origin,redirect:PRODUCTION_MOBILE_PROFILE.redirect,manifest};
    }
    unavailable(env.MOBILE_ENVIRONMENT==='isolated');
    const origin=new URL(env.MOBILE_AUTH_ORIGIN);
    // DNS names are case-insensitive and a final dot denotes the same host.
    // Normalize for the reserved-host check without accepting a noncanonical origin.
    const hostname=origin.hostname.toLowerCase().replace(/\.+$/,'');
    unavailable(origin.protocol==='https:' && origin.origin===env.MOBILE_AUTH_ORIGIN && !origin.username && !origin.password &&
      !['wwwstationcat.org','stationcat.org'].includes(hostname));
    unavailable(env.MOBILE_REDIRECT_URI===origin.origin+'/auth/mobile/callback');
    return {environment:'isolated',origin:origin.origin,redirect:env.MOBILE_REDIRECT_URI};
  } catch(error) {
    if(error instanceof MobileError)throw error;
    throw new MobileError('SERVICE_UNAVAILABLE',503);
  }
}
export function mobileAuthenticationEnabled(env, config) {
  // Internal isolated feature projections keep their existing flag-only contract;
  // request entrypoints still validate the full origin/key configuration first.
  if(!config && env.MOBILE_ENVIRONMENT==='isolated')return env.MOBILE_AUTH_ENABLED==='true';
  try {return env.MOBILE_AUTH_ENABLED==='true' && !!(config || mobileEnvironmentProfile(env));} catch {return false;}
}
// No production deletion executor/retention policy is approved. A variable
// cannot enable mutations or receipt lookup that could freeze a real account.
export const mobileAccountDeletionEnabled = (_env,config) => config.environment==='isolated';

export async function verifyMobileBindings(env, config) {
  try {
    const reader=env.WAITLIST_DB;
    unavailable(reader && typeof reader.withSession==='function');
    const readerDb=reader.withSession('first-primary');
    if(config.environment==='isolated')return {readerDb};
    const music=env.MUSIC_DB, bucket=env.MUSIC_BUCKET;
    unavailable(music && music!==reader && typeof music.withSession==='function' && bucket && typeof bucket.head==='function');
    const musicDb=music.withSession('first-primary'), manifest=config.manifest;
    const statement=db=>db.prepare('SELECT profile_id,account_id,resource_kind,resource_id,binding_nonce FROM station_native_binding_identity WHERE singleton=1').first();
    const [readerMarker,catalogMarker,audioMarker]=await Promise.all([
      statement(readerDb),statement(musicDb),bucket.head(PRODUCTION_BINDING_MARKER_KEY)
    ]);
    const matches=(row,kind,resource)=>row && row.profile_id===manifest.profileId && row.account_id===manifest.accountId &&
      row.resource_kind===kind && row.resource_id===resource.id && row.binding_nonce===resource.nonce;
    unavailable(matches(readerMarker,'reader',manifest.reader) && matches(catalogMarker,'catalog',manifest.catalog));
    const metadata=audioMarker?.customMetadata;
    unavailable(metadata && metadata.profile_id===manifest.profileId && metadata.account_id===manifest.accountId &&
      metadata.resource_kind==='audio' && metadata.resource_id===manifest.audio.name && metadata.binding_nonce===manifest.audio.nonce);
    return {readerDb,musicDb,bucket};
  } catch(error) {
    if(error instanceof MobileError)throw error;
    throw new MobileError('SERVICE_UNAVAILABLE',503);
  }
}
