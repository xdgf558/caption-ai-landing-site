import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import test from 'node:test';
import { musicTestDatabase } from './helpers/music-test-database.mjs';
import { fileURLToPath } from 'node:url';
import {
  isMusicStagingRequest,
  musicStagingHost,
  musicStagingNotFound,
  musicStagingReaderRequest,
  musicStagingResponse,
  musicStagingUnavailable
} from '../src/music/stagingGate.js';
import stagingWorker from '../src/music/stagingEntrypoint.js';

const request = (path, method = 'GET') => new Request(`https://music-staging.wwwstationcat.org${path}`, { method });

test('staging cookies cannot inherit a production session, including duplicates', () => {
  for (const [cookie, expected] of [
    ['station_cat_reader_session=production; CF_Authorization=access', null],
    ['station_cat_reader_session=production; station_cat_music_staging_session=test', 'station_cat_reader_session=test'],
    ['station_cat_music_staging_session=; station_cat_music_staging_session=test', 'station_cat_reader_session='],
    ['station_cat_music_staging_session=first; station_cat_music_staging_session=second', 'station_cat_reader_session=first']
  ]) {
    const original = new Request(request('/api/music/me/capabilities?locale=en'), { headers: { Cookie: cookie, Range: 'bytes=0-99' } });
    const mapped = musicStagingReaderRequest(original);
    assert.equal(mapped.headers.get('cookie'), expected);
    assert.equal(mapped.headers.get('range'), 'bytes=0-99');
    assert.equal(original.headers.get('cookie'), cookie);
  }
});

test('Access-protected responses stay private without changing streams, HEAD, 304 or ranges', async () => {
  for (const status of [200, 206, 304]) {
    const wrapped = musicStagingResponse(new Response(status === 304 ? null : 'bytes', { status,
      headers: { 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: '"test"',
        'Content-Range': 'bytes 0-4/10', 'Content-Length': '5', Vary: 'Accept-Encoding' } }));
    assert.equal(wrapped.status, status);
    assert.equal(wrapped.headers.get('cache-control'), 'private, no-store');
    assert.equal(wrapped.headers.get('content-range'), 'bytes 0-4/10');
    assert.equal(wrapped.headers.get('etag'), '"test"');
    assert.equal(wrapped.headers.get('vary'), 'Accept-Encoding, Cookie, Cf-Access-Jwt-Assertion');
    assert.equal(await wrapped.text(), status === 304 ? '' : 'bytes');
  }
  assert.equal(await musicStagingResponse(new Response(null)).text(), '');
});

test('real Access verification precedes all bindings; shared limits precede isolated membership', async t => {
  const config = { MUSIC_STAGING_EXPECTED_HOST: 'music-staging.wwwstationcat.org',
    CF_ACCESS_TEAM_DOMAIN: 'https://staging-test.cloudflareaccess.com', CF_ACCESS_AUD: 'staging-only',
    ADMIN_ALLOWED_EMAILS: 'test@example.test' };
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'staging-test', alg: 'RS256', use: 'sig' };
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, `${config.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    return Response.json({ keys: [jwk] });
  });
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const raw = b64({ alg: 'RS256', kid: jwk.kid }) + '.' + b64({ iss: config.CF_ACCESS_TEAM_DOMAIN,
    aud: config.CF_ACCESS_AUD, exp: Math.floor(Date.now() / 1000) + 300, email: 'test@example.test' });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(raw));
  const jwt = raw + '.' + Buffer.from(signature).toString('base64url');
  let touched = 0;
  const closed = { withSession() { touched++; throw new Error('must not read'); } };
  const env = { ...config, MUSIC_DB: closed, MUSIC_STAGING_MEMBERSHIP_DB: { ...closed },
    MUSIC_BUCKET: { get() { touched++; throw new Error('must not read'); } }, WAITLIST_DB: closed };
  const get = (path, additions = {}, runtime = env) => stagingWorker.fetch(new Request(request(path), {
    headers: { 'Cf-Access-Jwt-Assertion': jwt, 'CF-Connecting-IP': '192.0.2.1', ...additions }
  }), runtime, {});
  for (const path of ['/api/music/catalog?locale=en', '/api/music/tracks/11111111-1111-1111-1111-111111111111/audio?v=1&variant=full']) {
    const denied = await get(path, { 'Cf-Access-Jwt-Assertion': 'forged', Cookie: 'station_cat_music_staging_session=vip' });
    assert.equal(denied.status, 401);
    const disabled = await get(path);
    assert.equal(disabled.status, 503);
    assert.equal((await disabled.json()).error.code, 'MUSIC_PUBLIC_DISABLED');
  }
  assert.equal(touched, 0);
  assert.equal((await get('/api/music/catalog?locale=en', {}, { ...env, MUSIC_STAGING_MEMBERSHIP_DB: undefined })).status, 503);
  assert.equal((await get('/api/music/catalog?locale=en', {}, { ...env, MUSIC_STAGING_MEMBERSHIP_DB: env.MUSIC_DB })).status, 503);

  const music = musicTestDatabase(), identity = musicTestDatabase();
  t.after(() => { music.sql.close(); identity.sql.close(); });
  identity.sql.exec(await readFile(new URL('../ops/migrations-music-staging-identities/0001_test_identities.sql', import.meta.url), 'utf8'));
  const now = Date.now(), start = new Date(now - 10000).toISOString(), end = new Date(now + 60000).toISOString();
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('isolated-vip'))).toString('hex');
  identity.sql.prepare("INSERT INTO reader_accounts VALUES(1,'active')").run();
  identity.sql.prepare('INSERT INTO reader_sessions VALUES(?,1,?,?,NULL)').run(hash, start, end);
  identity.sql.prepare("INSERT INTO reader_memberships VALUES(1,'member',?,?)").run(start, end);
  const active = { ...env, MUSIC_DB: music.db, MUSIC_STAGING_MEMBERSHIP_DB: identity.db,
    MUSIC_PUBLIC_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true', MUSIC_RATE_LIMIT_SECRET: 'staging-unit-test-secret-not-deployed' };
  const path = '/api/music/me/capabilities?locale=en';
  assert.equal((await (await get(path, { Cookie: 'station_cat_reader_session=isolated-vip' }, active)).json()).canPlayVipFull, false);
  assert.equal((await (await get(path, { Cookie: 'station_cat_music_staging_session=isolated-vip' }, active)).json()).canPlayVipFull, true);
  identity.sql.prepare('UPDATE reader_sessions SET revoked_at=?').run(new Date().toISOString());
  assert.equal((await (await get(path, { Cookie: 'station_cat_music_staging_session=isolated-vip' }, active)).json()).canPlayVipFull, false);
  const failure = await get(path, { Cookie: 'station_cat_music_staging_session=isolated-vip' },
    { ...active, MUSIC_RATE_LIMIT_SECRET: '', MUSIC_STAGING_MEMBERSHIP_DB: { ...closed } });
  assert.equal(failure.status, 503);
  assert.equal((await failure.json()).error.code, 'MUSIC_RATE_LIMIT_UNAVAILABLE');
  assert.equal(touched, 0);
});

test('only music admin, public read routes and exact static dependencies are allowed', () => {
  for (const [path, method] of [
    ['/api/music/catalog?locale=en', 'GET'],
    ['/api/music/me/capabilities?locale=en', 'HEAD'],
    ['/api/music/tracks/track/cover?v=1', 'GET'],
    ['/api/music/tracks/track/audio?v=1&variant=full', 'HEAD'],
    ['/api/music/collections/staging?locale=en', 'GET'],
    ['/admin/music', 'GET'],
    ['/admin/music/', 'HEAD'],
    ['/admin/api/music/status', 'GET'],
    ['/admin/api/music/tracks', 'POST'],
    ['/admin/api/music/tracks/track_1', 'PATCH'],
    ['/admin/api/music/uploads/up_1/bytes', 'PUT'],
    ['/styles/admin-music.css', 'GET'],
    ['/favicon.ico', 'HEAD'],
    ['/images/optimized/station-cat-logo-1668c2e5-160.webp', 'GET'],
    ['/_astro/music.astro_astro_type_script_index_0_lang.hash.js', 'GET']
  ]) assert.equal(isMusicStagingRequest(request(path, method)), true, `${method} ${path}`);
});

test('main site, other admin surfaces, traversal variants and unsupported methods stay closed', () => {
  for (const [path, method] of [
    ['/', 'GET'],
    ['/api/music/catalog?locale=en', 'POST'],
    ['/api/music/tracks/track/audio?v=1&variant=full', 'PUT'],
    ['/api/music/analytics', 'POST'],
    ['/api/music/staging/seed', 'POST'],
    ['/admin-v2/', 'GET'],
    ['/admin/articles/', 'GET'],
    ['/api/readers/membership/redeem', 'POST'],
    ['/api/creem/webhook', 'POST'],
    ['/sitemap.xml', 'GET'],
    ['/_astro/articles.astro_hash.js', 'GET'],
    ['/_astro/music.astro_astro_type_script_index_0_lang.hash.css', 'GET'],
    ['/admin/%2e%2e/api/music/status', 'GET'],
    ['/admin/music/', 'POST'],
    ['/styles/admin-music.css', 'POST'],
    ['/admin/api/music/status', 'DELETE']
  ]) assert.equal(isMusicStagingRequest(request(path, method)), false, `${method} ${path}`);
});

test('host and fail-closed responses are normalized and private', async () => {
  assert.equal(musicStagingHost({ MUSIC_STAGING_EXPECTED_HOST: ' MUSIC-STAGING.WWWSTATIONCAT.ORG ' }), 'music-staging.wwwstationcat.org');
  assert.equal(musicStagingHost({}), '');

  for (const response of [musicStagingUnavailable(), musicStagingNotFound()]) {
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    await response.text();
  }
});

test('the deployed entrypoint blocks other hosts and keeps admin closed without Access config', async () => {
  const env = { MUSIC_STAGING_EXPECTED_HOST: 'music-staging.wwwstationcat.org' };
  const ctx = { waitUntil() {}, passThroughOnException() {} };

  const wrongHost = await stagingWorker.fetch(new Request('https://example.com/admin/music/'), env, ctx);
  assert.equal(wrongHost.status, 404);

  const otherSurface = await stagingWorker.fetch(request('/api/readers/membership/redeem', 'POST'), env, ctx);
  assert.equal(otherSurface.status, 404);

  const missingAccess = await stagingWorker.fetch(request('/admin/api/music/status'), env, ctx);
  assert.equal(missingAccess.status, 503);
  assert.deepEqual(await missingAccess.json(), { ok: false, code: 'ADMIN_AUTH_UNAVAILABLE' });
});

test('staging config exposes only the Access-protected music host and isolated bindings', async () => {
  const source = await readFile(new URL('../ops/music-staging-app.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ''));

  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.route, undefined);
  assert.deepEqual(config.routes, [{
    pattern: 'music-staging.wwwstationcat.org',
    custom_domain: true
  }]);
  assert.equal(config.triggers, undefined);
  assert.equal(config.queues, undefined);
  assert.equal(config.assets.directory, '../.generated/music-staging-assets');
  assert.equal(config.assets.not_found_handling, 'none');
  assert.deepEqual(config.d1_databases.map(({ binding, database_id: id }) => ({ binding, id })), [{
    binding: 'MUSIC_DB',
    id: '8fe1a3e1-7325-4d87-a7e6-2c51338b9158'
  }, {
    binding: 'MUSIC_STAGING_MEMBERSHIP_DB',
    id: 'cb7bbad3-bfbb-457d-b2f2-6fd3b02df651'
  }]);
  assert.deepEqual(config.r2_buckets.map(({ binding, bucket_name: name }) => ({ binding, name })), [{
    binding: 'MUSIC_BUCKET',
    name: 'station-cat-music-staging-private'
  }]);
  assert.equal(source.includes('WAITLIST_DB'), false);
  assert.equal(config.vars.CF_ACCESS_TEAM_DOMAIN, 'misty-limit-82d5.cloudflareaccess.com');
  assert.equal(config.vars.CF_ACCESS_AUD, '5ceda63da88e8ffb34a88338231028e473379ae51755ae3f6d69be218bb63e4a');
  for (const key of ['MUSIC_PUBLIC_ENABLED', 'MUSIC_VIP_DELIVERY_ENABLED']) assert.equal(config.vars[key], 'true');
  for (const key of ['MUSIC_UPLOADS_ENABLED', 'MUSIC_ANALYTICS_ENABLED', 'MUSIC_CLEANUP_ENABLED']) {
    assert.equal(config.vars[key], 'false');
  }
});

test('staging module graph includes only music, Access and the existing reader membership contract', async () => {
  const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
  const entry = fileURLToPath(new URL('../src/music/stagingEntrypoint.js', import.meta.url));
  const pending = [entry];
  const visited = new Set();
  const externalImports = new Set();

  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);

    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /\bimport\s*\(/, `dynamic import is not allowed in ${relative(sourceRoot, file)}`);
    const imports = source.matchAll(/\b(?:import|export)\s+(?:[^'\"]*?\s+from\s+)?['\"]([^'\"]+)['\"]/g);

    for (const [, specifier] of imports) {
      if (!specifier.startsWith('.')) {
        externalImports.add(specifier);
        continue;
      }
      const resolved = resolve(dirname(file), extname(specifier) ? specifier : `${specifier}.js`);
      const repoPath = relative(sourceRoot, resolved).replaceAll('\\', '/');
      assert.ok(['adminAccess.js', 'readerMembership.js', 'data/reader-library-client.js'].includes(repoPath) || repoPath.startsWith('music/'), `unexpected staging import: ${repoPath}`);
      pending.push(resolved);
    }
  }

  const paths = [...visited].map((file) => relative(sourceRoot, file).replaceAll('\\', '/')).sort();
  assert.ok(paths.includes('adminAccess.js'));
  assert.ok(paths.includes('music/stagingEntrypoint.js'));
  assert.ok(!paths.includes('worker.js'));
  assert.deepEqual([...externalImports].sort(), ['@noble/hashes/sha2.js', 'mp3-parser/lib/lib.js']);
});
