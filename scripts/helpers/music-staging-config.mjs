import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export const musicStagingFlags = ['MUSIC_PUBLIC_ENABLED', 'MUSIC_UPLOADS_ENABLED',
  'MUSIC_VIP_DELIVERY_ENABLED', 'MUSIC_ANALYTICS_ENABLED', 'MUSIC_CLEANUP_ENABLED'];
const exact = (value, expected, label) => assert.ok(isDeepStrictEqual(value, expected), `Unexpected staging ${label}.`);

// Operator-side source config guard. No remote calls or automatic provisioning.
export function assertMusicStagingConfig(config) {
  const allowed = ['name', 'account_id', 'main', 'compatibility_date', 'compatibility_flags',
    'workers_dev', 'preview_urls', 'routes', 'observability', 'vars', 'assets', 'd1_databases', 'r2_buckets'];
  assert.ok(config && typeof config === 'object' && !Array.isArray(config), 'Invalid staging config.');
  assert.ok(Object.keys(config).every(key => allowed.includes(key)), 'Unexpected staging config field.');
  exact(config.name, 'station-cat-music-staging', 'Worker');
  exact(config.account_id, '3f5394e0ef5a531c63c0ceaa74262e0d', 'account');
  exact(config.main, '../src/music/stagingEntrypoint.js', 'entrypoint');
  exact(config.workers_dev, false, 'workers.dev');
  exact(config.preview_urls, false, 'preview URLs');
  exact(config.routes, [{ pattern:'music-staging.wwwstationcat.org', custom_domain:true }], 'routes');
  exact(config.compatibility_flags, ['nodejs_compat'], 'compatibility flags');
  assert.match(config.compatibility_date || '', /^\d{4}-\d{2}-\d{2}$/);
  exact(config.assets, { directory:'../.generated/music-staging-assets', binding:'ASSETS',
    not_found_handling:'none', run_worker_first:true }, 'assets');
  exact(config.d1_databases, [
    { binding:'MUSIC_DB', database_name:'station-cat-music-staging', database_id:'8fe1a3e1-7325-4d87-a7e6-2c51338b9158', migrations_dir:'../migrations-music' },
    { binding:'MUSIC_STAGING_MEMBERSHIP_DB', database_name:'station-cat-music-staging-identities', database_id:'cb7bbad3-bfbb-457d-b2f2-6fd3b02df651', migrations_dir:'./migrations-music-staging-identities' }
  ], 'databases');
  exact(config.r2_buckets, [{ binding:'MUSIC_BUCKET', bucket_name:'station-cat-music-staging-private' }], 'bucket');
  exact(config.observability, { enabled:true, head_sampling_rate:1, redact_query_string:true }, 'observability');
  const vars=config.vars;
  assert.ok(vars && typeof vars==='object' && !Array.isArray(vars), 'Invalid staging vars.');
  const access = {
    ADMIN_ALLOWED_EMAILS:'brodstem@protonmail.com',
    CF_ACCESS_TEAM_DOMAIN:'misty-limit-82d5.cloudflareaccess.com',
    CF_ACCESS_AUD:'5ceda63da88e8ffb34a88338231028e473379ae51755ae3f6d69be218bb63e4a',
    MUSIC_STAGING_EXPECTED_HOST:'music-staging.wwwstationcat.org'
  };
  assert.ok(Object.keys(vars).every(key => musicStagingFlags.includes(key) || Object.hasOwn(access,key)), 'Unexpected staging variable; secrets must stay remote.');
  for(const [key,value] of Object.entries(access)) exact(vars[key],value,'Access boundary');
  for(const flag of musicStagingFlags) assert.ok(['true','false'].includes(vars[flag]), `Invalid staging flag ${flag}.`);
  return config;
}
