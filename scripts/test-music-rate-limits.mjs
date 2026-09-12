import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { randomUUID } from 'node:crypto';
import { musicTestDatabase } from './helpers/music-test-database.mjs';
import { checkMusicRateLimit, RATE_RETENTION_MS } from '../src/music/rateLimits.js';
import { handleMusicPublic } from '../src/music/publicHttp.js';
import { handleMusicMedia } from '../src/music/mediaResponse.js';
import { handleMusicAdmin } from '../src/music/adminHttp.js';

const now = Date.parse('2026-09-11T02:00:30Z'), instances = [];
afterEach(() => { for (const f of instances.splice(0)) f.sql.close(); });
const settings = (source = 2,global = 3) => Object.fromEntries(['catalog','artwork','audio'].map(k => [k,{ source,global }]));
const request = (ip = '192.0.2.1',path = '/api/music/catalog?locale=en',options = {}) => new Request(`https://fixture.test${path}`,{
  ...options,headers: { 'CF-Connecting-IP': ip,...options.headers } });
function fixture(source = 2,global = 3) {
  const f = musicTestDatabase(); instances.push(f);
  f.r2Reads = 0;
  f.env = { MUSIC_DB: f.db,MUSIC_BUCKET: { get() { f.r2Reads++; assert.fail('rate-limited request reached R2'); } },
    MUSIC_PUBLIC_ENABLED: 'true',MUSIC_RATE_LIMIT_SECRET: 'rate-unit-fixture-secret-not-for-deployment',
    MUSIC_RATE_LIMITS_JSON: JSON.stringify(settings(source,global)) };
  f.check = (ip = '192.0.2.1',category = 'catalog',time = now,options = {}) =>
    checkMusicRateLimit(request(ip),f.env,category,{ clock: () => time,...options });
  return f;
}

test('atomic source and global budgets admit exactly their limits under competing requests', async () => {
  const f = fixture(3,5);
  const same = await Promise.all(Array.from({ length: 12 },() => f.check()));
  assert.equal(same.filter(x => x === null).length,3);
  assert.ok(same.filter(Boolean).every(x => x.status === 429 && x.retryAfter === 30));
  const other = await Promise.all(Array.from({ length: 12 },(_,i) => f.check(`198.51.100.${i+1}`)));
  assert.equal(other.filter(x => x === null).length,2);
  assert.equal(f.sql.prepare('SELECT hits FROM music_rate_windows').get().hits,5);
  assert.equal(f.sql.prepare('SELECT SUM(hits) n FROM music_rate_sources').get().n,5);
});

test('denied source attempts consume no global slots; independent categories and next minute work', async () => {
  const f = fixture(1,2);
  assert.equal(await f.check(),null); assert.equal((await f.check()).status,429);
  assert.equal(await f.check('192.0.2.2'),null); assert.equal((await f.check('192.0.2.3')).status,429);
  assert.equal(await f.check('192.0.2.1','artwork'),null); assert.equal(await f.check('192.0.2.1','audio'),null);
  assert.equal(await f.check('192.0.2.1','catalog',now+30000),null);
  assert.equal((await f.check('192.0.2.1','catalog',now+89999)).retryAfter,1);
});

test('only window-scoped HMAC source keys are stored; canonical IPv6 cannot split a quota', async () => {
  const f = fixture(1,10);
  assert.equal(await f.check('2001:db8::1'),null);
  assert.equal((await f.check('2001:0db8:0:0:0:0:0:1')).status,429);
  const first = f.sql.prepare('SELECT source_hash FROM music_rate_sources').get().source_hash;
  assert.match(first,/^[a-f0-9]{64}$/);
  assert.equal(await f.check('2001:db8::1','catalog',now+60000),null);
  const hashes = f.sql.prepare('SELECT source_hash FROM music_rate_sources').all().map(r => r.source_hash);
  assert.equal(new Set(hashes).size,2);
  assert.doesNotMatch(JSON.stringify(f.dump()),/2001:|192\.0\.2|rate-unit-fixture-secret/);
});

test('missing source, forged forwarded headers, malformed limits or secrets fail before database writes', async () => {
  const f = fixture(), before = f.dump();
  for (const ip of ['', '256.0.0.1', '192.0.2.01', '::bad::', '127.0.0.1:90', 'fake-source']) {
    assert.equal((await f.check(ip)).status,503);
  }
  const forwarded = new Request('https://fixture.test/api/music/catalog?locale=en',{ headers: { 'X-Forwarded-For': '192.0.2.1' } });
  assert.equal((await checkMusicRateLimit(forwarded,f.env,'catalog')).status,503);
  for (const patch of [{ MUSIC_RATE_LIMIT_SECRET: '' },{ MUSIC_RATE_LIMITS_JSON: '{}' },
    { MUSIC_RATE_LIMITS_JSON: JSON.stringify(settings(10,1)) },{ MUSIC_RATE_LIMITS_JSON: 'null' }]) {
    assert.equal((await checkMusicRateLimit(request(),{ ...f.env,...patch },'catalog')).status,503);
  }
  assert.deepEqual(f.dump(),before);
});

test('global counter faults roll back the source increment and never authorize a request', async () => {
  const initial = fixture();
  initial.sql.exec('CREATE TRIGGER rate_ignore_insert BEFORE INSERT ON music_rate_windows BEGIN SELECT RAISE(IGNORE); END;');
  assert.equal((await initial.check()).status,503);
  assert.equal(initial.sql.prepare('SELECT COUNT(*) n FROM music_rate_sources').get().n,0);
  const f = fixture(); assert.equal(await f.check(),null);
  f.sql.exec(`CREATE TRIGGER rate_ignore BEFORE UPDATE ON music_rate_windows BEGIN SELECT RAISE(IGNORE); END;`);
  assert.equal((await f.check()).code,'MUSIC_RATE_LIMIT_UNAVAILABLE');
  assert.equal(f.sql.prepare('SELECT hits FROM music_rate_sources').get().hits,1);
  f.sql.exec('DROP TRIGGER rate_ignore');
  f.sql.exec('DELETE FROM music_rate_windows');
  assert.equal((await f.check()).status,503);
  assert.equal(f.sql.prepare('SELECT hits FROM music_rate_sources').get().hits,1);
});

test('bounded pruning removes only old counters; quiet-period retention does not require a new cron', async () => {
  const f = fixture(); assert.equal(await f.check(),null);
  assert.equal(await f.check('192.0.2.1','catalog',now+RATE_RETENTION_MS+60000),null);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_rate_sources').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_rate_windows').get().n,1);
});

test('limiter failures and timeouts are 503 with no fallback allowance and consume late rejection', async () => {
  const f = fixture(); f.state.fail = /INSERT INTO music_rate_sources/;
  assert.equal((await f.check()).status,503);
  let reject;
  const stalled = { ...f.env,MUSIC_DB: { withSession() { return { prepare: () => ({ bind() { return {}; } }),
    batch: () => new Promise((_,r) => { reject = r; }) }; } } };
  const result = await checkMusicRateLimit(request(),stalled,'catalog',{ timeoutMs: 5 });
  assert.equal(result.status,503); reject(new Error('late private database failure'));
});

test('failure logs distinguish deadlines using fixed fields without serializing private failures', async t => {
  const logs = [], warn = t.mock.method(console,'warn',(...args) => logs.push(args));
  const f = fixture(), privateText = 'private cookie SQL key 192.0.2.1';
  const denial = { status: 503,code: 'MUSIC_RATE_LIMIT_UNAVAILABLE',retryAfter: 5 };
  const fakeDb = batch => ({ withSession() { return { prepare: () => ({ bind() { return {}; } }),batch }; } });
  const check = (env, category = 'catalog', options = {}) => checkMusicRateLimit(request(),env,category,options);
  const expected = (stage,reason = 'operation_failed',category = 'catalog') =>
    ['music_rate_limit_failure',{ version: 1,category,stage,reason }];
  assert.deepEqual(await check({...f.env,MUSIC_RATE_LIMITS_JSON:privateText}),denial);
  assert.deepEqual(logs.pop(),expected('configuration'));
  assert.deepEqual(await check(f.env,privateText),denial);
  assert.deepEqual(logs.pop(),expected('configuration','operation_failed','unknown'));
  assert.deepEqual(await check({...f.env,MUSIC_RATE_LIMIT_SECRET:''}),denial);
  assert.deepEqual(logs.pop(),expected('source'));
  const error = new Error(privateText); error.toJSON = () => { assert.fail('serialized private error'); };
  assert.deepEqual(await check({...f.env,MUSIC_DB:fakeDb(async () => { throw error; })}),denial);
  assert.deepEqual(logs.pop(),expected('database'));
  // An external error named "timeout" is not evidence of our deadline firing.
  assert.deepEqual(await check({...f.env,MUSIC_DB:fakeDb(async () => { throw new Error('timeout'); })}),denial);
  assert.deepEqual(logs.pop(),expected('database'));
  let resolve;
  assert.deepEqual(await check({...f.env,MUSIC_DB:fakeDb(() => new Promise(r => { resolve = r; }))},'catalog',{timeoutMs:5}),denial);
  assert.deepEqual(logs.pop(),expected('database','deadline_exceeded'));
  resolve([{success:true,results:[]},{success:true,results:[]},{success:true,results:[{hits:1}]}]);
  await new Promise(r => setImmediate(r)); assert.equal(logs.length,0);
  assert.deepEqual(await check({...f.env,MUSIC_DB:fakeDb(async () => [{privateText}])}),denial);
  assert.deepEqual(logs.pop(),expected('result'));
  assert.equal(await f.check(),null); assert.equal(await f.check(),null); assert.equal((await f.check()).status,429);
  assert.equal(logs.length,0);
  assert.ok(warn.mock.calls.every(call => !JSON.stringify(call.arguments).includes(privateText)));
});

test('logging failures cannot change 503 or touch protected media', async t => {
  t.mock.method(console,'warn',() => { throw new Error('logger failed'); });
  const f = fixture(); f.env.MUSIC_RATE_LIMIT_SECRET = '';
  const before = f.dump(), response = await handleMusicPublic(request(),f.env);
  assert.equal(response.status,503); assert.equal(response.headers.get('retry-after'),'5');
  assert.equal((await response.json()).error.code,'MUSIC_RATE_LIMIT_UNAVAILABLE');
  assert.deepEqual(f.dump(),before); assert.equal(f.r2Reads,0);
});

test('default D1 budget admits a confirmed result after 1.5s but denies at 3s without retry', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(console,'warn',() => {});
  const f = fixture();
  for (const complete of [true,false]) {
    let started, resolveBatch, calls = 0, settled = false;
    const ready = new Promise(r => { started = r; });
    const db = {withSession() { return {prepare: () => ({bind() { return {}; }}),batch() {
      calls++; started(); return new Promise(r => { resolveBatch = r; });
    }}; }};
    const pending = checkMusicRateLimit(request(),{...f.env,MUSIC_DB:db},'catalog').then(value => {settled=true;return value;});
    await ready;
    t.mock.timers.tick(2999); await new Promise(r => setImmediate(r));
    assert.equal(settled,false);
    const result = [{success:true,results:[]},{success:true,results:[]},{success:true,results:[{hits:1}]}];
    if (complete) { resolveBatch(result); assert.equal(await pending,null); }
    else {
      t.mock.timers.tick(1);
      assert.deepEqual(await pending,{status:503,code:'MUSIC_RATE_LIMIT_UNAVAILABLE',retryAfter:5});
      resolveBatch(result); await new Promise(r => setImmediate(r));
    }
    assert.equal(calls,1);
  }
});

test('closed public flag causes zero database reads and writes, including rate counters', async () => {
  const env = { MUSIC_PUBLIC_ENABLED: 'false',get MUSIC_DB() { assert.fail('closed gate touched database'); },
    get MUSIC_BUCKET() { assert.fail('closed gate touched R2'); } };
  assert.equal((await handleMusicPublic(request(),env)).status,503);
  assert.equal((await handleMusicMedia(request('192.0.2.1',`/api/music/tracks/${randomUUID()}/audio?v=1&variant=full`),env)).status,503);
});

test('catalog, artwork, access and all audio methods enforce limits before catalog, member or R2 reads', async () => {
  const f = fixture(1,100), id = randomUUID();
  for (const category of ['catalog','artwork','audio']) assert.equal(await f.check('192.0.2.1',category),null);
  const traced = { ...f.env, WAITLIST_DB: { withSession() { assert.fail('limited request read membership'); } },
    MUSIC_DB: { withSession(mode) {
      const s = f.db.withSession(mode);
      return { ...s,prepare(query) { assert.doesNotMatch(query,/music_tracks|music_track_revisions|music_assets/); return s.prepare(query); } };
    } } };
  for (const path of ['/api/music/catalog?locale=en',`/api/music/tracks/${id}/cover?v=1`,
    `/api/music/tracks/${id}/lyrics?v=1`,`/api/music/tracks/${id}/access?v=1`,'/api/music/me/capabilities?locale=en']) {
    const response = await handleMusicPublic(request('192.0.2.1',path),traced,{ clock: () => now });
    assert.equal(response.status,429); assert.equal(response.headers.get('retry-after'),'30');
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
  for (const method of ['GET','HEAD']) {
    const response = await handleMusicMedia(request('192.0.2.1',`/api/music/tracks/${id}/audio?v=1&variant=full`,{
      method,headers: { Range: 'bytes=0-2','If-Range': '"old"' } }),traced,{ clock: () => now });
    assert.equal(response.status,429); assert.equal(response.headers.get('content-range'),null);
    if (method === 'HEAD') assert.equal(await response.text(),'');
  }
  assert.equal(f.r2Reads,0);
});

test('diagnostics require Access and return aggregate readiness without identities, keys or mutations', async () => {
  const f = fixture(), req = new Request('https://fixture.test/admin/api/music/diagnostics');
  assert.equal((await handleMusicAdmin(req,f.env,async () => null)).status,401);
  const before = f.dump(), response = await handleMusicAdmin(req,f.env,async () => 'admin@example.test');
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'private, no-store');
  const body = await response.json(); assert.equal(body.rateLimits.available,true); assert.equal(body.cleanup.available,true);
  assert.doesNotMatch(JSON.stringify(body),/source_hash|object_key|admin@example|192\.0\.2|rate-unit-fixture-secret/);
  assert.deepEqual(f.dump(),before);
  const missing = await handleMusicAdmin(req,{},async () => 'admin@example.test');
  assert.equal((await missing.json()).configured,false);
  const noSecret = await handleMusicAdmin(req,{ ...f.env,MUSIC_RATE_LIMIT_SECRET: '' },async () => 'admin@example.test');
  assert.equal((await noSecret.json()).rateLimits.available,false);
});

test('successful catalog, conditional 304 and HEAD share a budget without positive cache expansion', async () => {
  const f = fixture(2,10);
  const first = await handleMusicPublic(request(),f.env,{ clock: () => now });
  assert.equal(first.status,200); assert.equal(first.headers.get('cache-control'),'public, max-age=0, must-revalidate');
  const conditional = await handleMusicPublic(request('192.0.2.1','/api/music/catalog?locale=en',{
    headers: { 'If-None-Match': first.headers.get('etag') } }),f.env,{ clock: () => now });
  assert.equal(conditional.status,304);
  const head = await handleMusicPublic(request('192.0.2.1','/api/music/catalog?locale=en',{ method: 'HEAD' }),f.env,{ clock: () => now });
  assert.equal(head.status,429); assert.equal(await head.text(),'');
  assert.equal(f.sql.prepare('SELECT hits FROM music_rate_windows').get().hits,2);
});
