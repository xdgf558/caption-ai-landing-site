import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'smol-toml';
import worker from '../src/worker.js';
import { musicProductionCandidate, assertMusicProductionCandidate, productionRoot,
  closedMusicVariables, writeMusicProductionCandidate } from './build-music-production-candidate.mjs';
const run = promisify(execFile), source = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const baseline = parse(source);
const resources = () => ({ account_id: '3f5394e0ef5a531c63c0ceaa74262e0d', compatibility_date: '2026-09-13',
  d1_databases: [{ binding: 'MUSIC_DB', database_name: 'station-cat-music-production',
    database_id: '11111111-1111-4111-8111-111111111111', migrations_dir: path.resolve(productionRoot, 'migrations-music') }],
  r2_buckets: [{ binding: 'MUSIC_BUCKET', bucket_name: 'station-cat-music-production-private' }] });

test('closed candidate preserves original production identity, payments, routing, scheduling and complete assets', () => {
  const r = resources(), original = structuredClone(r), config = musicProductionCandidate(source, r);
  assert.deepEqual(r, original);
  for (const key of ['name', 'routes', 'workers_dev', 'preview_urls', 'compatibility_date', 'observability', 'ai', 'send_email', 'queues', 'triggers']) assert.deepEqual(config[key], baseline[key], key);
  assert.equal(config.compatibility_flags, undefined);
  assert.equal(config.main, path.resolve(productionRoot, 'src/worker.js'));
  assert.equal(config.assets.directory, path.resolve(productionRoot, 'dist'));
  assert.deepEqual({ ...config.assets, directory: baseline.assets.directory }, baseline.assets);
  assert.deepEqual(config.vars, { ...baseline.vars, ...closedMusicVariables });
  assert.deepEqual(config.d1_databases[0], { ...baseline.d1_databases[0], migrations_dir: path.resolve(productionRoot, 'migrations') });
  assert.deepEqual(config.d1_databases[1], r.d1_databases[0]);
  assert.deepEqual(config.r2_buckets, [...baseline.r2_buckets, ...r.r2_buckets]);
  assert.equal(config.vars.MUSIC_RATE_LIMIT_SECRET, undefined);
  assert.equal(config.keep_vars, undefined);
});

test('any baseline drift requires explicit review, including staging Access, secret, env, cron or assets', () => {
  for (const bad of [source.replace(baseline.vars.CF_ACCESS_AUD, 'staging-aud'), source.replace('src/worker.js', 'src/music/stagingEntrypoint.js'),
    source.replace('./dist', './.generated/music-staging-assets'), source.replace('17 * * * *', '* * * * *'),
    source + '\n[env.staging]\nname="wrong"\n', source.replace('[vars]', '[vars]\nSECRET="do-not-echo"')]) {
    assert.throws(() => musicProductionCandidate(bad, resources()), /^Error: MUSIC_PRODUCTION_BASELINE_CHANGED$/);
  }
});

test('resource inputs reject staging, existing identity DB, extra bindings and secret/override fields', () => {
  const mutations = [r => r.account_id = 'other', r => r.vars = { SECRET:'do-not-echo' }, r => r.main = 'fixture.js',
    r => r.env = {}, r => r.d1_databases.push(structuredClone(r.d1_databases[0])),
    r => r.d1_databases[0].database_name = 'station-cat-music-staging',
    ...['8fe1a3e1-7325-4d87-a7e6-2c51338b9158', 'cb7bbad3-bfbb-457d-b2f2-6fd3b02df651', baseline.d1_databases[0].database_id, 'not-a-uuid'].map(id => r => r.d1_databases[0].database_id = id),
    r => r.d1_databases[0].remote = true, r => r.d1_databases[0].migrations_dir = './migrations',
    r => r.r2_buckets[0].bucket_name = 'station-cat-music-staging-private', r => r.r2_buckets[0].preview_bucket_name = 'other'];
  for (const mutate of mutations) { const r = resources(); mutate(r); assert.throws(() => musicProductionCandidate(source, r), /^Error: MUSIC_PRODUCTION_[A-Z_]+$/); }
});

test('candidate checker rejects a single open flag or changed binding/path/identity/secret', () => {
  const mutations = [...Object.keys(closedMusicVariables).map(key => c => c.vars[key] = 'true'),
    c => c.vars.MUSIC_RATE_LIMIT_SECRET = 'do-not-echo', c => c.vars.CF_ACCESS_AUD = 'staging',
    c => c.d1_databases[1].database_id = '22222222-2222-4222-8222-222222222222',
    c => c.d1_databases[0].migrations_dir = './migrations', c => c.assets.run_worker_first = false,
    c => c.main = './fixture.js', c => c.keep_vars = true];
  for (const mutate of mutations) { const r = resources(), c = musicProductionCandidate(source, r); mutate(c); assert.throws(() => assertMusicProductionCandidate(c, source, r), /MUSIC_PRODUCTION_CANDIDATE_CHANGED/); }
});

test('real production handler denies closed HTML/media/catalog/cards/analytics before any data binding', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const paths = ['/music', '/music/', '/music/index.html', '/en/music/', '/ja/music/', '/zh-hans/music/', '/zh-hant/music/',
    '/%6dusic/', '/en%2fmusic/', '/music%2findex.html', '/api/music/catalog?locale=en', '/api/music/collections/album?locale=en', '/api/music/me/capabilities?locale=en',
    `/api/music/tracks/${id}/audio?v=1&variant=full`, `/api/music/tracks/${id}/audio?v=1&variant=preview`,
    `/api/music/tracks/${id}/cover?v=1`, `/api/music/tracks/${id}/lyrics?v=1`, `/api/music/tracks/${id}/access?v=1`, `/api/music/tracks/${id}/share.png?locale=en&v=1&format=card`];
  for (const p of paths) for (const method of ['GET', 'HEAD']) {
    const env = { ...musicProductionCandidate(source, resources()).vars };
    for (const key of ['MUSIC_DB', 'MUSIC_BUCKET', 'WAITLIST_DB', 'ASSETS']) Object.defineProperty(env, key, { get() { assert.fail('Unexpected binding read: '+key); } });
    const r = await worker.fetch(new Request('https://wwwstationcat.org'+p, {method}), env, {});
    assert.equal(r.status, 503, p); assert.match(r.headers.get('cache-control'), /no-store/);
  }
  const env = { ...musicProductionCandidate(source, resources()).vars };
  for (const key of ['MUSIC_DB', 'MUSIC_BUCKET', 'WAITLIST_DB', 'ASSETS']) Object.defineProperty(env, key, { get() { assert.fail('Unexpected binding read: '+key); } });
  const analytics = await worker.fetch(new Request('https://wwwstationcat.org/api/music/analytics/config'), env, {});
  assert.equal(analytics.status, 200); assert.equal((await analytics.json()).available, false);
  assert.equal((await worker.fetch(new Request('https://wwwstationcat.org/api/music/events', {method:'POST',body:'{}'}), env, {})).status, 503);
  assert.equal((await worker.fetch(new Request('https://wwwstationcat.org/admin/api/music/diagnostics'), env, {})).status, 401);
});

test('private writer never overwrites source, resources, prior output, or a symlink; CLI errors omit input', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'music-production-config-'));
  try {
    const input = path.join(dir, 'resources.json'), output = path.join(dir, 'candidate.json');
    await writeFile(input, JSON.stringify(resources()));
    await writeMusicProductionCandidate(input, output);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assertMusicProductionCandidate(JSON.parse(await readFile(output, 'utf8')), source, resources());
    await assert.rejects(writeMusicProductionCandidate(input, output));
    await assert.rejects(writeMusicProductionCandidate(input, input));
    await assert.rejects(writeMusicProductionCandidate(input, path.resolve(productionRoot, 'wrong.json')), /MUSIC_PRODUCTION_PRIVATE_PATH_REQUIRED/);
    await symlink(productionRoot, path.join(dir, 'checkout'));
    await assert.rejects(writeMusicProductionCandidate(input, path.join(dir, 'checkout', 'wrong.json')), /MUSIC_PRODUCTION_PRIVATE_PATH_REQUIRED/);
    await writeFile(input, '{"secret":"do-not-echo",invalid}');
    try { await run(process.execPath, ['scripts/build-music-production-candidate.mjs', '--resources', input, '--output', path.join(dir,'bad.json')], {cwd:productionRoot}); assert.fail('CLI must reject'); }
    catch (error) { assert.match(error.stderr, /^MUSIC_PRODUCTION_RESOURCE_READ\s*$/); assert.doesNotMatch(error.stderr, /do-not-echo|resources.json/); }
    assert.equal(await readFile(path.resolve(productionRoot, 'wrangler.toml'), 'utf8'), source);
  } finally { await rm(dir, {recursive:true,force:true}); }
});
