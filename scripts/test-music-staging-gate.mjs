import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  isMusicStagingRequest,
  musicStagingHost,
  musicStagingNotFound,
  musicStagingUnavailable
} from '../src/music/stagingGate.js';
import stagingWorker from '../src/music/stagingEntrypoint.js';

const request = (path, method = 'GET') => new Request(`https://music-staging.wwwstationcat.org${path}`, { method });

test('only the music admin surface and its exact static dependencies are allowed', () => {
  for (const [path, method] of [
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
  }]);
  assert.deepEqual(config.r2_buckets.map(({ binding, bucket_name: name }) => ({ binding, name })), [{
    binding: 'MUSIC_BUCKET',
    name: 'station-cat-music-staging-private'
  }]);
  assert.equal(source.includes('WAITLIST_DB'), false);
  assert.equal(config.vars.CF_ACCESS_TEAM_DOMAIN, 'misty-limit-82d5.cloudflareaccess.com');
  assert.equal(config.vars.CF_ACCESS_AUD, '5ceda63da88e8ffb34a88338231028e473379ae51755ae3f6d69be218bb63e4a');
  for (const key of ['MUSIC_PUBLIC_ENABLED', 'MUSIC_UPLOADS_ENABLED', 'MUSIC_VIP_DELIVERY_ENABLED', 'MUSIC_ANALYTICS_ENABLED', 'MUSIC_CLEANUP_ENABLED']) {
    assert.equal(config.vars[key], 'false');
  }
});

test('staging module graph stays inside music and the shared Access actor', async () => {
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
      assert.ok(repoPath === 'adminAccess.js' || repoPath.startsWith('music/'), `unexpected staging import: ${repoPath}`);
      pending.push(resolved);
    }
  }

  const paths = [...visited].map((file) => relative(sourceRoot, file).replaceAll('\\', '/')).sort();
  assert.ok(paths.includes('adminAccess.js'));
  assert.ok(paths.includes('music/stagingEntrypoint.js'));
  assert.ok(!paths.includes('worker.js'));
  assert.deepEqual([...externalImports].sort(), ['@noble/hashes/sha2.js', 'mp3-parser/lib/lib.js']);
});
