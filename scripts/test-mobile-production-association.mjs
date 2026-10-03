import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'smol-toml';
import {productionAssociation, productionAssociationPath} from '../src/mobile/productionAssociation.js';
import isolatedWorker from '../src/mobile/isolatedWorker.js';
import {PRODUCTION_MOBILE_PROFILE, PRODUCTION_ACCOUNT_ID, PRODUCTION_READER_DATABASE_ID,
  PRODUCTION_MUSIC_BUCKET, PRODUCTION_BINDING_MARKER_KEY} from '../src/mobile/environment.js';
import {musicShareUrl} from '../src/music/navigation.js';

const origin = 'https://wwwstationcat.org';
const linkCases = JSON.parse(await readFile(new URL('../tests/fixtures/mobile-links/canonical-link-cases.json', import.meta.url), 'utf8'));
const r2Config = JSON.parse(await readFile(new URL('../wrangler.mobile-r2.jsonc', import.meta.url), 'utf8'));
const r2Origin = linkCases.origins.r2;
const noBindings = new Proxy({}, {get: (_target, key) => {
  if (['WAITLIST_DB', 'MUSIC_DB', 'MUSIC_BUCKET'].includes(key)) throw new Error('Unexpected binding access');
  return undefined;
}});

// Synthetic in-memory marker doubles exercise the existing association gate.
// Real D1/R2 binding verification is covered by test-mobile-production.mjs.
function readyProduction() {
  const nonce = byte => Buffer.alloc(32, byte).toString('base64url');
  const manifest = {profileId:PRODUCTION_MOBILE_PROFILE.id,accountId:PRODUCTION_ACCOUNT_ID,
    reader:{id:PRODUCTION_READER_DATABASE_ID,nonce:nonce(1)},
    catalog:{id:'11111111-1111-4111-8111-111111111111',nonce:nonce(2)},
    audio:{name:PRODUCTION_MUSIC_BUCKET,nonce:nonce(3)}};
  const marker = (kind, id, value) => ({profile_id:manifest.profileId,account_id:manifest.accountId,
    resource_kind:kind,resource_id:id,binding_nonce:value});
  const markers = {reader:marker('reader',manifest.reader.id,manifest.reader.nonce),
    catalog:marker('catalog',manifest.catalog.id,manifest.catalog.nonce),
    audio:marker('audio',manifest.audio.name,manifest.audio.nonce)};
  const reads = {reader:0,catalog:0,audio:0};
  const database = kind => ({withSession(mode) {
    assert.equal(mode,'first-primary');
    return {prepare(sql) {
      assert.match(sql,/^SELECT .* FROM station_native_binding_identity WHERE singleton=1$/);
      return {async first() {reads[kind]++;return markers[kind];}};
    }};
  }});
  return {markers,reads,env:{MOBILE_ENVIRONMENT:'production',MOBILE_PRODUCTION_PROFILE:PRODUCTION_MOBILE_PROFILE.id,
    MOBILE_AUTH_ENABLED:'true',MOBILE_AUTH_ORIGIN:origin,MOBILE_REDIRECT_URI:origin+'/auth/mobile/callback',
    MOBILE_RESULT_KEY_VERSION:'production-v1',MOBILE_RESULT_KEYS_JSON:JSON.stringify({'production-v1':nonce(4)}),
    MOBILE_BINDING_MANIFEST_JSON:JSON.stringify(manifest),WAITLIST_DB:database('reader'),MUSIC_DB:database('catalog'),
    MUSIC_BUCKET:{async head(key) {assert.equal(key,PRODUCTION_BINDING_MARKER_KEY);reads.audio++;return {customMetadata:markers.audio};}}}};
}

test('clean-checkout association stays unavailable and does not disclose identity or redirect', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await productionAssociation(new Request(origin + productionAssociationPath, {method}), noBindings);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('location'), null);
    assert.doesNotMatch(await response.text(), /2AM5S7BM2N|org\.stationcat\.music/);
  }
});

test('association denies alternate hosts, paths, queries and writes before configuration', async () => {
  const unreadable = new Proxy({}, {get: () => { throw new Error('Unexpected configuration read'); }});
  for (const url of [
    'https://stationcat.org' + productionAssociationPath,
    'https://native.example.test' + productionAssociationPath,
    origin + '.' + productionAssociationPath,
    origin + productionAssociationPath + '?preview=1',
    origin + '/music/'
  ]) assert.equal((await productionAssociation(new Request(url), unreadable)).status, 404);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await productionAssociation(new Request(origin + productionAssociationPath, {method}), unreadable);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
});

test('website assets cannot shadow the native browser or association gates', async () => {
  const config = parse(await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'));
  assert.ok(config.assets.run_worker_first.includes('/auth/mobile/*'));
  assert.ok(config.assets.run_worker_first.includes(productionAssociationPath));
  assert.ok(config.assets.run_worker_first.includes('/api/*'));
  assert.notEqual(config.vars.MOBILE_AUTH_ENABLED, 'true');
});

test('production GET/HEAD require current markers once per request and publish only exact routes', async () => {
  const {env,markers,reads} = readyProduction();
  for (const method of ['GET','HEAD']) {
    const response = await productionAssociation(new Request(origin + productionAssociationPath,{method}),env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('location'),null);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('content-type'),'application/json');
    if (method === 'HEAD') assert.equal(await response.text(),'');
    else {
      const doc = await response.json();
      assert.deepEqual(doc.webcredentials.apps,[PRODUCTION_MOBILE_PROFILE.appID]);
      assert.deepEqual(doc.applinks.details,[{appIDs:[PRODUCTION_MOBILE_PROFILE.appID],components:
        [...linkCases.musicPaths.production,'/auth/mobile/callback'].map(path => ({'/':path}))}]);
    }
  }
  assert.deepEqual(reads,{reader:2,catalog:2,audio:2});
  markers.catalog.resource_id = '22222222-2222-4222-8222-222222222222';
  const rejected = await productionAssociation(new Request(origin + productionAssociationPath),env);
  assert.equal(rejected.status,503);
  assert.doesNotMatch(await rejected.text(),/2AM5S7BM2N|org\.stationcat\.music/);
  assert.deepEqual(reads,{reader:3,catalog:3,audio:3});
});

test('R2 association stays scoped to its staging app and two root music paths', async () => {
  const env = r2Config.vars;
  for (const method of ['GET','HEAD']) {
    const response = await isolatedWorker.fetch(new Request(r2Origin + productionAssociationPath,{method}),env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('location'),null);
    assert.equal(response.headers.get('content-type'),'application/json');
    if (method === 'HEAD') assert.equal(await response.text(),'');
    else {
      const doc = await response.json();
      assert.deepEqual(doc.webcredentials.apps,['2AM5S7BM2N.org.stationcat.music.staging']);
      assert.deepEqual(doc.applinks.details,[{appIDs:doc.webcredentials.apps,components:
        [...linkCases.musicPaths.r2,'/auth/mobile/callback'].map(path => ({'/':path}))}]);
    }
  }
  for (const url of [origin + productionAssociationPath, r2Origin + productionAssociationPath + '?preview=1',
    r2Origin + '/.well-known/apple-app-site-association/']) {
    assert.equal((await isolatedWorker.fetch(new Request(url),env)).status,404);
  }
  assert.equal((await isolatedWorker.fetch(new Request(r2Origin + productionAssociationPath,{method:'POST'}),env)).status,404);
  for (const vars of [{},{...env,MOBILE_AUTH_ENABLED:'false'}]) {
    const response = await isolatedWorker.fetch(new Request(r2Origin + productionAssociationPath),vars);
    assert.equal(response.status,503);
    assert.doesNotMatch(await response.text(),/2AM5S7BM2N|org\.stationcat\.music/);
  }
});

test('shared link cases match serialized AASA exact paths, independently of client query validation', async t => {
  assert.equal(linkCases.schemaVersion,1);
  assert.equal(new Set(linkCases.cases.map(c => c.id)).size,linkCases.cases.length);
  const documents = {
    production:await (await productionAssociation(new Request(origin + productionAssociationPath),readyProduction().env)).json(),
    r2:await (await isolatedWorker.fetch(new Request(r2Origin + productionAssociationPath),r2Config.vars)).json()
  };
  for (const doc of Object.values(documents)) {
    assert.equal(doc.applinks.details.length,1);
    for (const component of doc.applinks.details[0].components) {
      assert.deepEqual(Object.keys(component),['/']);
      assert.doesNotMatch(component['/'],/[*?%]/);
    }
  }
  // A deliberately limited, literal-path model of Apple's documented defaults:
  // case-sensitive, percent-encoded path, unspecified query/fragment unrestricted.
  // This does not emulate OS entitlement lookup, CDN state or app delivery.
  for (const c of linkCases.cases) await t.test(c.id, () => {
    const url = new URL(c.url);
    const matched = url.origin === linkCases.origins[c.environment] &&
      documents[c.environment].applinks.details[0].components.some(component => component['/'] === url.pathname);
    assert.equal(matched,c.aasaExpected,c.reason);
  });
});

test('canonical track and album cases are generated by the actual website share helper in all four locales', () => {
  const canonical = linkCases.cases.filter(c => c.canonicalShareLocale);
  assert.equal(canonical.length,8);
  for (const c of canonical) {
    assert.equal(c.environment,'production');
    assert.equal(c.aasaExpected,true);
    assert.equal(musicShareUrl(origin,c.canonicalShareLocale,{[c.client.kind]:c.client.value}),c.url);
  }
});
