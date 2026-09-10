import assert from 'node:assert/strict';
import { afterEach, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import worker from '../src/worker.js';
import { getAccessToken, musicAdminActor, normalizeAccessTeamDomain } from '../src/adminAccess.js';
import { handleMusicAdmin } from '../src/music/adminHttp.js';
import { executeMusicPublication } from '../src/music/publication.js';
import { publicationFingerprint } from '../src/music/publicationValidation.js';
import { musicTestDatabase } from './helpers/music-test-database.mjs';
import { seedMusicRuntimeFixture } from './helpers/music-runtime-fixture.js';

const instances = [], originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; for (const f of instances.splice(0)) f.sql.close(); });
function fixture() {
  const f = musicTestDatabase(); instances.push(f);
  f.env = { MUSIC_DB: f.db, MUSIC_BUCKET: { get() { throw new Error('Admin metadata must not read R2'); } },
    WAITLIST_DB: { withSession() { throw new Error('Admin must not access reader/credits database'); } } };
  return f;
}
const actor = 'admin@example.test';
const origin = 'https://wwwstationcat.org', base = '/admin/api/music';
const input = () => ({ slug: `test-${randomUUID()}`, metadata: { originalLocale: 'en', title: { en: 'Test song' },
  summary: { en: '' }, creatorName: 'Fixture', instrumental: true, language: 'instrumental', genres: [], moods: [] } });
function req(path, method = 'GET', body, headers = {}) {
  return new Request(origin + base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json',
    Origin: origin, 'X-Requested-With': 'StationCatMusicAdmin', 'Idempotency-Key': randomUUID() } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
async function call(f, path, method, body, headers = {}, authorize = async () => actor) {
  const response = await handleMusicAdmin(req(path, method, body, headers), f.env, authorize);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  return { status: response.status, body: method === 'HEAD' ? null : await response.json(), response };
}
async function create(f) {
  const body = input(), result = await call(f, '/tracks', 'POST', body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { ...result.body, input: body };
}
const saveInput = item => ({ ...item.input, policy: { accessMode: 'vip', earlyAccessUntil: null, postEarlyAccessMode: null, policyVersion: 1 },
  revisionId: item.revisionId, reason: 'Test edit.' });
const ifMatch = version => ({ 'If-Match': `"edit-${version}"` });
const proof = async assets => ({ checkedAt: Date.now(), assets: assets.map(a => ({ id: a.id, exists: true,
  etag: a.etag, sha256: a.sha256, byteSize: a.byte_size, contentType: a.content_type,
  structureValid: true, measurement: 'mp3-frames', durationMs: a.duration_ms })) });
async function seeded(f, published = false) {
  const owner = randomUUID(), audioId = randomUUID(), previewId = randomUUID();
  const asset = { owner_track_id: owner, state: 'validated', format: 'mp3', content_type: 'audio/mpeg',
    byte_size: 1000, sha256: 'b'.repeat(64), etag: 'synthetic-audio' };
  const command = await seedMusicRuntimeFixture(f.db, {
    audio: { ...asset, id: audioId, kind: 'audio', object_key: `music/audio/${owner}/${audioId}.mp3`, duration_ms: 120000 },
    preview: { ...asset, id: previewId, kind: 'preview', object_key: `music/previews/${owner}/${previewId}.mp3`, duration_ms: 30000,
      derived_from_asset_id: audioId, source_start_ms: 0, source_end_ms: 30000 }
  });
  if (published) await executeMusicPublication(f.db, command, { actorId: actor, verifyResources: proof });
  return command;
}

test('no verifier identity, binding alias, missing migrations and missing settings fail closed', async () => {
  const f = fixture(), before = f.dump();
  assert.equal((await call(f, '/tracks', 'GET', undefined, {}, async () => null)).status, 401);
  assert.equal((await handleMusicAdmin(req('/tracks'), f.env)).status, 503);
  assert.deepEqual(f.dump(), before);
  const env = f.env;
  for (const patch of [{ MUSIC_DB: null }, { MUSIC_BUCKET: null }, { WAITLIST_DB: f.db }]) {
    f.env = { ...env, ...patch }; assert.equal((await call(f, '/status')).status, 503);
  }
  f.env = env;
  f.sql.exec("DELETE FROM music_settings WHERE key='catalogVersion'");
  assert.equal((await call(f, '/status')).status, 503);
});

test('strict origin, custom CSRF header and JSON required before every write, including HEAD/OPTIONS probes', async () => {
  const f = fixture(), item = await create(f), before = f.dump();
  for (const [path, method, body] of [['/tracks', 'POST', input()], [`/tracks/${item.trackId}`, 'PATCH', saveInput(item)],
    [`/tracks/${item.trackId}/unpublish`, 'POST', { revisionId: item.revisionId, reason: 'Test' }],
    [`/tracks/${item.trackId}/archive`, 'POST', { reason: 'Test' }],
    [`/revisions/${item.revisionId}/rights-review`, 'PUT', { status: 'pending', review: {}, evidenceIds: [], reason: 'Test' }]]) {
    for (const headers of [{ Origin: '' }, { Origin: 'https://evil.example' }, { 'X-Requested-With': '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await call(f, path, method, body, { ...ifMatch(1), ...headers })).status, 403);
    }
  }
  assert.equal((await call(f, '/tracks', 'POST', input(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await call(f, '/tracks', 'OPTIONS')).status, 405);
  assert.equal((await call(f, `/tracks/${item.trackId}/unpublish`, 'HEAD')).status, 405);
  assert.deepEqual(f.dump(), before);
});

test('stream-counted 64KiB body limit, malformed JSON, unknown fields and invalid schemas do not write', async () => {
  const f = fixture(), before = f.dump();
  assert.equal((await call(f, '/tracks', 'POST', 'x'.repeat(65537))).status, 413);
  for (const bad of ['{', '[]', 'null', { ...input(), approved: true }, { ...input(), actorId: 'forged' },
    { ...input(), slug: 'Bad Slug' }, { ...input(), metadata: {} }, { ...input(), assets: { audio: randomUUID() } }]) {
    assert.ok([400, 422].includes((await call(f, '/tracks', 'POST', bad)).status));
  }
  for (const patch of [{ title: null }, { genres: null }, { originalLocale: 'xx' }, { moods: Array(13).fill('many') },
    { creatorName: 'x'.repeat(81) }, { title: { en: 'Hello', xx: 'bad' } }]) {
    const body = input(); Object.assign(body.metadata, patch);
    assert.ok([400, 422].includes((await call(f, '/tracks', 'POST', body)).status));
  }
  assert.deepEqual(f.dump(), before);
});

test('new draft is VIP, response is private and creation retry recovers one audit and revision', async () => {
  const f = fixture(), body = input(), headers = { 'Idempotency-Key': randomUUID() };
  f.state.lose = true;
  const first = await call(f, '/tracks', 'POST', body, headers);
  assert.equal(first.status, 200); assert.equal(first.body.replayed, true);
  const before = f.dump(), replay = await call(f, '/tracks', 'POST', body, headers);
  assert.deepEqual(replay.body, first.body); assert.deepEqual(f.dump(), before);
  assert.equal((await call(f, '/tracks', 'POST', { ...body, slug: 'changed' }, headers)).status, 409);
  const read = await call(f, `/tracks/${first.body.trackId}`);
  assert.equal(read.body.draft.policy.accessMode, 'vip'); assert.equal(read.body.editVersion, 1);
  assert.equal(read.response.headers.get('etag'), '"edit-1"');
  assert.doesNotMatch(JSON.stringify(read.body), /object_key|sha256|fingerprint|canPlayFull/);
  assert.equal((await call(f, `/tracks/${first.body.trackId}`, 'HEAD')).body, null);
});

test('stalled or invalid UTF-8 request streams are cancelled without writes', async () => {
  const f = fixture(), before = f.dump(); let cancelled = false;
  const headers = { Origin: origin, 'X-Requested-With': 'StationCatMusicAdmin', 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' };
  const stalled = new Request(origin + base + '/tracks', { method: 'POST', headers, duplex: 'half',
    body: new ReadableStream({ cancel() { cancelled = true; } }) });
  assert.equal((await handleMusicAdmin(stalled, f.env, async () => actor)).status, 408);
  assert.equal(cancelled, true);
  const invalid = new Request(origin + base + '/tracks', { method: 'POST', headers, body: new Uint8Array([0xff, 0xff]) });
  assert.equal((await handleMusicAdmin(invalid, f.env, async () => actor)).status, 400);
  assert.deepEqual(f.dump(), before);
});

test('identical concurrent creations return one track and receipt; slug and actor conflicts do not duplicate', async () => {
  const f = fixture(), body = input(), headers = { 'Idempotency-Key': randomUUID() };
  const results = await Promise.all([call(f, '/tracks', 'POST', body, headers), call(f, '/tracks', 'POST', body, headers)]);
  assert.equal(results[0].status, 200); assert.equal(results[1].status, 200);
  assert.equal(results[0].body.trackId, results[1].body.trackId);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_tracks').get().n, 1);
  assert.equal((await call(f, '/tracks', 'POST', body)).status, 409);
  assert.equal((await call(f, '/tracks', 'POST', body, headers, async () => 'other@example.test')).status, 409);
});

test('PATCH requires explicit matching version, creates a new revision and discards old review approvals', async () => {
  const f = fixture(), command = await seeded(f);
  const old = (await call(f, `/tracks/${command.trackId}`)).body;
  const body = { slug: old.slug, metadata: old.draft.metadata, policy: old.draft.policy, assets: old.draft.assets,
    revisionId: old.draft.id, reason: 'Update the title.' };
  body.metadata.title.en = 'Revised';
  assert.equal((await call(f, `/tracks/${old.id}`, 'PATCH', body)).status, 428);
  const saved = await call(f, `/tracks/${old.id}`, 'PATCH', body, ifMatch(old.editVersion));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const current = (await call(f, `/tracks/${old.id}`)).body;
  assert.equal(current.rights, null); assert.equal(current.draft.technicalReviewedAt, null);
  assert.notEqual(current.draft.id, old.draft.id);
  assert.equal(current.draft.number, 2); assert.equal(current.draft.metadata.title.en, 'Revised');
  assert.equal((await call(f, `/tracks/${old.id}`, 'PATCH', body, ifMatch(old.editVersion))).status, 409);
  assert.equal(f.sql.prepare('SELECT review_status FROM music_rights_reviews WHERE revision_id=?').get(old.draft.id).review_status, 'approved');
});

test('editing a published song keeps old sealed public content and permanent slug intact', async () => {
  const f = fixture(), command = await seeded(f, true), old = (await call(f, `/tracks/${command.trackId}`)).body;
  const body = { slug: old.slug, metadata: old.published.metadata, policy: old.published.policy, assets: old.published.assets,
    revisionId: old.published.id, reason: 'New edition.' };
  assert.equal((await call(f, `/tracks/${old.id}`, 'PATCH', { ...body, slug: 'rename' }, ifMatch(2))).status, 409);
  assert.equal((await call(f, `/tracks/${old.id}`, 'PATCH', body, ifMatch(2))).status, 200);
  const current = (await call(f, `/tracks/${old.id}`)).body;
  assert.deepEqual(current.published, old.published); assert.equal(current.lifecycle, 'published'); assert.ok(current.draft);
  assert.equal(f.sql.prepare("SELECT value_json FROM music_settings WHERE key='catalogVersion'").get().value_json, '1');
});

test('cross-track or wrong-kind assets, forged fingerprints and invalid policy versions are refused', async () => {
  const f = fixture(), a = await create(f), foreign = await seeded(f), read = (await call(f, `/tracks/${foreign.trackId}`)).body;
  const path = `/tracks/${a.trackId}`, body = saveInput(a), before = f.dump();
  for (const patch of [{ assets: { audio: read.draft.assets.audio } }, { technical_fingerprint: 'a'.repeat(64) },
    { policy: { ...body.policy, policyVersion: 2 } }, { policy: { ...body.policy, accessMode: 'lifetime' } }]) {
    const result = await call(f, path, 'PATCH', { ...body, ...patch }, ifMatch(1));
    assert.ok([400, 422].includes(result.status), JSON.stringify(result.body));
  }
  assert.deepEqual(f.dump(), before);
});

test('rights review uses verified actor and server fingerprint, clears technical stamp and requires same-track evidence', async () => {
  const f = fixture(), command = await seeded(f), old = (await call(f, `/tracks/${command.trackId}`)).body;
  const path = `/revisions/${command.revisionId}/rights-review`, body = { status: 'approved', review: old.rights.review,
    evidenceIds: old.rights.evidenceIds, reason: 'Synthetic manual review.' };
  assert.equal((await call(f, path, 'PUT', { ...body, reviewerId: 'forged' }, ifMatch(1))).status, 400);
  assert.equal((await call(f, path, 'PUT', { ...body, evidenceIds: [] }, ifMatch(1))).status, 422);
  assert.equal((await call(f, path, 'PUT', { ...body, evidenceIds: [old.draft.assets.audio] }, ifMatch(1))).status, 422);
  const foreign = (await call(f, `/tracks/${(await seeded(f)).trackId}`)).body;
  assert.equal((await call(f, path, 'PUT', { ...body, evidenceIds: foreign.rights.evidenceIds }, ifMatch(1))).status, 422);
  for (const patch of [{ permittedUse: 'personal' }, { generatedAt: 'yesterday' }, { planAtGeneration: 'free' }]) {
    assert.equal((await call(f, path, 'PUT', { ...body, review: { ...body.review, ...patch } }, ifMatch(1))).status, 422);
  }
  const saved = await call(f, path, 'PUT', body, { ...ifMatch(1), 'Cf-Access-Authenticated-User-Email': 'forged@example.test' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const r = f.sql.prepare('SELECT * FROM music_rights_reviews WHERE revision_id=?').get(command.revisionId);
  assert.equal(r.reviewer_id, actor); assert.match(r.revision_fingerprint, /^[a-f0-9]{64}$/);
  const rev = f.sql.prepare('SELECT * FROM music_track_revisions WHERE id=?').get(command.revisionId);
  assert.equal(rev.technical_fingerprint, null); assert.equal(rev.technical_reviewed_at, null);
  const track = f.sql.prepare('SELECT * FROM music_tracks WHERE id=?').get(command.trackId);
  const assets = f.sql.prepare('SELECT * FROM music_assets WHERE owner_track_id=? ORDER BY id').all(command.trackId);
  assert.equal(r.revision_fingerprint, await publicationFingerprint({ track, revision: rev, assets, rights: r,
    evidence: f.sql.prepare('SELECT * FROM music_rights_evidence WHERE review_id=?').all(r.id) }));
});

test('publishing requires real private objects; flags or client proof cannot bless synthetic assets', async () => {
  const f = fixture(), cmd = await seeded(f), before = f.dump();
  Object.assign(f.env, { MUSIC_PUBLIC_ENABLED: 'true', MUSIC_UPLOADS_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true' });
  const status = (await call(f, '/status')).body;
  assert.equal(status.flags.public, true); assert.equal(status.capabilities.publish, true); assert.equal(status.capabilities.uploads, false);
  const body = { revisionId: cmd.revisionId, reason: cmd.reason, confirmedPolicyVersion: 1 };
  const denied = await call(f, `/tracks/${cmd.trackId}/publish`, 'POST', body, ifMatch(1));
  // Random UUID order may inspect the synthetic evidence key before the unavailable audio object.
  assert.ok((denied.status === 422 && denied.body.code === 'MUSIC_STORAGE_ASSET_INVALID') ||
    (denied.status === 503 && denied.body.code === 'MUSIC_STORAGE_UNAVAILABLE'), JSON.stringify(denied));
  assert.equal((await call(f, `/tracks/${cmd.trackId}/publish`, 'POST', { ...body, verifyResources: true }, ifMatch(1))).status, 400);
  for (const path of ['/uploads', '/assets/' + randomUUID(), '/collections', '/analytics', '/tracks/x/technical-review']) {
    assert.equal((await call(f, path, 'GET')).status, 404);
  }
  assert.deepEqual(f.dump(), before);
});

test('downlisting and archiving work with flags off, retain media and audit, and cannot be used to republish', async () => {
  const f = fixture(), cmd = await seeded(f, true);
  const body = { revisionId: cmd.revisionId, reason: 'Take offline.' }, key = randomUUID();
  assert.equal((await call(f, `/tracks/${cmd.trackId}/archive`, 'POST', { reason: 'Test' }, ifMatch(2))).status, 409);
  const off = await call(f, `/tracks/${cmd.trackId}/unpublish`, 'POST', body, { ...ifMatch(2), 'Idempotency-Key': key });
  assert.equal(off.status, 200); assert.equal(off.body.catalogVersion, 2);
  const archive = await call(f, `/tracks/${cmd.trackId}/archive`, 'POST', { reason: 'Retain history.' }, ifMatch(3));
  assert.equal(archive.status, 200); assert.equal(archive.body.lifecycle, 'archived');
  assert.equal((await call(f, `/tracks/${cmd.trackId}/unpublish`, 'POST', body, { ...ifMatch(2), 'Idempotency-Key': key })).body.replayed, true);
  assert.equal(f.sql.prepare('SELECT lifecycle FROM music_tracks WHERE id=?').get(cmd.trackId).lifecycle, 'archived');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_assets WHERE owner_track_id=?').get(cmd.trackId).n, 3);
  assert.equal(f.sql.prepare('SELECT state FROM music_track_revisions WHERE id=?').get(cmd.revisionId).state, 'sealed');
  assert.equal((await call(f, `/tracks/${cmd.trackId}`)).status, 200);
});

test('every zero-write/failure rolls back draft, version, audit and receipt; original key can retry', async () => {
  for (const pattern of [/INSERT INTO music_tracks/, /INSERT INTO music_track_revisions/, /UPDATE music_tracks SET draft_revision_id/,
    /INSERT INTO music_admin_audit_logs/, /INSERT INTO music_mutations/]) {
    const f = fixture(), body = input(), headers = { 'Idempotency-Key': randomUUID() }, before = f.dump();
    f.state.fail = pattern;
    assert.equal((await call(f, '/tracks', 'POST', body, headers)).status, 503); assert.deepEqual(f.dump(), before);
    f.state.fail = null; f.state.skip = pattern;
    assert.equal((await call(f, '/tracks', 'POST', body, headers)).status, 409); assert.deepEqual(f.dump(), before);
    f.state.skip = null;
    assert.equal((await call(f, '/tracks', 'POST', body, headers)).status, 200);
  }
});

test('concurrent different draft edits and review-vs-save never overwrite the winning version', async () => {
  const f = fixture(), item = await create(f), body = saveInput(item);
  let winner;
  f.state.beforeWrite = async () => { winner = await call(f, `/tracks/${item.trackId}`, 'PATCH', { ...body, reason: 'Second writer' }, ifMatch(1)); };
  const loser = await call(f, `/tracks/${item.trackId}`, 'PATCH', body, ifMatch(1));
  assert.equal(winner.status, 200); assert.equal(loser.status, 409);
  const path = `/revisions/${winner.body.revisionId}/rights-review`;
  const review = await call(f, path, 'PUT', { status: 'pending', review: {}, evidenceIds: [], reason: 'Start review' }, ifMatch(2));
  assert.equal(review.status, 200);
  assert.equal((await call(f, `/tracks/${item.trackId}`, 'PATCH', { ...body, revisionId: winner.body.revisionId }, ifMatch(2))).status, 409);
});

test('rights zero-write or audit failure rolls back evidence, fingerprints and version as a unit', async () => {
  for (const pattern of [/UPDATE music_rights_reviews/, /DELETE FROM music_rights_evidence/, /INSERT INTO music_rights_evidence/,
    /UPDATE music_track_revisions SET technical/, /UPDATE music_tracks SET edit_version/, /INSERT INTO music_admin_audit_logs/, /INSERT INTO music_mutations/]) {
    const f = fixture(), cmd = await seeded(f), read = (await call(f, `/tracks/${cmd.trackId}`)).body;
    const body = { status: 'approved', review: read.rights.review, evidenceIds: read.rights.evidenceIds, reason: 'Re-review.' };
    const before = f.dump(); f.state.skip = pattern;
    const result = await call(f, `/revisions/${cmd.revisionId}/rights-review`, 'PUT', body, ifMatch(1));
    assert.equal(result.status, 409, JSON.stringify(result.body)); assert.deepEqual(f.dump(), before);
    f.state.skip = null;
    assert.equal((await call(f, `/revisions/${cmd.revisionId}/rights-review`, 'PUT', body, ifMatch(1))).status, 200);
  }
});

test('list and audit pagination are bounded, reject ambiguous query and do not expose object locators', async () => {
  const f = fixture();
  for (let i = 0; i < 52; i++) await create(f);
  const first = (await call(f, '/tracks')).body;
  assert.equal(first.items.length, 50); assert.ok(first.nextBefore);
  const next = (await call(f, `/tracks?before=${first.nextBefore}`)).body;
  assert.equal(next.items.length, 2); assert.equal(next.nextBefore, null);
  assert.equal(new Set([...first.items, ...next.items].map(r => r.id)).size, 52);
  assert.equal((await call(f, '/tracks?status=published')).body.items.length, 0);
  assert.equal((await call(f, '/tracks?status=draft&status=published')).status, 400);
  assert.equal((await call(f, '/tracks?before=wat')).status, 400);
  const audit = (await call(f, '/audit')).body;
  assert.equal(audit.items.length, 50); assert.ok(audit.nextBefore);
  assert.doesNotMatch(JSON.stringify(audit), /object_key|sha256|fingerprint|session_hash/);
});

let privateKey, publicJwk;
const config = { CF_ACCESS_TEAM_DOMAIN: 'https://fixture.cloudflareaccess.com', CF_ACCESS_AUD: 'music-test-aud', ADMIN_ALLOWED_EMAILS: actor };
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  privateKey = pair.privateKey;
  publicJwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
});
async function jwt(patch = {}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const raw = b64({ alg: 'RS256', kid: 'fixture-key' }) + '.' + b64({ iss: config.CF_ACCESS_TEAM_DOMAIN,
    aud: ['music-test-aud'], email: actor, exp: Math.floor(Date.now() / 1000) + 3600, ...patch });
  return raw + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(raw))).toString('base64url');
}
test('shared Access input parsing rejects insecure domains and malformed cookies', () => {
  assert.equal(normalizeAccessTeamDomain('fixture'), 'https://fixture.cloudflareaccess.com');
  assert.equal(normalizeAccessTeamDomain('FIXTURE.CLOUDFLAREACCESS.COM/'), 'https://fixture.cloudflareaccess.com');
  assert.equal(normalizeAccessTeamDomain('https://fixture.cloudflareaccess.com/'), 'https://fixture.cloudflareaccess.com');
  for (const domain of [
    'http://fixture.cloudflareaccess.com',
    'https://evil.example',
    'https://fixture.cloudflareaccess.com/path',
    'https://user@fixture.cloudflareaccess.com',
    'cloudflareaccess.com'
  ]) assert.equal(normalizeAccessTeamDomain(domain), '', domain);

  assert.equal(getAccessToken(new Request(origin, { headers: { Cookie: 'CF_Authorization=%broken' } })), '');
});

test('music actor contract requires a signed JWT and preserves fail-closed status codes', async () => {
  const expectCode = (promise, code, status) => assert.rejects(promise, (error) => error.code === code && error.status === status);
  await expectCode(musicAdminActor(req('/status'), {}), 'ADMIN_AUTH_UNAVAILABLE', 503);
  await expectCode(musicAdminActor(req('/status'), config), 'ADMIN_AUTH_REQUIRED', 401);

  globalThis.fetch = async () => Response.json({ keys: [publicJwk] });
  assert.equal(await musicAdminActor(req('/status', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': await jwt() }), config), actor);
  await expectCode(
    musicAdminActor(req('/status', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': await jwt({ email: 'other@example.test' }) }), config),
    'ADMIN_FORBIDDEN',
    403
  );
});

test('music actor rejects non-signing or malformed RSA keys before importKey', async () => {
  const token = await jwt();
  const request = req('/status', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': token });
  for (const patch of [{ kty: 'EC' }, { use: 'enc' }, { alg: 'PS256' }, { n: '' }, { e: '' }]) {
    globalThis.fetch = async () => Response.json({ keys: [{ ...publicJwk, ...patch }] });
    await assert.rejects(musicAdminActor(request, config), (error) => error.code === 'ADMIN_AUTH_REQUIRED' && error.status === 401);
  }
});

test('actual Worker route checks Access signature, audience, issuer, expiry and allowlist before music DB', async () => {
  const f = fixture(); let certs = 0;
  globalThis.fetch = async url => {
    assert.equal(String(url), config.CF_ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs'); certs++;
    return Response.json({ keys: [publicJwk] });
  };
  const env = { ...f.env, ...config }, token = await jwt(), before = f.dump();
  const good = await worker.fetch(req('/status', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': token }), env, {});
  assert.equal(good.status, 200); assert.equal((await good.json()).capabilities.publish, true); assert.ok(certs);
  for (const patch of [{ aud: 'other' }, { iss: 'https://wrong.cloudflareaccess.com' }, { exp: 0 }, { email: 'other@example.test' }]) {
    assert.ok([401, 403].includes((await worker.fetch(req('/status', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': await jwt(patch) }), env, {})).status));
  }
  const tampered = token.split('.'); tampered[1] = Buffer.from(JSON.stringify({ email: actor, iss: config.CF_ACCESS_TEAM_DOMAIN,
    aud: 'music-test-aud', exp: 9999999999 })).toString('base64url');
  assert.equal((await worker.fetch(req('/status', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': tampered.join('.') }), env, {})).status, 401);
  assert.deepEqual(f.dump(), before);
});

test('spoofed Host/email/local bypass and malformed Access cookie cannot bypass the music-specific actor check', async () => {
  const f = fixture(), before = f.dump();
  const env = { ...f.env, ...config, ADMIN_ACCESS_LOCAL_BYPASS: '1', READER_AUTH_DEBUG_ORIGIN: 'http://localhost:1234' };
  for (const headers of [{}, { Host: 'localhost:1234' }, { 'Cf-Access-Authenticated-User-Email': actor }, { Cookie: 'CF_Authorization=%broken' }]) {
    const r = await worker.fetch(req('/tracks', 'POST', input(), headers), env, {});
    assert.equal(r.status, 401); assert.doesNotMatch(await r.text(), /private injected|object_key/);
  }
  assert.deepEqual(f.dump(), before);
  const missing = await worker.fetch(req('/status'), { ...f.env }, {}); assert.equal(missing.status, 503);
  assert.equal(missing.headers.get('cache-control'), 'private, no-store');
  assert.equal((await missing.json()).code, 'ADMIN_AUTH_UNAVAILABLE');
  const head = await worker.fetch(req('/status', 'HEAD'), { ...f.env, ...config }, {});
  assert.equal(head.status, 401); assert.equal(await head.text(), '');
});

test('actual Worker write attributes audit to the verified JWT, not the forwarded email', async () => {
  const f = fixture();
  globalThis.fetch = async url => {
    assert.equal(String(url), config.CF_ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs');
    return Response.json({ keys: [publicJwk] });
  };
  const response = await worker.fetch(req('/tracks', 'POST', input(), { 'Cf-Access-Jwt-Assertion': await jwt(),
    'Cf-Access-Authenticated-User-Email': 'forged@example.test' }), { ...f.env, ...config }, {});
  assert.equal(response.status, 200, await response.text());
  assert.equal(f.sql.prepare('SELECT actor_id FROM music_admin_audit_logs').get().actor_id, actor);
  assert.equal(f.sql.prepare('SELECT actor_id FROM music_mutations').get().actor_id, actor);
});

test('production imports never include fixture verifier; music bindings, switches, payment and schema config remain untouched', () => {
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /music-runtime-fixture|music-runtime-worker|fixtureEvidenceProof/);
  const musicRoute = 'return handleMusicAdmin(request, env, musicAdminActor)';
  assert.ok(source.indexOf('await enforceAdminAccess(request, env)', source.indexOf('export default')) < source.indexOf(musicRoute));
  assert.match(source, /if \(isMusicAdminPath\(url\.pathname\)\) return handleMusicAdmin\(request, env, musicAdminActor\)/);
  assert.doesNotMatch(source, /handleMusicAdmin\([^\n]*getAdminActorEmail/);
  const staging = readFileSync(new URL('../src/music/stagingEntrypoint.js', import.meta.url), 'utf8');
  assert.match(staging, /import \{ musicAdminActor \} from '\.\.\/adminAccess\.js'/);
  assert.doesNotMatch(staging, /getAdminActorEmail|ADMIN_ACCESS_LOCAL_BYPASS|from '\.\.\/worker\.js'/);
  const configText = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.doesNotMatch(configText, /MUSIC_DB|MUSIC_BUCKET|MUSIC_PUBLIC_ENABLED|MUSIC_UPLOADS_ENABLED/);
});
