// Run only against the resource-pinned staging host. Finite tests; no background load.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { stagingClient, stagingSql, privateJson, sqlValue as q } from '../scripts/helpers/music-staging-ops.mjs';

assert.ok(process.env.MUSIC_STAGING_RECORD_DIR);
const dir = resolve(process.env.MUSIC_STAGING_RECORD_DIR);
const state = JSON.parse(await readFile(resolve(dir, 'fixture-private.json'), 'utf8'));
assert.equal(state.fixtureKind, 'synthetic-read-path-only');
assert.equal(state.identitiesSeeded, true);
const mode = process.argv[2] || 'smoke';
assert.ok(['smoke', 'revocation', 'fault', 'limits', 'counting', 'finish'].includes(mode));
const client = await stagingClient(), report = { mode, startedAt: new Date().toISOString(), checks: [] };
const track = `/api/music/tracks/${state.trackId}`, version = state.audioVersion;
const audio = `${track}/audio?v=${version}&variant=full`, preview = `${track}/audio?v=${version}&variant=preview`;
const vip = state.sessions.vip.token;
const check = async (label, path, options, expected, code) => {
  const r = await client.request(path, options);
  assert.equal(r.status, expected, `${label}: HTTP ${r.status}, ${r.json?.error?.code || r.json?.code || ''}`);
  if (code) assert.equal(r.json?.error?.code || r.json?.code, code, label);
  if (!options?.anonymous) assert.equal(r.headers['cache-control'], 'private, no-store', label);
  report.checks.push({ label, status: r.status, bytes: r.data.length, ...(code ? { code } : {}) });
  await privateJson(resolve(dir, `http-${mode}-progress.json`), report);
  console.log(`${label}: ${r.status}`);
  return r;
};
const counters = async () => (await stagingSql(`SELECT w.category,w.window_start,w.hits,
  (SELECT COUNT(*) FROM music_rate_sources s WHERE s.category=w.category AND s.window_start=w.window_start) AS sources,
  (SELECT SUM(s.hits) FROM music_rate_sources s WHERE s.category=w.category AND s.window_start=w.window_start) AS sourceHits
  FROM music_rate_windows w ORDER BY w.category,w.window_start`))[0].results;
const diagnostic = async () => (await check('authenticated diagnostics', '/admin/api/music/diagnostics', {}, 200)).json;
const freshWindow = async () => {
  // At most one minute; gives each bounded group time to finish in one fixed window.
  const delay = Math.min(60000, 61000 - Date.now() % 60000);
  console.log(`Waiting ${Math.ceil(delay / 1000)} seconds for a fresh rate window.`);
  await new Promise(resolve => setTimeout(resolve, delay));
};

try {
  const d = await diagnostic();
  assert.equal(d.flags.public, true); assert.equal(d.flags.vipDelivery, true);
  assert.equal(d.flags.uploads, false); assert.equal(d.flags.analytics, false); assert.equal(d.maintenanceEnabled, false);
  assert.equal(d.uploadAccounting.details.quotaBytes, 1048576);
  assert.equal(d.uploadAccounting.details.chargedBytes, Object.values(state.uploads).reduce((sum, u) => sum + u.bytes, 0));
  for (const key of ['database', 'uploadAccounting', 'cleanup', 'rateLimits']) assert.equal(d[key].available, true);
  assert.doesNotMatch(JSON.stringify(d), /source_hash|object_key|session_hash|actor_id|@|eyJ|music\/audio\//);

  if (mode === 'smoke') {
    const catalog = await check('catalog', '/api/music/catalog?locale=en', {}, 200);
    assert.equal(catalog.json.tracks.length, 1);
    assert.equal(catalog.json.tracks[0].effectiveAccess, 'vip');
    assert.doesNotMatch(JSON.stringify(catalog.json), /object_key|objectKey|sha256|write_token|session_hash/);
    await check('catalog conditional', '/api/music/catalog?locale=en', { headers: { 'If-None-Match': catalog.headers.etag } }, 304);
    await check('catalog HEAD', '/api/music/catalog?locale=en', { method: 'HEAD' }, 200);
    await check('track detail', `${track}?locale=en`, {}, 200);
    const collection = await check('published fixture collection', '/api/music/collections/staging-http-fixtures?locale=en', {}, 200);
    assert.equal(collection.json.tracks[0].id, state.trackId);
    await check('unknown collection', '/api/music/collections/absent-staging-fixture?locale=en', {}, 404, 'NOT_FOUND');
    await check('cover without reader session', `${track}/cover?v=${version}`, {}, 200);
    await check('lyrics without reader session', `${track}/lyrics?v=${version}`, {}, 200);
    await check('preview without reader session', preview, {}, 200);
    await check('full without reader session', audio, {}, 401, 'AUTH_REQUIRED');
    await check('access without reader session', `${track}/access?v=${version}`, {}, 401, 'AUTH_REQUIRED');
    const caps = await check('VIP capabilities', '/api/music/me/capabilities?locale=en', { session: vip }, 200);
    assert.equal(caps.json.canPlayVipFull, true);
    await check('VIP access', `${track}/access?v=${version}`, { session: vip }, 200);
    const full = await check('VIP full', audio, { session: vip }, 200);
    assert.equal(full.data.length, state.uploads.audio.bytes);
    const fixture = await readFile(new URL('../tests/fixtures/music-mp3/cbr-stereo.mp3', import.meta.url));
    assert.equal(createHash('sha256').update(full.data).digest('hex'), createHash('sha256').update(fixture).digest('hex'));
    await check('VIP HEAD', audio, { session: vip, method: 'HEAD' }, 200);
    const range = await check('VIP range', audio, { session: vip, headers: { Range: 'bytes=0-99' } }, 206);
    assert.deepEqual(range.data, fixture.subarray(0, 100));
    assert.equal(range.headers['content-range'], `bytes 0-99/${fixture.length}`);
    await check('VIP unsatisfiable range', audio, { session: vip, headers: { Range: `bytes=${fixture.length}-` } }, 416, 'RANGE_NOT_SATISFIABLE');
    for (const [name, status, code] of [['normal', 403, 'VIP_REQUIRED'], ['expired', 403, 'MEMBERSHIP_EXPIRED'],
      ['revoked', 401, 'AUTH_REQUIRED'], ['restricted', 403, 'ACCOUNT_RESTRICTED'], ['future', 403, 'VIP_REQUIRED'], ['sessionExpired', 401, 'AUTH_REQUIRED']]) {
      await check(`${name} full rejected`, audio, { session: state.sessions[name].token }, status, code);
    }
    await check('production reader cookie ignored', audio, { headers: { Cookie: `station_cat_reader_session=${vip}` } }, 401, 'AUTH_REQUIRED');
    await check('cleanup execution closed', '/admin/api/music/cleanup/11111111-1111-1111-1111-111111111111', { method: 'POST', json: {} }, 503, 'MUSIC_CLEANUP_DISABLED');
    for (const path of ['/admin/api/music/diagnostics', '/api/music/catalog?locale=en', audio, `${track}/cover?v=${version}`]) {
      await check('outer Access blocks anonymous', path, { anonymous: true }, 302);
    }
    report.counters = await counters();
  } else if (mode === 'revocation') {
    await check('access before revocation', `${track}/access?v=${version}`, { session: vip }, 200);
    const member = (await stagingSql(`SELECT started_at,expires_at FROM reader_memberships WHERE account_id=${state.sessions.vip.id}`, 'MUSIC_STAGING_MEMBERSHIP_DB'))[0].results[0];
    try {
      await stagingSql(`UPDATE reader_sessions SET revoked_at=${q(new Date().toISOString())} WHERE account_id=${state.sessions.vip.id}`, 'MUSIC_STAGING_MEMBERSHIP_DB');
      for (const options of [{}, { method: 'HEAD' }, { headers: { Range: 'bytes=0-99' } }]) {
        await check('audio after session revocation', audio, { session: vip, ...options }, 401, options.method === 'HEAD' ? undefined : 'AUTH_REQUIRED');
      }
      await stagingSql(`UPDATE reader_sessions SET revoked_at=NULL WHERE account_id=${state.sessions.vip.id};
        UPDATE reader_memberships SET expires_at=${q(new Date(Date.now() - 1000).toISOString())} WHERE account_id=${state.sessions.vip.id}`, 'MUSIC_STAGING_MEMBERSHIP_DB');
      await check('audio after membership expiry', audio, { session: vip, headers: { Range: 'bytes=0-99' } }, 403, 'MEMBERSHIP_EXPIRED');
    } finally {
      await stagingSql(`UPDATE reader_sessions SET revoked_at=NULL WHERE account_id=${state.sessions.vip.id};
        UPDATE reader_memberships SET expires_at=${q(member.expires_at)} WHERE account_id=${state.sessions.vip.id}`, 'MUSIC_STAGING_MEMBERSHIP_DB');
    }
    await check('audio after test membership restore', audio, { session: vip, method: 'HEAD' }, 200);
  } else if (mode === 'fault') {
    await freshWindow();
    await check('audio before counter fault', audio, { session: vip, method: 'HEAD' }, 200);
    const before = await counters();
    try {
      await stagingSql(`CREATE TRIGGER staging_http_counter_fault BEFORE UPDATE ON music_rate_windows
        WHEN NEW.category='audio' BEGIN SELECT RAISE(IGNORE); END;`);
      await check('global update failure closes audio', audio, { session: vip, headers: { Range: 'bytes=0-99' } }, 503, 'MUSIC_RATE_LIMIT_UNAVAILABLE');
      const after = await counters(); assert.deepEqual(after, before);
      report.rollback = { before, after };
    } finally { await stagingSql('DROP TRIGGER IF EXISTS staging_http_counter_fault'); }
    await check('audio after counter recovery', audio, { session: vip, method: 'HEAD' }, 200);
  } else if (mode === 'limits') {
    assert.deepEqual(d.rateLimits.details.limits, { catalog: { source: 4, global: 8 }, artwork: { source: 4, global: 4 }, audio: { source: 4, global: 8 } });
    await freshWindow();
    const beforeSpoof = await counters();
    for (const value of ['192.0.2.1', '2001:db8::1']) {
      const r = await client.request('/api/music/catalog?locale=en', { headers: { 'CF-Connecting-IP': value } });
      assert.equal(r.status, 403, 'Cloudflare rejects a client-supplied CF-Connecting-IP before the Worker');
      report.checks.push({ label: 'client-supplied CF-Connecting-IP rejected before counters', status: r.status });
    }
    assert.deepEqual(await counters(), beforeSpoof);
    // The rejected forged-header probes do not test the limiter. Use ordinary
    // Cloudflare ingress and vary only untrusted X-Forwarded-For for admission.
    await freshWindow();
    // One egress, separate concurrent curl clients. Do not claim multi-region/instance coverage.
    for (const [category, path] of [['catalog', '/api/music/catalog?locale=en'], ['artwork', `${track}/cover?v=${version}`], ['audio', audio]]) {
      const attempts = await Promise.all(Array.from({ length: 12 }, (_, i) => client.request(path, {
        ...(category === 'audio' ? { session: vip } : {}),
        method: i % 2 ? 'HEAD' : 'GET', headers: {
          'X-Forwarded-For': `198.51.100.${i + 1}`,
          ...(category === 'audio' ? { Range: 'bytes=0-99' } : {}),
          ...(category === 'catalog' && i % 3 === 0 ? { 'If-None-Match': '*' } : {})
        }
      })));
      const allowed = attempts.filter(r => [200, 206, 304].includes(r.status)), limited = attempts.filter(r => r.status === 429);
      report.checks.push({ label: `${category} actual concurrent responses`, statuses: attempts.map(r => r.status),
        errors: attempts.map(r => r.json?.error?.code || null),
        edgeLocations: [...new Set(attempts.map(r => r.headers['cf-ray']?.split('-').at(-1)).filter(Boolean))] });
      await privateJson(resolve(dir, `http-${mode}-progress.json`), report);
      assert.equal(allowed.length, 4, category); assert.equal(limited.length, 8, category);
      for (const r of limited) { assert.ok(Number(r.headers['retry-after']) >= 1 && Number(r.headers['retry-after']) <= 60); assert.equal(r.headers['cache-control'], 'private, no-store'); }
      report.checks.push({ label: `${category} bounded concurrent requests with forged source headers`, accepted: 4, limited: 8,
        statuses: attempts.map(r => r.status) });
    }
    report.counters = (await counters()).filter(row => row.window_start === Math.floor(Date.now() / 60000) * 60000);
    assert.equal(report.counters.length, 3);
    for (const row of report.counters) { assert.equal(row.hits, 4); assert.equal(row.sources, 1); assert.equal(row.sourceHits, 4); }
    report.coverage = 'Single real egress, bounded concurrent HTTP; no proof of multiple Worker isolates or regions.';
  } else if (mode === 'counting') {
    assert.deepEqual(d.rateLimits.details.limits.catalog, { source: 4, global: 8 });
    await freshWindow();
    const path = '/api/music/catalog?locale=en';
    const first = await check('first GET consumes one', path, {}, 200);
    await check('HEAD consumes second', path, { method: 'HEAD' }, 200);
    await check('304 consumes third', path, { headers: { 'If-None-Match': first.headers.etag } }, 304);
    await check('fourth request consumes last source slot', path, {}, 200);
    await check('fifth request rejected', path, {}, 429, 'MUSIC_RATE_LIMITED');
    report.counters = (await counters()).filter(row => row.category === 'catalog' && row.window_start === Math.floor(Date.now() / 60000) * 60000);
    assert.equal(report.counters.length, 1);
    assert.equal(report.counters[0].hits, 4); assert.equal(report.counters[0].sourceHits, 4); assert.equal(report.counters[0].sources, 1);
  } else if (mode === 'finish') {
    assert.deepEqual(d.rateLimits.details.limits, { catalog: { source: 120, global: 6000 }, artwork: { source: 240, global: 12000 }, audio: { source: 120, global: 6000 } });
    await stagingSql(`UPDATE reader_sessions SET revoked_at=${q(new Date().toISOString())} WHERE revoked_at IS NULL`, 'MUSIC_STAGING_MEMBERSHIP_DB');
    await check('all synthetic VIP sessions retired', audio, { session: vip }, 401, 'AUTH_REQUIRED');
    const [result] = await stagingSql("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'staging_http_%'");
    assert.deepEqual(result.results, []);
    // These tables contain only this isolated acceptance run. No session/asset/charge deletion.
    await stagingSql('DELETE FROM music_rate_sources; DELETE FROM music_rate_windows;');
    const final = await diagnostic();
    assert.deepEqual(final.rateLimits.details.acceptedRequests, { catalog: 0, artwork: 0, audio: 0 });
    report.finalDiagnostics = final;
    report.identityCounts = (await stagingSql(`SELECT (SELECT COUNT(*) FROM reader_accounts) AS accounts,
      COUNT(*) AS sessions,SUM(revoked_at IS NOT NULL) AS revokedSessions FROM reader_sessions`, 'MUSIC_STAGING_MEMBERSHIP_DB'))[0].results[0];
    assert.deepEqual(report.identityCounts, { accounts: 7, sessions: 7, revokedSessions: 7 });
    report.musicCounts = (await stagingSql(`SELECT (SELECT COUNT(*) FROM music_assets) AS assets,
      (SELECT COUNT(*) FROM music_upload_sessions WHERE status='completed') AS completedUploads,
      (SELECT COUNT(*) FROM music_upload_sessions WHERE status<>'completed') AS unfinishedUploads,
      (SELECT COUNT(*) FROM music_rights_reviews WHERE review_status='approved') AS approvedRights,
      (SELECT COUNT(*) FROM music_upload_cleanup) AS cleanupRows`))[0].results[0];
    assert.deepEqual(report.musicCounts, { assets: 4, completedUploads: 4, unfinishedUploads: 0, approvedRights: 0, cleanupRows: 0 });
    for (const binding of ['MUSIC_DB', 'MUSIC_STAGING_MEMBERSHIP_DB']) {
      assert.deepEqual((await stagingSql('PRAGMA foreign_key_check', binding))[0].results, []);
    }
    for (const path of ['/admin/api/music/diagnostics', '/api/music/catalog?locale=en', audio]) await check('final anonymous Access boundary', path, { anonymous: true }, 302);
  }
  report.finishedAt = new Date().toISOString();
  await privateJson(resolve(dir, `http-${mode}.json`), report);
  console.log(JSON.stringify({ mode, checks: report.checks, ...(report.coverage ? { coverage: report.coverage } : {}) }));
} finally { await client.close(); }
