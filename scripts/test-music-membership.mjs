import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readMusicMembership } from '../src/music/membership.js';
import { musicCapabilities, musicAccess } from '../src/music/access.js';
import { applyMembershipRedemption, membershipTimestamp } from '../src/readerMembership.js';
import { getMembershipRefundReview, decideMembershipRefundReview } from '../src/membershipRefundReview.js';
import { readerLibraryPaths } from '../src/data/reader-library-client.js';

const now = Date.parse('2026-09-09T12:00:00Z');
const iso = value => new Date(value).toISOString();
const dbs = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const migrations = ['0003_reader_accounts.sql', '0004_novel_entitlements.sql', '0005_novel_payments.sql', '0006_reader_credits.sql',
  '0007_backend_content_platform.sql', '0009_reader_memberships.sql', '0036_reader_membership_redemptions.sql',
  '0037_membership_refund_reviews.sql'].map(name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));

function fixture(time = now) {
  const sql = new DatabaseSync(':memory:'); dbs.push(sql);
  sql.exec('PRAGMA foreign_keys=ON'); migrations.forEach(m => sql.exec(m));
  const state = { reads: [], primary: [], fail: false, delay: 0, result: null, afterRead: null };
  class Statement {
    constructor(query, params = [], readOnly = false) { Object.assign(this, { query, params, readOnly }); }
    bind(...params) { return new Statement(this.query, params, this.readOnly); }
    async all() {
      if (this.readOnly) {
        assert.match(this.query, /^SELECT\s/);
        assert.doesNotMatch(this.query, /credit|ledger|entitlement|redemption|music_|email|metadata_json|password/i);
        state.reads.push({ query: this.query, params: this.params });
        if (state.fail) throw new Error('private database detail must not leak');
        if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      }
      const result = { success: true, results: sql.prepare(this.query).all(...this.params) };
      if (this.readOnly && state.afterRead) state.afterRead();
      return this.readOnly && state.result ? state.result(result) : result;
    }
    async first() { return sql.prepare(this.query).get(...this.params) || null; }
  }
  const db = { prepare: query => new Statement(query),
    withSession(mode) { state.primary.push(mode); assert.equal(mode, 'first-primary');
      return { prepare: query => new Statement(query, [], true) }; },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const results = statements.map(s => ({ success: true, results: sql.prepare(s.query).all(...s.params) }));
        sql.exec('COMMIT'); return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
  };
  for (const id of [1, 2]) {
    sql.prepare('INSERT INTO reader_accounts(id,email,normalized_email) VALUES(?,?,?)')
      .run(id, `private${id}@example.test`, `private${id}@example.test`);
    sql.prepare(`INSERT INTO reader_sessions(account_id,session_hash,created_at,expires_at,last_seen_at)
      VALUES(?,?,?,?,'2000-01-01 00:00:00')`).run(id,
        createHash('sha256').update(`fixture-session-${id}`).digest('hex'), iso(time - 3600000), iso(time + 86400000));
    sql.prepare('INSERT INTO reader_credit_accounts(account_id,balance_credits) VALUES(?,100)').run(id);
  }
  const member = (id = 1, start = time - 3600000, end = time + 7200000) => sql.prepare(`INSERT INTO reader_memberships
    (account_id,membership_level,started_at,expires_at) VALUES(?,'member',?,?)
    ON CONFLICT(account_id) DO UPDATE SET started_at=excluded.started_at,expires_at=excluded.expires_at,membership_level='member'`)
    .run(id, iso(start), iso(end));
  const snapshot = () => Object.fromEntries(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [name, sql.prepare(`SELECT * FROM ${name}`).all()]));
  return { sql, db, env: { WAITLIST_DB: db }, state, member, snapshot };
}
function request(id = 1, method = 'GET', headers = {}, query = '') {
  return new Request(`https://wwwstationcat.org/api/music/me/capabilities${query}`, { method,
    headers: { ...(id ? { cookie: `station_cat_reader_session=fixture-session-${id}` } : {}), ...headers } });
}
const read = (f, id = 1, options = {}) => readMusicMembership(request(id), f.env, { clock: () => now, ...options });
function record(mode = 'vip', preview = true) {
  const id = randomUUID(); const revision = randomUUID(); const audio = randomUUID(); const short = randomUUID();
  const asset = { owner_track_id: id, state: 'validated', format: 'mp3', content_type: 'audio/mpeg',
    byte_size: 1000, sha256: 'a'.repeat(64) };
  return {
    track: { id, slug: 'test-song', lifecycle: 'published', published_revision_id: revision,
      first_published_at: now - 1000, published_at: now - 1000 },
    revision: { id: revision, track_id: id, revision_no: 1, state: 'sealed',
      created_at: now - 2000, technical_reviewed_at: now - 1000, access_mode: mode,
      early_access_until: mode === 'early_access' ? now : null,
      post_early_access_mode: mode === 'early_access' ? 'free' : null, policy_version: 1,
      audio_asset_id: audio, preview_asset_id: preview ? short : null, cover_asset_id: null, lyrics_asset_id: null,
      metadata_json: JSON.stringify({ originalLocale: 'en', title: { en: 'Test song' }, summary: { en: '' },
        creatorName: 'Fixture', language: 'instrumental', instrumental: true, genres: [], moods: [] }) },
    assets: [{ ...asset, id: audio, kind: 'audio', object_key: 'private/full', duration_ms: 120000 },
      { ...asset, id: short, kind: 'preview', object_key: 'private/preview', duration_ms: 30000,
        derived_from_asset_id: audio, source_start_ms: 10000, source_end_ms: 40000 }]
  };
}
const access = (f, song = record(), extra = {}, req = request()) => musicAccess(req, f.env, {
  record: song, revisionNo: 1, variant: 'full', vipDeliveryEnabled: true, clock: () => now, ...extra
});
async function code(response, status, expected) {
  assert.equal(response.status, status); const body = await response.json();
  assert.equal(body.error?.code, expected); return body;
}

test('anonymous and ambiguous cookies never query private data; claims cannot grant VIP', async () => {
  const f = fixture(); f.member();
  for (const cookie of ['', 'other=1', 'station_cat_reader_session=',
    'station_cat_reader_session=x; station_cat_reader_session=y', 'station_cat_reader_session=%broken']) {
    const result = await readMusicMembership(request(null, 'GET', { cookie, 'X-Reader-Account': '1',
      'Cf-Access-Authenticated-User-Email': 'admin@example.test' }, '?isVip=true&accountId=1&payment=success'),
    f.env, { clock: () => now });
    assert.equal(result.authenticated, false); assert.equal(result.membershipStatus, 'none');
  }
  assert.equal(f.state.reads.length, 0);
  assert.equal((await readMusicMembership(request(null), {}, { clock: () => now })).status, 200);
});

test('trusted session hash + joined account + real membership only; absolutely no writes', async () => {
  const f = fixture(); f.member(); const before = f.snapshot();
  const result = await read(f);
  assert.equal(result.membershipStatus, 'active'); assert.equal(result.validUntil, iso(now + 7200000));
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.state.primary, ['first-primary']);
  assert.equal(f.state.reads.length, 1);
  assert.equal(f.state.reads[0].params[0], createHash('sha256').update('fixture-session-1').digest('hex'));
  assert.doesNotMatch(JSON.stringify(result), /private1|account_id|session_id|source_ref|metadata|credits|fixture-session/);
  assert.equal((await read(f, 2)).membershipStatus, 'none');
  const forged = await readMusicMembership(request(2, 'GET', { 'X-Reader-Account': '1' }, '?accountId=1&isVip=true'),
    f.env, { clock: () => now });
  assert.equal(forged.membershipStatus, 'none');
  const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /readerSessionCookieName = 'station_cat_reader_session'/);
});

test('expired, revoked, missing and future sessions fail; restricted accounts do not get an upsell', async () => {
  const f = fixture(); f.member();
  assert.equal((await read(f, 99)).authenticated, false);
  f.sql.prepare('UPDATE reader_sessions SET expires_at=? WHERE account_id=1').run(iso(now));
  assert.equal((await read(f)).authenticated, false);
  f.sql.prepare('UPDATE reader_sessions SET expires_at=?,revoked_at=? WHERE account_id=1').run(iso(now + 5000), iso(now));
  assert.equal((await read(f)).authenticated, false);
  f.sql.prepare('UPDATE reader_sessions SET revoked_at=NULL,created_at=? WHERE account_id=1').run(iso(now + 1000));
  assert.equal((await read(f)).authenticated, false);
  f.sql.prepare('UPDATE reader_sessions SET created_at=? WHERE account_id=1').run(iso(now - 1000));
  for (const status of ['disabled', 'deleted', 'unknown']) {
    f.sql.prepare('UPDATE reader_accounts SET status=? WHERE id=1').run(status);
    const result = await musicCapabilities(request(), f.env, { clock: () => now, vipDeliveryEnabled: true });
    const body = await code(result, 403, 'ACCOUNT_RESTRICTED');
    assert.equal(body.canPlayVipFull, false); assert.equal(body.loginPath, null); assert.equal(body.membershipCenterPath, null);
  }
});

test('membership [start,end) milliseconds, SQL UTC, future and equal-period boundaries', async () => {
  const f = fixture(); f.member(1, now, now + 1);
  assert.equal((await read(f)).membershipStatus, 'active');
  assert.equal((await read(f, 1, { clock: () => now + 1 })).membershipStatus, 'expired');
  f.member(1, now + 1, now + 2000);
  assert.equal((await read(f)).membershipStatus, 'none');
  assert.equal((await read(f, 1, { clock: () => now + 1 })).membershipStatus, 'active');
  f.member(1, now, now);
  assert.equal((await read(f)).membershipStatus, 'expired');
  f.sql.exec("UPDATE reader_memberships SET started_at='2026-09-09 12:00:00',expires_at='2026-09-09 12:00:00.001'");
  assert.equal((await read(f)).membershipStatus, 'active');
});

test('unknown level, corrupt dates and purported lifetime never become VIP or a purchase prompt', async () => {
  const f = fixture();
  for (const [field, value] of [['membership_level', 'vip'], ['membership_level', 'all'], ['membership_level', 'supporter'],
    ['expires_at', ''], ['expires_at', 'lifetime'], ['started_at', '2026-02-30 00:00:00'],
    ['expires_at', '2026-09-10T12:00:00+08:00'], ['started_at', iso(now + 9000000)]]) {
    f.member(); f.sql.prepare(`UPDATE reader_memberships SET ${field}=?`).run(value);
    const result = await read(f); assert.equal(result.status, 503, `${field}=${value}`);
    assert.equal(result.membershipStatus, 'unavailable'); assert.equal(result.validUntil, null);
  }
  f.member(); f.state.result = result => { result.results[0].expires_at = null; return result; };
  assert.equal((await read(f)).status, 503);
});

test('duplicate grants, mismatched owner and malformed query results are unavailable', async () => {
  const f = fixture(); f.member();
  for (const change of [r => ({ ...r, results: [...r.results, ...r.results] }),
    r => { r.results[0].membership_account_id = 2; return r; },
    r => { r.results[0].session_account_id = 2; return r; },
    () => ({ success: false, results: [] }), () => ({ success: true, results: null }),
    () => ({ success: true, results: [null] })]) {
    f.state.result = change; assert.equal((await read(f)).status, 503);
  }
  f.state.result = null;
  assert.equal((await read(f)).membershipStatus, 'active');
});

test('missing binding/table/session API and database errors return 503, not none', async () => {
  const f = fixture(); f.member();
  for (const env of [{}, { WAITLIST_DB: { prepare() { throw new Error('must not use unconstrained DB'); } } }]) {
    const body = await code(await musicCapabilities(request(), env, { clock: () => now }), 503, 'MEMBERSHIP_UNAVAILABLE');
    assert.equal(body.membershipStatus, 'unavailable'); assert.equal(body.membershipCenterPath, null);
  }
  f.state.fail = true; const result = await read(f); assert.equal(result.status, 503);
  assert(!JSON.stringify(result).includes('private database'));
  f.state.fail = false; f.sql.exec('ALTER TABLE reader_memberships RENAME TO missing_memberships');
  assert.equal((await read(f)).status, 503);
});

test('timeout denies; late completion cannot mutate result or database', async () => {
  const f = fixture(); f.member(); const before = f.snapshot(); f.state.delay = 30;
  const result = await read(f, 1, { timeoutMs: 5 }); assert.equal(result.status, 503);
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(result.membershipStatus, 'unavailable'); assert.deepEqual(f.snapshot(), before);
});

test('query completion time is used; session expiry bounds capability recheck', async () => {
  const f = fixture(); f.member(1, now - 1, now + 10); let time = now;
  f.state.afterRead = () => { time = now + 10; };
  assert.equal((await read(f, 1, { clock: () => time })).membershipStatus, 'expired');
  f.state.afterRead = null; f.member();
  f.sql.prepare('UPDATE reader_sessions SET expires_at=? WHERE account_id=1').run(iso(now + 1000));
  assert.equal((await read(f)).validUntil, iso(now + 1000));
});

test('no cross-request cache: logout, account switch, expiry, renewal and disable take effect', async () => {
  const f = fixture(); f.member(); assert.equal((await read(f)).membershipStatus, 'active');
  f.member(1, now - 1000, now); assert.equal((await read(f)).membershipStatus, 'expired');
  f.member(); assert.equal((await read(f)).membershipStatus, 'active');
  assert.equal((await read(f, 2)).membershipStatus, 'none');
  assert.equal((await read(f, null)).authenticated, false);
  f.sql.exec("UPDATE reader_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE account_id=1");
  assert.equal((await read(f)).authenticated, false);
  assert.equal(f.state.primary.length, 5);
});

test('balances and work-specific grants cannot enable or disable site-wide membership', async () => {
  const f = fixture(); assert.equal((await read(f)).membershipStatus, 'none');
  for (const scope of ['chapter', 'series', 'all']) {
    f.sql.prepare(`INSERT INTO novel_entitlements(account_id,series_slug,scope,access_level)
      VALUES(1,'fixture-series',?,'paid')`).run(scope);
  }
  assert.equal((await read(f)).membershipStatus, 'none');
  f.member(); f.sql.exec('UPDATE reader_credit_accounts SET balance_credits=-100 WHERE account_id=1');
  const result = await readMusicMembership(request(1, 'GET', { 'X-Game-Entitlement': 'all', 'X-Access-Level': 'all' }),
    f.env, { clock: () => now });
  assert.equal(result.membershipStatus, 'active');
  f.sql.exec('DELETE FROM reader_memberships');
  assert.equal((await read(f)).membershipStatus, 'none');
});

test('capabilities use real localized paths and minimal fields; VIP flag defaults closed', async () => {
  const f = fixture(); f.member();
  for (const [locale, path] of Object.entries(readerLibraryPaths)) {
    const body = await (await musicCapabilities(request(), f.env, { locale, clock: () => now, vipDeliveryEnabled: true })).json();
    assert.equal(body.membershipCenterPath, path); assert.equal(body.loginPath, null);
    assert.equal(body.lifetime, false); assert.equal(body.canPlayVipFull, true);
    assert.deepEqual(Object.keys(body).sort(), ['authenticated', 'membershipStatus', 'canPlayVipFull', 'validUntil',
      'lifetime', 'serverNow', 'membershipCenterPath', 'loginPath', 'musicVipDeliveryEnabled'].sort());
    const anon = await (await musicCapabilities(request(null), f.env, { locale, clock: () => now })).json();
    assert.equal(anon.loginPath, path); assert.equal(anon.canPlayVipFull, false);
  }
  for (const flag of [undefined, false, 'true', '1', 1]) {
    const body = await (await musicCapabilities(request(), f.env, { clock: () => now, vipDeliveryEnabled: flag })).json();
    assert.equal(body.membershipStatus, 'active'); assert.equal(body.canPlayVipFull, false);
  }
});

test('free full and independent preview bypass membership DB even when broken or VIP delivery disabled', async () => {
  const f = fixture(); f.state.fail = true;
  for (const method of ['GET', 'HEAD']) {
    assert.equal((await access(f, record('free'), { vipDeliveryEnabled: false }, request(1, method))).status, 200);
    const preview = await access(f, record(), { variant: 'preview', vipDeliveryEnabled: false }, request(1, method));
    assert.equal(preview.status, 200);
    if (method === 'GET') assert.equal((await preview.json()).canPlayFull, false);
  }
  assert.equal(f.state.reads.length, 0);
  await code(await access(f, record('vip', false), { variant: 'preview' }), 404, 'PREVIEW_UNAVAILABLE');
});

test('VIP full differentiates unauthenticated, none, expired, restricted, unavailable and disabled', async () => {
  const f = fixture();
  await code(await access(f, record(), {}, request(null)), 401, 'AUTH_REQUIRED');
  await code(await access(f), 403, 'VIP_REQUIRED');
  f.member(1, now - 1000, now); await code(await access(f), 403, 'MEMBERSHIP_EXPIRED');
  f.member(); assert.equal((await access(f)).status, 200);
  f.state.fail = true; await code(await access(f), 503, 'MEMBERSHIP_UNAVAILABLE');
  f.state.fail = false; f.sql.exec("UPDATE reader_accounts SET status='disabled' WHERE id=1");
  await code(await access(f), 403, 'ACCOUNT_RESTRICTED');
  const before = f.state.reads.length;
  await code(await access(f, record(), { vipDeliveryEnabled: false }), 503, 'VIP_DELIVERY_DISABLED');
  assert.equal(f.state.reads.length, before);
});

test('content/version/variant guards run first; unknown policy cannot fall back to full', async () => {
  const f = fixture(); f.state.fail = true;
  await code(await access(f, record(), { variant: undefined }), 400, 'INVALID_VARIANT');
  await code(await access(f, record(), { variant: 'FULL' }), 400, 'INVALID_VARIANT');
  await code(await access(f, record(), { revisionNo: '1' }), 400, 'INVALID_INPUT');
  await code(await access(f, record(), { revisionNo: 2 }), 409, 'VERSION_CONFLICT');
  await code(await access(f, null), 404, 'NOT_FOUND');
  const song = record(); song.track.lifecycle = 'unpublished';
  await code(await access(f, song), 410, 'TRACK_UNAVAILABLE');
  song.track.lifecycle = 'draft'; await code(await access(f, song), 404, 'NOT_FOUND');
  song.track.lifecycle = 'published'; song.revision.access_mode = 'unknown';
  await code(await access(f, song), 404, 'NOT_FOUND');
  assert.equal(f.state.reads.length, 0);
});

test('early access exact expiry honors both post-period policies without a write', async () => {
  const f = fixture(); const song = record('early_access');
  await code(await access(f, song, { clock: () => now - 1 }, request(null)), 401, 'AUTH_REQUIRED');
  assert.equal((await access(f, song)).status, 200);
  song.revision.post_early_access_mode = 'vip';
  await code(await access(f, song), 403, 'VIP_REQUIRED');
});

test('HEAD/Range/conditional headers cannot bypass eligibility; every response is private no-store', async () => {
  const f = fixture();
  for (const method of ['GET', 'HEAD']) {
    for (const id of [null, 1]) {
      const req = request(id, method, { Range: 'bytes=0-1', 'If-None-Match': '*', 'If-Range': '"old"' });
      const result = await access(f, record(), {}, req);
      assert.equal(result.status, id ? 403 : 401); assert.equal(result.headers.get('cache-control'), 'private, no-store');
      assert.equal(result.headers.get('vary'), 'Cookie');
      for (const header of ['etag', 'content-range', 'content-length', 'location']) assert.equal(result.headers.get(header), null);
      if (method === 'HEAD') assert.equal(await result.text(), '');
    }
  }
  f.member(); const head = await musicCapabilities(request(1, 'HEAD'), f.env, { clock: () => now });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  await code(await musicCapabilities(request(), f.env, { locale: 'xx', clock: () => now }), 400, 'INVALID_INPUT');
  await code(await access(f, record(), {}, request(1, 'POST')), 405, 'METHOD_NOT_ALLOWED');
});

test('real redemption and manual refund functions change next read; remaining renewal is preserved', async () => {
  const time = Date.now(); const f = fixture(time);
  const ledger = (type, ref, delta) => Number(f.sql.prepare(`INSERT INTO reader_credit_ledger
    (account_id,entry_type,credits_delta,balance_after,source,source_ref,note)
    VALUES(1,?,?,100,'creem-credit-pack',?,'Isolated fixture')`).run(type, delta, ref).lastInsertRowid);
  ledger('topup', 'music-fixture-order', 100);
  ledger('topup', 'music-fixture-order-2', 100);
  const settings = { membershipCreditCost: 10, membershipDurationMonths: 1, unitLabel: 'Points', membershipCoversPaidContent: true };
  const first = await applyMembershipRedemption(f.db, 1, 'music-real-redemption-1', settings);
  await applyMembershipRedemption(f.db, 1, 'music-real-redemption-2', settings);
  const active = await read(f, 1, { clock: Date.now }); assert.equal(active.membershipStatus, 'active');
  const reversal = ledger('reversal', 'music-fixture-order', -100);
  let detail = await getMembershipRefundReview(f.db, reversal);
  await decideMembershipRefundReview(f.db, { id: reversal, decision: 'revoke', version: detail.version,
    reason: 'Isolated test: verified funding reference, first period only.',
    redemptionIds: [first.ledger.id], confirmation: String(reversal) }, 'admin@example.test');
  assert.equal((await read(f, 1, { clock: Date.now })).membershipStatus, 'active');
  // A separate approved review removes the remaining receipt; music never edits its own grant.
  const reversal2 = ledger('reversal', 'music-fixture-order-2', -100);
  detail = await getMembershipRefundReview(f.db, reversal2);
  await decideMembershipRefundReview(f.db, { id: reversal2, decision: 'revoke', version: detail.version,
    reason: 'Isolated test: verified remaining receipt and complete refund.',
    redemptionIds: detail.candidates.map(c => c.ledgerId), confirmation: String(reversal2) }, 'admin@example.test');
  const before = f.snapshot();
  // The existing refund service rounds remaining duration to seconds; honor its actual end boundary.
  const end = membershipTimestamp(f.sql.prepare('SELECT expires_at FROM reader_memberships WHERE account_id=1').get().expires_at);
  assert.ok(Math.abs(end - Date.now()) < 2000);
  assert.equal((await read(f, 1, { clock: () => Math.max(Date.now(), end) })).membershipStatus, 'expired');
  assert.deepEqual(f.snapshot(), before);
});
