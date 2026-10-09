import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createStationMediaUploader, createStationMediaJournal, mediaFileFormat } from '../src/scripts/stationMediaUploader.js';

const actor = 'fixture@example.test', ownerId = randomUUID();
const file = () => new File([new TextEncoder().encode('client file, structural validation is server-side')], 'example.mp4', { type: 'video/mp4' });
function harness() {
  const storageMap = new Map(), calls = [], receipts = new Map();
  const storage = { getItem: k => storageMap.get(k) || null, setItem: (k,v) => storageMap.set(k,v) };
  const state = { actorId: actor, enabled: true, fail: null, upload: null, reserved: 0, puts: 0, confirmed: 0, switchAfterReserve: false };
  const journal = { get: () => createStationMediaJournal(storage, actor).get() };
  const requester = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET', key: options.key });
    if (path === '/site-uploads/status') return { actorId: state.actorId, enabled: state.enabled };
    if (path === '/site-uploads') {
      assert.equal(journal.get().jobs.at(-1).stage, 'reserving');
      if (!receipts.has(options.key)) { state.reserved++; state.upload = { uploadId: randomUUID(), assetId: randomUUID(), status: 'reserved', phase: 'uploading', expired: false }; receipts.set(options.key, structuredClone(state.upload)); }
      if (state.switchAfterReserve) state.actorId = 'other@example.test';
      if (state.fail === 'reserve') { state.fail = null; throw Object.assign(new Error('lost reserve response'), { uncertain: true }); }
      return receipts.get(options.key);
    }
    if (path.endsWith('/body')) {
      assert.equal(journal.get().jobs.at(-1).stage, 'writing'); state.puts++; state.upload.status = 'uploaded';
      if (state.fail === 'body') { state.fail = null; throw Object.assign(new Error('lost body response'), { uncertain: true }); }
      return structuredClone(state.upload);
    }
    if (path.endsWith('/complete')) {
      assert.equal(journal.get().jobs.at(-1).stage, 'validating');
      if (state.fail === 'complete') { state.fail = null; throw Object.assign(new Error('temporary storage failure'), { code: 'STATION_MEDIA_STORAGE_UNAVAILABLE', uncertain: true }); }
      if (state.fail === 'corrupt') { state.fail = null; state.upload.status = 'rejected'; state.upload.phase = 'failed'; throw Object.assign(new Error('rejected'), { code: 'STATION_VIDEO_STRUCTURE_INVALID', status: 422 }); }
      state.confirmed++; state.upload.status = 'completed'; state.upload.phase = 'ready'; return structuredClone(state.upload);
    }
    return structuredClone(state.upload);
  };
  const build = () => createStationMediaUploader({ actorId: actor, journal: createStationMediaJournal(storage, actor), requester });
  return { storage, calls, journal, state, controller: build(), build, start: c => c.start({ file: file(), ownerId, kind: 'short_video' }) };
}
test('client only admits bounded supported files and treats extension as a local hint', () => {
  assert.equal(mediaFileFormat('short_video', file()).type, 'video/mp4');
  assert.throws(() => mediaFileFormat('mv', { name: 'v.webm', size: 10 }));
  assert.throws(() => mediaFileFormat('short_video', { name: 'v.mp4', size: 268435457 }));
  assert.equal(mediaFileFormat('poster', { name: 'cover.JPG', size: 10 }).format, 'jpeg');
});
test('ordinary upload persists each phase before its mutation and uses three stable keys', async () => {
  const f = harness(), result = await f.start(f.controller); assert.equal(result.stage, 'completed');
  assert.equal(f.state.reserved, 1); assert.equal(f.state.puts, 1); assert.equal(f.state.confirmed, 1);
  assert.equal(new Set(f.calls.filter(c => c.method !== 'GET').map(c => c.key)).size, 3);
  assert.doesNotMatch(JSON.stringify(f.journal.get()), /video\/mp4|CF_Authorization|https?:\/\//);
});
test('lost reservation receipt is recovered with the original key after a reload, without duplicate assets', async () => {
  const f = harness(); f.state.fail = 'reserve'; await assert.rejects(f.start(f.controller));
  const old = f.controller.jobs()[0], fresh = f.build();
  await assert.rejects(f.start(fresh), /当前上传/);
  const waiting = await fresh.recover(old.id); assert.equal(waiting.stage, 'reserved');
  const ready = await fresh.recover(old.id, file()); assert.equal(ready.stage, 'completed');
  assert.equal(f.state.reserved, 1); assert.equal(f.state.puts, 1);
  assert.equal(new Set(f.calls.filter(c => c.path === '/site-uploads').map(c => c.key)).size, 1);
});
test('lost PUT receipt is only queried/confirmed after reload, never resent to the stored object', async () => {
  const f = harness(); f.state.fail = 'body'; await assert.rejects(f.start(f.controller));
  const saved = f.controller.jobs()[0], fresh = f.build();
  assert.equal((await fresh.recover(saved.id)).stage, 'completed'); assert.equal(f.state.puts, 1); assert.equal(f.state.reserved, 1);
});
test('transient confirmation failure preserves its key and retries the same asset', async () => {
  const f = harness(); f.state.fail = 'complete'; await assert.rejects(f.start(f.controller)); const job = f.controller.jobs()[0];
  await f.controller.recover(job.id); assert.equal(f.state.puts, 1); assert.equal(f.state.reserved, 1);
  assert.equal(new Set(f.calls.filter(c => c.path.endsWith('/complete')).map(c => c.key)).size, 1);
});
test('another file cannot resume a reserved upload, while a confirmed rejection allows a fresh version', async () => {
  const f = harness(); f.state.fail = 'reserve'; await assert.rejects(f.start(f.controller)); const job = f.controller.jobs()[0];
  await f.controller.recover(job.id);
  await assert.rejects(f.controller.recover(job.id, new File(['different'], 'example.mp4')), /原文件/); assert.equal(f.state.puts, 0);
  f.state.fail = 'corrupt'; await assert.rejects(f.controller.recover(job.id, file()));
  assert.equal((await f.controller.recover(job.id)).stage, 'rejected');
  const next = await f.start(f.controller); assert.equal(next.stage, 'completed'); assert.notEqual(next.uploadId, job.uploadId);
});
test('a session switch after reservation blocks body upload without rebinding the journal to another actor', async () => {
  const f = harness(); f.state.switchAfterReserve = true;
  await assert.rejects(f.start(f.controller), { code: 'STATION_MEDIA_ACTOR_CHANGED' }); assert.equal(f.state.puts, 0);
  assert.equal(createStationMediaJournal(f.storage, 'other@example.test').get().jobs.length, 0);
  assert.equal(f.controller.jobs().length, 1);
});
test('unavailable or malformed local recovery storage prevents mutations and is not silently reset', () => {
  assert.throws(() => createStationMediaJournal({ getItem: () => null, setItem() { throw new Error('storage unavailable'); } }, actor));
  assert.throws(() => createStationMediaJournal({ getItem: () => '{"jobs":[{"id":"broken"}]}', setItem() {} }, actor), /恢复记录/);
});
