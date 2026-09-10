import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { handleMusicAdmin } from '../src/music/adminHttp.js';
import { executeMusicPublication } from '../src/music/publication.js';
import { seedMusicRuntimeFixture } from './helpers/music-runtime-fixture.js';
import { musicTestDatabase } from './helpers/music-test-database.mjs';

const instances = [];
afterEach(() => { for (const fixture of instances.splice(0)) fixture.sql.close(); });

function fixture() {
  const value = musicTestDatabase();
  value.env = { MUSIC_DB: value.db, MUSIC_BUCKET: { get() { throw new Error('Collections must not read R2'); } },
    WAITLIST_DB: { withSession() { throw new Error('Collections must not access memberships'); } } };
  instances.push(value);
  return value;
}

const actor = 'collections@example.test';
const origin = 'https://wwwstationcat.org';
function request(path, method = 'GET', body, headers = {}) {
  return new Request(origin + '/admin/api/music' + path, { method, headers: {
    ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin,
      'X-Requested-With': 'StationCatMusicAdmin', 'Idempotency-Key': randomUUID() }),
    ...headers
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function call(fixture, path, method = 'GET', body, headers = {}) {
  const response = await handleMusicAdmin(request(path, method, body, headers), fixture.env, async () => actor);
  return { status: response.status, body: method === 'HEAD' ? null : await response.json(), response };
}
const match = version => ({ 'If-Match': `"edit-${version}"` });
const collectionInput = (slug = `collection-${randomUUID()}`) => ({
  slug,
  originalLocale: 'zh-Hant',
  title: { 'zh-Hant': '深夜歌單', en: 'Night playlist' },
  description: { 'zh-Hant': '適合安靜工作。', en: 'For quiet work.' }
});
const saveInput = (collection, patch = {}) => ({ slug: collection.slug, originalLocale: collection.originalLocale,
  title: collection.title, description: collection.description, status: collection.status, reason: 'Update playlist.', ...patch });

async function createCollection(fixture, input = collectionInput(), headers = {}) {
  const result = await call(fixture, '/collections', 'POST', input, headers);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { ...result.body, input };
}

async function createDraftTrack(fixture) {
  const body = { slug: `draft-${randomUUID()}`, metadata: { originalLocale: 'en', title: { en: 'Draft song' },
    summary: { en: '' }, creatorName: 'Fixture', instrumental: true, language: 'instrumental', genres: [], moods: [] } };
  const result = await call(fixture, '/tracks', 'POST', body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.trackId;
}

async function publishedTrack(fixture) {
  const id = randomUUID(), audioId = randomUUID(), previewId = randomUUID();
  const base = { owner_track_id: id, state: 'validated', format: 'mp3', content_type: 'audio/mpeg', byte_size: 1000,
    sha256: 'b'.repeat(64), etag: 'synthetic-audio' };
  const command = await seedMusicRuntimeFixture(fixture.db, {
    audio: { ...base, id: audioId, kind: 'audio', object_key: `music/audio/${id}/${audioId}.mp3`, duration_ms: 120000 },
    preview: { ...base, id: previewId, kind: 'preview', object_key: `music/previews/${id}/${previewId}.mp3`, duration_ms: 30000,
      derived_from_asset_id: audioId, source_start_ms: 0, source_end_ms: 30000 }
  });
  const verifyResources = async assets => ({ checkedAt: Date.now(), assets: assets.map(asset => ({ id: asset.id,
    exists: true, etag: asset.etag, sha256: asset.sha256, byteSize: asset.byte_size,
    contentType: asset.content_type, structureValid: true, measurement: 'mp3-frames', durationMs: asset.duration_ms })) });
  await executeMusicPublication(fixture.db, command, { actorId: actor, verifyResources });
  return command.trackId;
}

test('collection creation, list, detail and replay are private, bounded and side-effect free', async () => {
  const f = fixture(), input = collectionInput(), key = randomUUID();
  const created = await createCollection(f, input, { 'Idempotency-Key': key });
  assert.equal(created.editVersion, 1); assert.equal(created.status, 'draft');
  const before = f.dump();
  const replay = await call(f, '/collections', 'POST', input, { 'Idempotency-Key': key });
  assert.equal(replay.status, 200); assert.equal(replay.body.collectionId, created.collectionId);
  assert.equal(replay.body.replayed, true); assert.deepEqual(f.dump(), before);
  assert.equal((await call(f, '/collections', 'POST', collectionInput('different'), { 'Idempotency-Key': key })).status, 409);
  assert.equal((await call(f, '/collections', 'POST', input)).status, 409);

  const detail = await call(f, `/collections/${created.collectionId}`);
  assert.equal(detail.status, 200); assert.equal(detail.response.headers.get('etag'), '"edit-1"');
  assert.deepEqual(detail.body.tracks, []); assert.deepEqual(detail.body.title, input.title);
  assert.equal(detail.response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await call(f, `/collections/${created.collectionId}`, 'HEAD')).body, null);
  const list = await call(f, '/collections?status=draft&q=night');
  assert.equal(list.body.items.length, 1); assert.equal(list.body.items[0].trackCount, 0);
  assert.doesNotMatch(JSON.stringify(list.body), /object_key|sha256|fingerprint|canPlayFull/);
});

test('collection input rejects unknown fields, bad locale, slug, translations and ambiguous query', async () => {
  const f = fixture(), before = f.dump(), valid = collectionInput();
  const bad = [
    { ...valid, unknown: true },
    { ...valid, slug: 'Bad Slug' },
    { ...valid, originalLocale: 'xx' },
    { ...valid, title: { en: 'Missing original' } },
    { ...valid, title: { ...valid.title, 'zh-Hant': 'x'.repeat(121) } },
    { ...valid, description: { ...valid.description, xx: 'Unknown locale' } }
  ];
  for (const input of bad) assert.ok([400, 422].includes((await call(f, '/collections', 'POST', input)).status));
  assert.equal((await call(f, '/collections?status=draft&status=published')).status, 400);
  assert.equal((await call(f, '/collections?before=wat')).status, 400);
  assert.deepEqual(f.dump(), before);
});

test('published collection lifecycle and order update catalogVersion without changing track access', async () => {
  const f = fixture(), collection = await createCollection(f), draftId = await createDraftTrack(f), vipId = await publishedTrack(f);
  const policyBefore = f.sql.prepare('SELECT access_mode,policy_version FROM music_track_revisions WHERE track_id=? AND state=\'sealed\'').get(vipId);
  let current = (await call(f, `/collections/${collection.collectionId}`)).body;
  let result = await call(f, `/collections/${current.id}/tracks`, 'PUT', { trackIds: [draftId, vipId], reason: 'Initial order.' }, match(1));
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.catalogVersion, 1);
  current = (await call(f, `/collections/${current.id}`)).body;
  result = await call(f, `/collections/${current.id}`, 'PATCH', saveInput(current, { status: 'published', reason: 'Publish playlist.' }), match(2));
  assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.catalogVersion, 2);
  current = (await call(f, `/collections/${current.id}`)).body;
  result = await call(f, `/collections/${current.id}/tracks`, 'PUT', { trackIds: [vipId, draftId], reason: 'Reorder.' }, match(3));
  assert.equal(result.status, 200); assert.equal(result.body.catalogVersion, 3);
  current = (await call(f, `/collections/${current.id}`)).body;
  assert.deepEqual(current.tracks.map(track => track.id), [vipId, draftId]);
  assert.deepEqual(f.sql.prepare('SELECT access_mode,policy_version FROM music_track_revisions WHERE track_id=? AND state=\'sealed\'').get(vipId), policyBefore);

  const renamed = { ...current.title, 'zh-Hant': '深夜工作歌單' };
  result = await call(f, `/collections/${current.id}`, 'PATCH', saveInput(current, { title: renamed, reason: 'Rename title.' }), match(4));
  assert.equal(result.status, 200); assert.equal(result.body.catalogVersion, 4);
  current = (await call(f, `/collections/${current.id}`)).body;
  assert.equal((await call(f, `/collections/${current.id}`, 'PATCH', saveInput(current, { status: 'archived' }), match(5))).body.code,
    'MUSIC_COLLECTION_UNPUBLISH_FIRST');
  result = await call(f, `/collections/${current.id}`, 'PATCH', saveInput(current, { status: 'draft', reason: 'Unpublish.' }), match(5));
  assert.equal(result.body.catalogVersion, 5);
  current = (await call(f, `/collections/${current.id}`)).body;
  result = await call(f, `/collections/${current.id}`, 'PATCH', saveInput(current, { status: 'archived', reason: 'Archive.' }), match(6));
  assert.equal(result.status, 200); assert.equal(result.body.catalogVersion, 5);
  assert.equal((await call(f, `/collections/${current.id}/tracks`, 'PUT', { trackIds: [], reason: 'No resurrection.' }, match(7))).body.code,
    'MUSIC_COLLECTION_ARCHIVED');
});

test('empty, duplicate, unknown and archived track sets fail closed', async () => {
  const f = fixture(), collection = await createCollection(f), publishedId = await publishedTrack(f);
  let current = (await call(f, `/collections/${collection.collectionId}`)).body;
  assert.equal((await call(f, `/collections/${current.id}`, 'PATCH', saveInput(current, { status: 'published' }), match(1))).body.code,
    'MUSIC_COLLECTION_EMPTY');
  assert.equal((await call(f, `/collections/${current.id}/tracks`, 'PUT', { trackIds: [publishedId, publishedId], reason: 'Duplicate.' }, match(1))).status, 422);
  assert.equal((await call(f, `/collections/${current.id}/tracks`, 'PUT', { trackIds: [randomUUID()], reason: 'Unknown.' }, match(1))).body.code,
    'MUSIC_COLLECTION_TRACK_INVALID');
  const archivedId = randomUUID(), now = Date.now();
  f.sql.prepare("INSERT INTO music_tracks(id,slug,lifecycle,created_at,updated_at) VALUES(?,?,'archived',?,?)")
    .run(archivedId, `archived-${archivedId}`, now, now);
  assert.equal((await call(f, `/collections/${current.id}/tracks`, 'PUT', { trackIds: [archivedId], reason: 'Archived.' }, match(1))).body.code,
    'MUSIC_COLLECTION_TRACK_INVALID');
  await call(f, `/collections/${current.id}/tracks`, 'PUT', { trackIds: [publishedId], reason: 'Valid.' }, match(1));
  current = (await call(f, `/collections/${current.id}`)).body;
  await call(f, `/collections/${current.id}`, 'PATCH', saveInput(current, { status: 'published' }), match(2));
  current = (await call(f, `/collections/${current.id}`)).body;
  assert.equal((await call(f, `/collections/${current.id}/tracks`, 'PUT', { trackIds: [], reason: 'Would empty public playlist.' }, match(3))).body.code,
    'MUSIC_COLLECTION_EMPTY');
});

test('collection identity, If-Match and Origin protections reject writes before mutation', async () => {
  const f = fixture(), collection = await createCollection(f), current = (await call(f, `/collections/${collection.collectionId}`)).body;
  const before = f.dump(), body = saveInput(current);
  assert.equal((await call(f, `/collections/${current.id}`, 'PATCH', body)).status, 428);
  assert.equal((await call(f, `/collections/${current.id}`, 'PATCH', body, { ...match(1), Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(f, `/collections/${current.id}`, 'PATCH', { ...body, slug: 'renamed' }, match(1))).body.code,
    'MUSIC_COLLECTION_IDENTITY');
  assert.equal((await call(f, `/collections/${current.id}`, 'PATCH', body, match(2))).body.code, 'MUSIC_COLLECTION_CONFLICT');
  assert.deepEqual(f.dump(), before);
});

test('collection order transaction rolls back every zero-write and can retry the same key', async () => {
  for (const pattern of [/DELETE FROM music_collection_tracks/, /INSERT INTO music_collection_tracks/, /UPDATE music_collections SET version/,
    /INSERT INTO music_admin_audit_logs/, /INSERT INTO music_mutations/]) {
    const f = fixture(), collection = await createCollection(f), first = await createDraftTrack(f), second = await createDraftTrack(f);
    await call(f, `/collections/${collection.collectionId}/tracks`, 'PUT', { trackIds: [first], reason: 'Seed order.' }, match(1));
    const before = f.dump(), key = randomUUID(), body = { trackIds: [second, first], reason: 'Atomic order.' };
    f.state.skip = pattern;
    const failed = await call(f, `/collections/${collection.collectionId}/tracks`, 'PUT', body,
      { ...match(2), 'Idempotency-Key': key });
    assert.equal(failed.status, 409, `${pattern}: ${JSON.stringify(failed.body)}`); assert.deepEqual(f.dump(), before);
    f.state.skip = null;
    assert.equal((await call(f, `/collections/${collection.collectionId}/tracks`, 'PUT', body,
      { ...match(2), 'Idempotency-Key': key })).status, 200);
  }
});

test('competing collection saves never overwrite the winning version', async () => {
  const f = fixture(), collection = await createCollection(f), current = (await call(f, `/collections/${collection.collectionId}`)).body;
  let winner;
  f.state.beforeWrite = async () => {
    winner = await call(f, `/collections/${current.id}`, 'PATCH', saveInput(current, { description: { 'zh-Hant': '先到的修改。' } }), match(1));
  };
  const loser = await call(f, `/collections/${current.id}`, 'PATCH', saveInput(current, { description: { 'zh-Hant': '後到的修改。' } }), match(1));
  assert.equal(winner.status, 200); assert.equal(loser.status, 409);
  const saved = (await call(f, `/collections/${current.id}`)).body;
  assert.equal(saved.description['zh-Hant'], '先到的修改。'); assert.equal(saved.editVersion, 2);
});

test('collection publish rechecks visible tracks inside the transaction guard', async () => {
  const f = fixture(), collection = await createCollection(f), trackId = await publishedTrack(f);
  await call(f, `/collections/${collection.collectionId}/tracks`, 'PUT', { trackIds: [trackId], reason: 'Prepare publish.' }, match(1));
  const current = (await call(f, `/collections/${collection.collectionId}`)).body;
  const track = (await call(f, `/tracks/${trackId}`)).body;
  f.state.beforeWrite = async () => {
    const result = await call(f, `/tracks/${trackId}/unpublish`, 'POST',
      { revisionId: track.published.id, reason: 'Concurrent downlist.' }, match(track.editVersion));
    assert.equal(result.status, 200, JSON.stringify(result.body));
  };
  const result = await call(f, `/collections/${current.id}`, 'PATCH',
    saveInput(current, { status: 'published', reason: 'Must see current track state.' }), match(2));
  assert.equal(result.status, 409); assert.equal(result.body.code, 'MUSIC_COLLECTION_CONFLICT');
  assert.equal((await call(f, `/collections/${current.id}`)).body.status, 'draft');
});

test('collection pagination stays at 50 and audit records lifecycle and exact order', async () => {
  const f = fixture();
  for (let index = 0; index < 52; index++) await createCollection(f, collectionInput(`set-${String(index).padStart(2, '0')}`));
  const first = (await call(f, '/collections')).body, second = (await call(f, `/collections?before=${first.nextBefore}`)).body;
  assert.equal(first.items.length, 50); assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 52);
  const trackId = await createDraftTrack(f), collection = first.items[0];
  await call(f, `/collections/${collection.id}/tracks`, 'PUT', { trackIds: [trackId], reason: 'Audit exact order.' }, match(1));
  const audit = (await call(f, '/audit')).body.items.find(item => item.action === 'music.collection.tracks');
  assert.deepEqual(audit.summary.trackIds, [trackId]); assert.equal(audit.targetId, collection.id);
});
