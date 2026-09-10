import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import mpeg from 'mp3-parser/lib/lib.js';
import { inspectMp3 } from '../src/music/mp3.js';
import { MP3_LIMITS } from '../src/music/mp3Stream.js';
import { verifyMusicAudioAsset, validateMeasuredPreview } from '../src/music/audioValidation.js';
import { verifyPublicationResources } from '../src/music/publicationValidation.js';

const fixtures = new URL('../tests/fixtures/music-mp3/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixtures)));
const bytes = name => readFileSync(new URL(`${name}.mp3`, fixtures));
const raw = bytes('raw');
const full = bytes('cbr-stereo');
const digest = b => createHash('sha256').update(b).digest('hex');
function stream(data, size = 16384, state = {}) {
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset === data.length) { controller.close(); return; }
    const end = Math.min(data.length, offset + size);
    controller.enqueue(data.subarray(offset, end)); offset = end;
  }, cancel() { state.cancelled = true; } }, { highWaterMark: 0 });
}
const inspect = (data, options = {}, size) => inspectMp3(stream(data, size), { kind: 'audio', expectedBytes: data.length,
  contentType: 'audio/mpeg', ...options });
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);
const synchsafe = size => [size >>> 21 & 127, size >>> 14 & 127, size >>> 7 & 127, size & 127];
function id3(payload, version = 4, footer = false) {
  const header = Buffer.from([73, 68, 51, version, 0, footer ? 16 : 0, ...synchsafe(payload.length)]);
  const end = Buffer.from(header); end.set([51, 68, 73]);
  return Buffer.concat([header, payload, ...(footer ? [end] : [])]);
}
function positions(data) {
  let offset = data[0] === 73 ? 10 + data[6] * 2097152 + data[7] * 16384 + data[8] * 128 + data[9] : 0;
  const result = [];
  while (offset < data.length) {
    const h = mpeg.readFrameHeader(new DataView(data.buffer, data.byteOffset + offset, data.length - offset));
    const length = mpeg.getFrameByteLength(h.bitrate, h.samplingRate, h.framePadding, h.mpegAudioVersionBits, h.layerDescriptionBits);
    result.push({ offset, length }); offset += length;
  }
  return result;
}

for (const f of manifest.files) test(`real ${f.file}: exact independent packet samples, streamed hash and bounded carry`, async () => {
  const data = readFileSync(new URL(f.file, fixtures));
  assert.equal(digest(data), f.sha256); assert.equal(data.length, f.bytes);
  const r = await inspect(data);
  assert.equal(r.frameCount, f.packetCount); assert.equal(r.sampleCount, f.packetSamples);
  assert.equal(r.durationMs, f.packetDurationMs); assert.equal(r.sampleRate, f.sampleRate);
  assert.equal(r.channels, f.channels); assert.equal(r.sha256, f.sha256);
  assert.equal(r.byteSize, data.length); assert.equal(r.measurement, 'mp3-frames');
  assert.ok(r.sampleCount >= f.decodedSamples);
  assert.ok((r.sampleCount - f.decodedSamples) * 1000 / r.sampleRate <= 250);
  assert.equal(r.bufferCapacityBytes, 67584);
});

test('VBR is traversed frame by frame, CBR padding does not alter samples', async () => {
  assert.equal((await inspect(bytes('vbr-stereo'))).vbr, true);
  assert.equal((await inspect(full)).vbr, false);
  const frames = positions(full);
  assert.ok(new Set(frames.map(f => f.length)).size > 1);
  assert.equal((await inspect(full)).sampleCount, (frames.length - 1) * 1152);
});

test('arbitrary boundaries including one-byte chunks produce identical measurements', async () => {
  const expected = await inspect(raw);
  for (const size of [1, 3, 5, 10, 127, 313, 4096, 65536]) {
    const actual = await inspect(raw, {}, size);
    assert.deepEqual({ ...actual, reads: 0 }, { ...expected, reads: 0 });
  }
});

test('ID3v2.3/v2.4 payload is skipped with a bound; ID3v1 trailer and v2.4 footer are validated', async () => {
  const expected = await inspect(raw);
  for (const v of [3, 4]) {
    const tag = id3(Buffer.from('TLEN\0\0\0\x041\0\0\0'), v, v === 4);
    const tail = Buffer.alloc(128); tail.write('TAG');
    const input = Buffer.concat([tag, raw, tail]);
    const r = await inspect(input, {}, 7);
    assert.equal(r.sampleCount, expected.sampleCount); assert.equal(r.sha256, digest(input));
    assert.equal(r.tagBytes, tag.length + 128);
  }
  const damaged = Buffer.concat([id3(Buffer.alloc(12), 4, true), raw]); damaged[22] = 0;
  await rejects(inspect(damaged), 'MUSIC_MP3_ID3_INVALID');
});

test('forged Xing counts/byte lengths cannot shorten measurement; LAME trim fields are never subtracted', async () => {
  const first = positions(full)[0].offset, marker = first + 36;
  for (const field of [marker + 8, marker + 12]) {
    const b = Buffer.from(full); b.writeUInt32BE(1, field);
    await rejects(inspect(b), 'MUSIC_MP3_INFO_MISMATCH');
  }
  const b = Buffer.from(full), lameStart = marker + 120;
  b.write('LAME3.100', lameStart); b.fill(255, lameStart + 21, lameStart + 24);
  assert.equal((await inspect(b)).sampleCount, (await inspect(full)).sampleCount);
});

test('partial last frames and complete-frame truncation with Xing fail closed', async () => {
  for (const n of [1, 2, 50, 300]) await assert.rejects(inspect(full.subarray(0, full.length - n)), e => /^MUSIC_MP3_/.test(e.code));
  const last = positions(full).at(-1);
  await rejects(inspect(full.subarray(0, last.offset)), 'MUSIC_MP3_INFO_MISMATCH');
  await rejects(inspect(raw.subarray(0, -1), { expectedBytes: raw.length }), 'MUSIC_MP3_TRUNCATED');
});

test('junk, midstream bad sync, concatenated info tags and trailing payload are not resynchronized away', async () => {
  const b = Buffer.from(full); b[positions(full)[5].offset] = 0;
  await rejects(inspect(b), 'MUSIC_MP3_FRAME_INVALID');
  for (const input of [Buffer.concat([Buffer.from('garbage'), raw]), Buffer.concat([raw, Buffer.from('garbage')]),
    Buffer.concat([full, full.subarray(positions(full)[0].offset)])]) await assert.rejects(inspect(input), e => /^MUSIC_MP3_/.test(e.code));
  const tag = Buffer.alloc(128); tag.write('TAG');
  await rejects(inspect(Buffer.concat([raw, tag, raw])), 'MUSIC_MP3_TRAILING_DATA');
});

test('unsupported MPEG2.5/layers/CRC/reserved/free-format and inconsistent streams are rejected', async () => {
  for (const [index, value] of [[1, 227], [1, 255], [1, 250], [3, (raw[3] & 252) | 2], [2, raw[2] & 15], [2, 252]]) {
    const b = Buffer.from(raw); b[index] = value;
    await assert.rejects(inspect(b), e => ['MUSIC_MP3_UNSUPPORTED', 'MUSIC_MP3_FRAME_INVALID'].includes(e.code));
  }
  const b = Buffer.from(raw); b[positions(raw)[3].offset + 2] ^= 4;
  await rejects(inspect(b), 'MUSIC_MP3_FORMAT_CHANGED');
  const firstMissing = raw.subarray(positions(raw)[1].offset);
  await rejects(inspect(firstMissing), 'MUSIC_MP3_RESERVOIR_INVALID');
});

test('ID3 invalid syncsafe, excessive metadata, unsupported versions, missing body and zero audio fail', async () => {
  for (const index of [6, 7, 8, 9]) {
    const b = Buffer.concat([id3(Buffer.alloc(1)), raw]); b[index] = 128;
    await rejects(inspect(b), 'MUSIC_MP3_ID3_UNSUPPORTED');
  }
  await rejects(inspect(Buffer.concat([id3(Buffer.alloc(20), 2), raw])), 'MUSIC_MP3_ID3_UNSUPPORTED');
  await rejects(inspect(Buffer.from([73, 68, 51, 4, 0, 0, ...synchsafe(1048576)])), 'MUSIC_MP3_TAG_BUDGET');
  await rejects(inspect(Buffer.from([73, 68, 51, 4, 0, 0, ...synchsafe(100)])), 'MUSIC_MP3_TRUNCATED');
  await rejects(inspect(id3(Buffer.alloc(20))), 'MUSIC_MP3_NO_AUDIO');
});

test('byte, frame, read, chunk and timeout budgets cannot be increased by caller', async () => {
  await rejects(inspect(raw, { expectedBytes: MP3_LIMITS.audioBytes + 1 }), 'MUSIC_MP3_TOO_LARGE');
  await rejects(inspect(raw, { kind: 'preview', expectedBytes: MP3_LIMITS.previewBytes + 1 }), 'MUSIC_MP3_TOO_LARGE');
  await rejects(inspect(raw, { expectedBytes: raw.length - 1 }), 'MUSIC_MP3_SIZE_MISMATCH');
  await rejects(inspect(raw, { limits: { frames: 2 } }), 'MUSIC_MP3_FRAME_BUDGET');
  await rejects(inspect(raw, { limits: { reads: 3 } }, 1), 'MUSIC_MP3_READ_BUDGET');
  for (const limits of [{ frames: 150001 }, { reads: 0 }, { chunkBytes: 1000000 }, { timeoutMs: NaN }])
    await rejects(inspect(raw, { limits }), 'MUSIC_MP3_INVALID_LIMIT');
  await rejects(inspect(Buffer.alloc(65537), {}, 65537), 'MUSIC_MP3_CHUNK_INVALID');
  await rejects(inspect(raw, { contentType: 'audio/aac' }), 'MUSIC_MP3_TYPE_INVALID');
});

test('abort, stalled read, late rejection and malformed clock clean up without a successful proof', async () => {
  let cancelled = false, rejectRead;
  const stalled = new ReadableStream({ pull() { return new Promise((_, reject) => { rejectRead = reject; }); }, cancel() { cancelled = true; } });
  await rejects(inspectMp3(stalled, { kind: 'audio', expectedBytes: 100, contentType: 'audio/mpeg', limits: { timeoutMs: 10 } }), 'MUSIC_MP3_TIMEOUT');
  assert.equal(cancelled, true); rejectRead(new Error('late read failure'));
  const controller = new AbortController(), state = {};
  const body = stream(raw, 10, state); controller.abort();
  await rejects(inspectMp3(body, { kind: 'audio', expectedBytes: raw.length, contentType: 'audio/mpeg', signal: controller.signal }), 'MUSIC_MP3_ABORTED');
  assert.equal(body.locked, false);
  for (const clock of [() => NaN, () => { throw new Error('clock'); }])
    await assert.rejects(inspect(raw, { clock }), e => e.status === 503);
  let time = 10; await rejects(inspect(raw, { clock: () => time-- }), 'MUSIC_MP3_CLOCK_UNAVAILABLE');
  await new Promise(resolve => setTimeout(resolve, 1));
});

test('mid-read abort, stream errors and invalid chunks release the parser lock', async () => {
  const controller = new AbortController(); let cancelled = false;
  const body = new ReadableStream({ pull() { controller.abort(); return new Promise(() => {}); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await rejects(inspectMp3(body, { kind: 'audio', expectedBytes: 10, contentType: 'audio/mpeg', signal: controller.signal }), 'MUSIC_MP3_ABORTED');
  assert.equal(cancelled, true); assert.equal(body.locked, false);
  for (const chunk of [new Uint8Array(0), 'bytes']) {
    const invalid = new ReadableStream({ start(c) { c.enqueue(chunk); } });
    await rejects(inspectMp3(invalid, { kind: 'audio', expectedBytes: 10, contentType: 'audio/mpeg' }), 'MUSIC_MP3_CHUNK_INVALID');
    assert.equal(invalid.locked, false);
  }
  const broken = new ReadableStream({ pull() { throw new Error('private storage failure'); } });
  await rejects(inspectMp3(broken, { kind: 'audio', expectedBytes: 10, contentType: 'audio/mpeg' }), 'MUSIC_MP3_READ_FAILED');
  assert.equal(broken.locked, false);
});

function asset(kind, measured, id = randomUUID(), owner = randomUUID()) {
  return { id, owner_track_id: owner, kind, state: 'validated', format: 'mp3', content_type: 'audio/mpeg',
    object_key: `private/${id}`, etag: `etag-${id}`, sha256: measured.sha256, byte_size: measured.byteSize, duration_ms: measured.durationMs };
}
const object = (a, data) => ({ body: stream(data), size: data.length, contentType: 'audio/mpeg', etag: a.etag });

test('measured objects bind exact bytes, ETag, hash and duration to publication verifier contract', async () => {
  const a = asset('audio', await inspect(full)), proof = await verifyMusicAudioAsset(a, object(a, full));
  assert.equal(proof.exists, true); assert.equal(proof.id, a.id);
  assert.ok(await verifyPublicationResources({ assets: [a] }, async () => ({ checkedAt: Date.now(), assets: [proof] }), Date.now));
  for (const patch of [{ etag: 'changed' }, { size: full.length + 1 }, { contentType: 'audio/aac' }])
    await rejects(verifyMusicAudioAsset(a, { ...object(a, full), ...patch }), 'MUSIC_MP3_OBJECT_MISMATCH');
  for (const patch of [{ sha256: 'b'.repeat(64) }, { duration_ms: 10 }])
    await rejects(verifyMusicAudioAsset({ ...a, ...patch }, object(a, full)), 'MUSIC_MP3_MEASUREMENT_MISMATCH');
});

test('real independent preview binds current full resource; changed identity/hash/source cannot reuse proof', async () => {
  const a = asset('audio', await inspect(full)), data = bytes('preview'), p = asset('preview', await inspect(data), randomUUID(), a.owner_track_id);
  Object.assign(p, { derived_from_asset_id: a.id, source_start_ms: 0, source_end_ms: 1000 });
  const ar = await verifyMusicAudioAsset(a, object(a, full)), pr = await verifyMusicAudioAsset(p, object(p, data));
  assert.equal(validateMeasuredPreview(a, p, ar, pr).durationMs, pr.durationMs);
  for (const patch of [{ id: a.id }, { object_key: a.object_key }, { owner_track_id: randomUUID() },
    { derived_from_asset_id: randomUUID() }, { sha256: 'f'.repeat(64) }]) {
    assert.throws(() => validateMeasuredPreview(a, { ...p, ...patch }, ar, pr), /MUSIC_MP3_PREVIEW_SOURCE_MISMATCH/);
  }
});

test('preview 45 seconds, half length and 250ms tolerance are inclusive only at exact valid boundaries', () => {
  const a = asset('audio', { durationMs: 120000, byteSize: 1000, sha256: 'a'.repeat(64) });
  const p = { ...asset('preview', { durationMs: 45250, byteSize: 500, sha256: 'b'.repeat(64) }, randomUUID(), a.owner_track_id),
    derived_from_asset_id: a.id, source_start_ms: 10000, source_end_ms: 55000 };
  const proof = x => ({ id: x.id, byteSize: x.byte_size, durationMs: x.duration_ms, etag: x.etag, sha256: x.sha256,
    measurement: 'mp3-frames', structureValid: true, exists: true, contentType: 'audio/mpeg' });
  const check = () => validateMeasuredPreview(a, p, proof(a), proof(p));
  assert.equal(check().limitMs, 45000);
  p.duration_ms++; assert.throws(check, /MUSIC_MP3_PREVIEW_INVALID/); p.duration_ms--;
  p.source_end_ms++; assert.throws(check, /MUSIC_MP3_PREVIEW_INVALID/); p.source_end_ms--;
  a.duration_ms = 40000; p.source_start_ms = 0; p.source_end_ms = 20000; p.duration_ms = 20250;
  assert.equal(check().limitMs, 20000);
  p.duration_ms++; assert.throws(check, /MUSIC_MP3_PREVIEW_INVALID/);
  p.duration_ms = 19749; assert.throws(check, /MUSIC_MP3_PREVIEW_INVALID/);
  p.duration_ms = 19750; assert.equal(check().durationMs, 19750);
  for (const limit of [0, 14999, 45001, NaN]) assert.throws(() => validateMeasuredPreview(a, p, proof(a), proof(p), { previewLimitMs: limit }), /LIMIT_INVALID/);
});

test('fixture audio and generator binaries are never in deployable public assets', () => {
  assert.equal(existsSync(new URL('../public/tests/fixtures/music-mp3/', import.meta.url)), false);
  assert.equal(existsSync(new URL('../public/ffmpeg', import.meta.url)), false);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.dependencies['mp3-parser'], '0.3.0'); assert.equal(pkg.dependencies['@noble/hashes'], '2.4.0');
  assert.ok(!Object.keys(pkg.dependencies).some(name => /ffmpeg/.test(name)));
});

test('32 MiB full and 4 MiB preview byte ceilings are parsed with fixed carry, not whole-object buffering', async t => {
  const frame = raw.subarray(0, positions(raw)[0].length);
  for (const [kind, size] of [['audio', MP3_LIMITS.audioBytes], ['preview', MP3_LIMITS.previewBytes]]) {
    const count = Math.floor((size - 10) / frame.length), lead = id3(Buffer.alloc(size - count * frame.length - 10));
    let offset = 0;
    const expectedHash = createHash('sha256');
    const body = new ReadableStream({ pull(c) {
      if (offset === size) { c.close(); return; }
      const data = new Uint8Array(Math.min(65536, size - offset));
      let cursor = 0;
      while (cursor < data.length) {
        const source = offset < lead.length ? lead : frame;
        const start = offset < lead.length ? offset : (offset - lead.length) % frame.length;
        const n = Math.min(source.length - start, data.length - cursor);
        data.set(source.subarray(start, start + n), cursor); cursor += n; offset += n;
      }
      expectedHash.update(data); c.enqueue(data);
    } }, { highWaterMark: 0 });
    const started = performance.now();
    const result = await inspectMp3(body, { kind, expectedBytes: size, contentType: 'audio/mpeg' });
    assert.equal(result.byteSize, size); assert.equal(result.frameCount, count);
    assert.equal(result.sha256, expectedHash.digest('hex')); assert.equal(result.bufferCapacityBytes, 67584);
    t.diagnostic(`${kind}: ${size} bytes, ${count} frames, ${Math.round(performance.now() - started)}ms; fixed carry ${result.bufferCapacityBytes} bytes`);
  }
});
