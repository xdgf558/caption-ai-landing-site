import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { randomUUID } from 'node:crypto';
import { musicTestDatabase } from './helpers/music-test-database.mjs';
import { createAdminMusicTrack } from '../src/music/admin.js';
import { createMusicUpload, completeMusicUpload, uploadReadiness } from '../src/music/uploads.js';
import { planMusicCleanup, executeMusicCleanup, CLEANUP_RETENTION_MS } from '../src/music/cleanup.js';
import { handleMusicAdmin } from '../src/music/adminHttp.js';
import { readAdminMusicAsset } from '../src/music/adminAssets.js';

const instances = [], actorId = 'cleanup@example.test', now = Date.now();
afterEach(() => { for (const f of instances.splice(0)) f.sql.close(); });
const ctx = (time = now) => ({ actorId, key: randomUUID(), clock: () => time });
async function fixture(kind = 'lyrics', age = CLEANUP_RETENTION_MS + 86400001) {
  const f = musicTestDatabase(); instances.push(f);
  f.sql.exec("UPDATE music_settings SET value_json='10000000' WHERE key='storageQuotaBytes'");
  f.track = await createAdminMusicTrack(f.db,{ slug: `cleanup-${randomUUID()}`, metadata: { originalLocale: 'en',
    title: { en: 'Cleanup fixture' }, summary: { en: '' }, creatorName: 'Fixture', instrumental: true,
    language: 'instrumental', genres: [], moods: [] } },ctx(now - age));
  f.command = { trackId: f.track.trackId, kind, format: kind === 'audio' ? 'mp3' : kind === 'evidence' ? 'pdf' : 'txt',
    byteSize: 6, sha256: 'a'.repeat(64) };
  f.upload = await createMusicUpload(f.db,f.command,ctx(now - age));
  f.asset = f.sql.prepare('SELECT * FROM music_assets WHERE id=?').get(f.upload.assetId);
  f.objects = new Map(); f.calls = [];
  f.bucket = { get() { assert.fail('cleanup must not read object bodies'); },
    async head(key) { f.calls.push(['head',key]); await f.beforeHead?.(key); return f.objects.get(key) ?? null; },
    async delete(key) { f.calls.push(['delete',key]); await f.beforeDelete?.(key); f.objects.delete(key); await f.afterDelete?.(key); } };
  f.start = () => {
    f.sql.prepare("UPDATE music_upload_sessions SET status='uploading',write_token=? WHERE id=?").run(randomUUID(),f.upload.uploadId);
    f.sql.prepare("UPDATE music_assets SET state='uploading' WHERE id=?").run(f.asset.id);
  };
  f.put = () => f.objects.set(f.asset.object_key,{ key: f.asset.object_key, size: 6, etag: 'fixture-etag', version: 'fixture-version',
    httpMetadata: { contentType: f.asset.content_type }, customMetadata: { musicUpload: f.upload.uploadId, musicAsset: f.asset.id } });
  f.complete = () => {
    f.start(); f.put();
    f.sql.prepare("UPDATE music_assets SET state='validated',byte_size=6,sha256=?,etag='fixture-etag',duration_ms=? WHERE id=?")
      .run(f.command.sha256,kind === 'audio' ? 1000 : null,f.asset.id);
    f.sql.prepare("UPDATE music_upload_sessions SET status='completed',actual_bytes=6 WHERE id=?").run(f.upload.uploadId);
  };
  f.plan = async () => (await planMusicCleanup(f.db,{},ctx())).items.find(i => i.uploadId === f.upload.uploadId);
  f.input = async () => ({ planHash: (await f.plan()).planHash, reason: 'Remove expired unreferenced fixture.' });
  f.execute = async (input,context = ctx()) => executeMusicCleanup(f.db,f.bucket,f.upload.uploadId,input ?? await f.input(),context);
  return f;
}

test('dry-run is read-only, bounded, private metadata with reference evidence and seven-day retention', async () => {
  const f = await fixture(), before = f.dump(), plan = await f.plan();
  assert.equal(plan.blockedReason,null); assert.equal(plan.writerEvidence,'never_started');
  assert.equal(plan.objectKey,f.asset.object_key); assert.match(plan.planHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(plan.references,{ revision: false, evidence: false, rights: false, derived: false, audit: false });
  assert.doesNotMatch(JSON.stringify(plan),/write_token|expected_sha256/);
  assert.deepEqual(f.dump(),before); assert.equal(f.calls.length,0);
  const fresh = await fixture('lyrics',86400001);
  assert.equal((await fresh.plan()).blockedReason,'RETENTION_PENDING');
  await assert.rejects(fresh.execute({ planHash: 'a'.repeat(64),reason: 'Too early' }),{ code: 'RETENTION_PENDING' });
  for (let i=0;i<27;i++) await createMusicUpload(f.db,f.command,{ ...ctx(now - CLEANUP_RETENTION_MS - 86400001), actorId: `page-${i}@example.test` });
  const page = await planMusicCleanup(f.db,{},ctx());
  assert.equal(page.items.length,25); assert.ok(page.nextBefore);
  const next = await planMusicCleanup(f.db,{ before: page.nextBefore },ctx());
  assert.equal(next.items.length,3); assert.equal(next.nextBefore,null);
});

test('never-started retirement releases quota once while retaining sessions, assets and audit receipts', async () => {
  const f = await fixture(), input = await f.input(), sessionBefore = f.sql.prepare('SELECT * FROM music_upload_sessions').get();
  assert.equal((await uploadReadiness(f.db)).chargedBytes,6);
  const result = await f.execute(input);
  assert.equal(result.cleanupState,'released'); assert.equal(result.releasedBytes,6);
  assert.equal((await uploadReadiness(f.db)).chargedBytes,0);
  assert.deepEqual(f.sql.prepare('SELECT * FROM music_upload_sessions').get(),sessionBefore);
  assert.equal(f.calls.filter(c => c[0] === 'delete').length,0);
  const calls = f.calls.length; assert.equal((await f.execute(input)).replayed,true); assert.equal(f.calls.length,calls);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='music.cleanup.release'").get().n,1);
  await assert.rejects(completeMusicUpload(f.db,f.bucket,f.upload.uploadId,{},ctx()),{ code: 'UPLOAD_RETIRED' });
});

test('started but absent object stays charged; a late committed object is proved then deleted on resume', async () => {
  const f = await fixture(); f.start(); const input = await f.input();
  const pending = await f.execute(input);
  assert.equal(pending.code,'CLEANUP_WRITE_UNCONFIRMED'); assert.equal(pending.chargedBytes,6);
  assert.equal(f.sql.prepare('SELECT proof_json FROM music_upload_cleanup').get().proof_json,null);
  f.put();
  f.beforeDelete = () => assert.equal(JSON.parse(f.sql.prepare('SELECT proof_json FROM music_upload_cleanup').get().proof_json).kind,'object_observed');
  assert.equal((await f.execute(input)).cleanupState,'released');
  assert.equal(f.objects.size,0); assert.equal((await uploadReadiness(f.db)).chargedBytes,0);
});

test('completed unreferenced bytes can be reclaimed; retired assets cannot be downloaded or reattached', async () => {
  const f = await fixture(); f.complete(); const input = await f.input();
  assert.equal((await f.execute(input)).cleanupState,'released');
  await assert.rejects(readAdminMusicAsset(f.db,f.bucket,f.asset.id,new Request('https://fixture.test/admin')),{ code: 'NOT_FOUND' });
  assert.throws(() => f.sql.prepare('UPDATE music_track_revisions SET lyrics_asset_id=? WHERE id=?').run(f.asset.id,f.track.revisionId),/MUSIC_ASSET_RETIRED/);
  assert.throws(() => f.sql.prepare('INSERT OR REPLACE INTO music_upload_cleanup SELECT * FROM music_upload_cleanup').run());
  for (const sql of ['DELETE FROM music_upload_cleanup','UPDATE music_upload_cleanup SET released_at=NULL',
    'UPDATE music_upload_cleanup SET proof_json=NULL,proved_at=NULL','DELETE FROM music_upload_sessions']) assert.throws(() => f.sql.exec(sql));
});

test('all historical revisions, rights JSON, evidence, derivatives and substantive audits retain bytes', async () => {
  for (const ref of ['revision','rights','evidence','derived','audit']) {
    const f = await fixture(ref === 'evidence' ? 'evidence' : ref === 'derived' ? 'audio' : 'lyrics'); f.complete();
    const input = await f.input();
    if (ref === 'revision') f.sql.prepare('UPDATE music_track_revisions SET lyrics_asset_id=? WHERE id=?').run(f.asset.id,f.track.revisionId);
    if (ref === 'rights' || ref === 'evidence') {
      const review = randomUUID();
      f.sql.prepare('INSERT INTO music_rights_reviews(id,revision_id,review_json) VALUES(?,?,?)')
        .run(review,f.track.revisionId,JSON.stringify(ref === 'rights' ? { exceptionEvidenceAssetId: f.asset.id } : {}));
      if (ref === 'evidence') f.sql.prepare('INSERT INTO music_rights_evidence(review_id,asset_id) VALUES(?,?)').run(review,f.asset.id);
    }
    if (ref === 'derived') {
      const id = randomUUID();
      f.sql.prepare(`INSERT INTO music_assets(id,owner_track_id,kind,object_key,content_type,format,derived_from_asset_id,created_at)
        VALUES(?,?,'preview',?,'audio/mpeg','mp3',?,?)`).run(id,f.track.trackId,`music/previews/${f.track.trackId}/${id}.mp3`,f.asset.id,now);
    }
    if (ref === 'audit') f.sql.prepare(`INSERT INTO music_admin_audit_logs(id,actor_id,action,target_id,summary_json,request_id,created_at)
      VALUES(?,?,'music.rights.review',?,?,?,?)`).run(randomUUID(),actorId,f.track.trackId,JSON.stringify({ evidenceIds: [f.asset.id] }),randomUUID(),now);
    assert.equal((await f.plan()).blockedReason,'ASSET_REFERENCED',ref);
    await assert.rejects(f.execute(input),{ code: 'ASSET_REFERENCED' }); assert.equal(f.calls.length,0);
    assert.equal((await uploadReadiness(f.db)).chargedBytes,6);
  }
});

test('a reference added between plan validation and claim wins without touching R2', async () => {
  const f = await fixture(), input = await f.input();
  f.state.beforeWrite = () => f.sql.prepare('UPDATE music_track_revisions SET lyrics_asset_id=? WHERE id=?').run(f.asset.id,f.track.revisionId);
  await assert.rejects(f.execute(input));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_upload_cleanup').get().n,0); assert.equal(f.calls.length,0);
});

test('retirement wins against every new reference path and the old upload writer', async () => {
  const f = await fixture('audio'); f.start(); await f.execute();
  const revision = randomUUID(), asset = randomUUID(), review = randomUUID();
  const attempts = [
    () => f.sql.prepare(`INSERT INTO music_track_revisions(id,track_id,revision_no,audio_asset_id,created_at) VALUES(?,?,2,?,?)`).run(revision,f.track.trackId,f.asset.id,now),
    () => f.sql.prepare(`INSERT INTO music_assets(id,owner_track_id,kind,object_key,content_type,format,derived_from_asset_id,created_at)
      VALUES(?,?,'preview',?,'audio/mpeg','mp3',?,?)`).run(asset,f.track.trackId,`music/previews/${f.track.trackId}/${asset}.mp3`,f.asset.id,now),
    () => f.sql.prepare('INSERT INTO music_rights_reviews(id,revision_id,review_json) VALUES(?,?,?)').run(review,f.track.revisionId,JSON.stringify({ exceptionEvidenceAssetId: f.asset.id })),
    () => f.sql.prepare("UPDATE music_upload_sessions SET status='rejected' WHERE id=?").run(f.upload.uploadId),
    () => f.sql.prepare("UPDATE music_assets SET state='rejected' WHERE id=?").run(f.asset.id),
    () => f.sql.prepare(`INSERT INTO music_admin_audit_logs(id,actor_id,action,target_id,summary_json,request_id,created_at)
      VALUES(?,?,'music.rights.review',?,?,?,?)`).run(randomUUID(),actorId,f.track.trackId,JSON.stringify({ evidenceIds: [f.asset.id] }),randomUUID(),now)
  ];
  for (const attempt of attempts) assert.throws(attempt,/MUSIC_ASSET_RETIRED/);
});

test('stale writer snapshot, unknown input and mismatched plan cannot retire or touch storage', async () => {
  const f = await fixture(), input = await f.input(); f.start();
  await assert.rejects(f.execute(input),{ code: 'CLEANUP_PLAN_STALE' });
  await assert.rejects(f.execute({ ...input,objectKey: 'other/object' }),{ code: 'INVALID_INPUT' });
  assert.equal(f.calls.length,0); assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_upload_cleanup').get().n,0);
});

test('claim/proof/final accounting roll back on zero-write receipts and recover without duplicate release', async () => {
  const f = await fixture(), input = await f.input(), before = f.dump();
  f.state.skip = /INSERT INTO music_mutations/;
  await assert.rejects(f.execute(input)); assert.deepEqual(f.dump(),before); assert.equal(f.calls.length,0);
  f.state.skip = null; f.state.lose = true;
  assert.equal((await f.execute(input)).cleanupState,'released');
  assert.equal((await uploadReadiness(f.db)).chargedBytes,0);
});

test('lost delete acknowledgement keeps charge until a retry proves absence using persisted proof', async () => {
  const f = await fixture(); f.complete(); const input = await f.input();
  f.afterDelete = () => { f.afterDelete = null; throw new Error('lost deletion acknowledgement'); };
  await assert.rejects(f.execute(input),{ code: 'CLEANUP_STORAGE_UNAVAILABLE' });
  assert.equal(f.objects.size,0); assert.equal((await uploadReadiness(f.db)).chargedBytes,6);
  assert.equal((await f.execute(input)).cleanupState,'released');
  assert.equal(f.calls.filter(c => c[0] === 'delete').length,1);
});

test('deletion succeeds but accounting failure retains charge and retries the final transaction', async () => {
  const f = await fixture(); f.complete(); const input = await f.input();
  f.state.fail = /UPDATE music_upload_cleanup SET released_at/;
  await assert.rejects(f.execute(input)); assert.equal(f.objects.size,0);
  assert.equal((await uploadReadiness(f.db)).chargedBytes,6);
  f.state.fail = null; assert.equal((await f.execute(input)).releasedBytes,6);
});

test('four competing executors release once and no retry reuses a retired upload', async () => {
  const f = await fixture(); f.complete(); const input = await f.input();
  const outcomes = await Promise.all(Array.from({ length: 4 },() => f.execute(input)));
  assert.ok(outcomes.every(o => o.cleanupState === 'released'));
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='music.cleanup.release'").get().n,1);
  assert.equal((await uploadReadiness(f.db)).chargedBytes,0);
  await assert.rejects(f.execute({ ...input,reason: 'Different command' }),{ code: 'IDEMPOTENCY_CONFLICT' });
});

test('unknown/mismatched objects, changed versions and failed HEAD never free quota or delete blindly', async () => {
  const unstarted = await fixture(); unstarted.put();
  await assert.rejects(unstarted.execute(),{ code: 'CLEANUP_OBJECT_MISMATCH' });
  const f = await fixture(); f.start(); f.put(); const input = await f.input();
  f.beforeHead = () => {
    if (f.calls.filter(c => c[0] === 'head').length === 2) f.objects.get(f.asset.object_key).version = 'replaced';
  };
  await assert.rejects(f.execute(input),{ code: 'CLEANUP_OBJECT_CHANGED' });
  assert.equal(f.calls.filter(c => c[0] === 'delete').length,0);
  assert.equal((await uploadReadiness(f.db)).chargedBytes,6);
  const failed = await fixture(); failed.beforeHead = () => { throw new Error('private R2 failure'); };
  await assert.rejects(failed.execute(),{ code: 'CLEANUP_STORAGE_UNAVAILABLE' });
  assert.equal((await uploadReadiness(failed.db)).chargedBytes,6);
});

test('storage timeout leaves a recoverable retired reservation and consumes late promise errors', async () => {
  const f = await fixture(), input = await f.input(); let reject;
  f.beforeHead = () => new Promise((_,r) => { reject = r; });
  await assert.rejects(f.execute(input,{ ...ctx(),storageTimeoutMs: 5 }),{ code: 'CLEANUP_STORAGE_TIMEOUT' });
  reject(new Error('late failure')); f.beforeHead = null;
  assert.equal((await uploadReadiness(f.db)).chargedBytes,6);
  assert.equal((await f.execute(input)).cleanupState,'released');
});

test('HTTP requires Access, same-origin, explicit execution flag and idempotency; dry-run stays read-only', async () => {
  const f = await fixture(), input = await f.input(), env = { MUSIC_DB: f.db,MUSIC_BUCKET: f.bucket };
  const request = (method = 'GET',suffix = '',headers = {}) => new Request(`https://fixture.test/admin/api/music/cleanup${suffix}`,{
    method,headers: { Origin: 'https://fixture.test','X-Requested-With': 'StationCatMusicAdmin',
      'Content-Type': 'application/json','Idempotency-Key': randomUUID(),...headers },
    ...(method === 'GET' ? {} : { body: JSON.stringify(input) }) });
  const denied = await handleMusicAdmin(request(),new Proxy({}, { get() { assert.fail('unauthorized request touched bindings'); } }),async () => null);
  assert.equal(denied.status,401);
  const before = f.dump(); const dryRun = await handleMusicAdmin(request(),env,async () => actorId);
  assert.equal(dryRun.status,200); assert.equal(dryRun.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(f.dump(),before);
  const disabled = await handleMusicAdmin(request('POST',`/${f.upload.uploadId}`),env,async () => actorId);
  assert.equal((await disabled.json()).code,'MUSIC_CLEANUP_DISABLED'); assert.equal(f.calls.length,0);
  const enabled = { ...env,MUSIC_CLEANUP_ENABLED: 'true' };
  assert.equal((await handleMusicAdmin(request('POST',`/${f.upload.uploadId}`,{ Origin: 'https://evil.test' }),enabled,async () => actorId)).status,403);
  assert.equal((await handleMusicAdmin(request('POST',`/${f.upload.uploadId}`,{ 'Idempotency-Key': '' }),enabled,async () => actorId)).status,400);
  const done = await handleMusicAdmin(request('POST',`/${f.upload.uploadId}`),enabled,async () => actorId);
  assert.equal(done.status,200); assert.equal((await done.json()).cleanupState,'released');
});
