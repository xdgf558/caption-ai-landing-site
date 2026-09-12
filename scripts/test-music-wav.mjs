import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Mp3Encoder } from '@breezystack/lamejs';
import { inspectWav, encodeWav, pcm16, WAV_PROFILE, WAV_LIMITS } from '../src/scripts/musicWav.js';
import { createWavConverter } from '../src/scripts/musicWavClient.js';
import { inspectMp3 } from '../src/music/mp3.js';
import { wavFixture } from './helpers/music-wav-fixture.mjs';
const digest = data => createHash('sha256').update(data).digest('hex');
const file = (data = wavFixture()) => new File([data], 'tone.wav');

for (const [bits, encoding, channels, sampleRate, extensible] of [[16,1,2,44100,false],[24,1,2,48000,true],[32,1,1,32000,false],[32,3,2,48000,true]]) {
  test(`real encoder ${bits}/${encoding}/${channels}/${sampleRate}: deterministic, bounded and accepted by server MP3 parser`, async () => {
    const input = file(wavFixture({ bits, encoding, channels, sampleRate, extensible })), reads = [], progress = [];
    const bounded = { size: input.size, slice: (start,end) => { reads.push(end-start); return input.slice(start,end); } };
    const result = await encodeWav(bounded, 'audio', Mp3Encoder, p => progress.push(p));
    const measured = await inspectMp3(result.blob.stream(), { kind:'audio', expectedBytes:result.blob.size, contentType:'audio/mpeg' });
    assert.equal(measured.channels,channels); assert.equal(measured.sampleRate,sampleRate);
    assert.equal(measured.vbr,false); assert.ok(result.blob.size >= 24000 && result.blob.size <= 27000);
    assert.ok(measured.durationMs >= 1000 && measured.durationMs <= 1250);
    assert.ok(reads.every(n => n <= WAV_LIMITS.framesPerRead * 8));
    assert.equal(result.profile,WAV_PROFILE); assert.equal(progress.at(-1),100);
    assert.ok(progress.every((n,i) => i === 0 || n > progress[i-1]));
    const again = await encodeWav(input,'audio',Mp3Encoder);
    assert.equal(digest(Buffer.from(await result.blob.arrayBuffer())),digest(Buffer.from(await again.blob.arrayBuffer())));
  });
}
test('signed PCM conversion preserves channel separation, limits float amplitude and rejects nonfinite samples', () => {
  for (const bits of [16,24,32]) {
    const b = Buffer.alloc(2 * bits / 8); b.writeIntLE(-(2 ** (bits-1)),0,bits/8); b.writeIntLE(2 ** (bits-1)-1,bits/8,bits/8);
    const [left,right] = pcm16(new DataView(b.buffer,b.byteOffset,b.length),{ channels:2,bits,blockAlign:bits/4,encoding:1 });
    assert.equal(left[0],-32768); assert.equal(right[0],32767);
  }
  const f = new Float32Array([-2,2,NaN]);
  assert.deepEqual([...pcm16(new DataView(f.buffer,0,8),{channels:1,bits:32,blockAlign:4,encoding:3})[0]],[-32768,32767]);
  assert.throws(() => pcm16(new DataView(f.buffer),{channels:1,bits:32,blockAlign:4,encoding:3}),/无效浮点/);
});
test('malformed, compressed, over-budget and ambiguous WAV inputs fail before encoding', async () => {
  const rejects = async mutate => { const b = wavFixture(); mutate(b); await assert.rejects(inspectWav(file(b),'audio')); };
  await rejects(b => b.write('RF64')); await rejects(b => b.writeUInt32LE(100,4));
  await rejects(b => b.writeUInt32LE(96000,24)); await rejects(b => b.writeUInt16LE(6,22));
  await rejects(b => b.writeUInt16LE(2,20)); await rejects(b => b.writeUInt32LE(1,28));
  await rejects(b => b.writeUInt32LE(b.length,40));
  await assert.rejects(inspectWav({size:WAV_LIMITS.audio+1,slice:() => assert.fail('no read')},'audio'));
  await assert.rejects(inspectWav(file(wavFixture({seconds:45.01})),'preview'),/时长/);
  await assert.rejects(inspectWav(file(wavFixture({seconds:0.01})),'audio'),/时长/);
  const duplicate = Buffer.concat([wavFixture(),Buffer.from('data\0\0\0\0')]); duplicate.writeUInt32LE(duplicate.length-8,4);
  await assert.rejects(inspectWav(file(duplicate),'audio'),/只有一个/);
  const chunks = Buffer.concat([wavFixture().subarray(0,12), ...Array(257).fill(Buffer.from('JUNK\0\0\0\0'))]);
  chunks.writeUInt32LE(chunks.length-8,4); await assert.rejects(inspectWav(file(chunks),'audio'),/分块过多/);
  const invalidFloat = wavFixture({encoding:3,bits:32}); invalidFloat.writeFloatLE(Infinity,44);
  await assert.rejects(encodeWav(file(invalidFloat),'audio',Mp3Encoder),/无效浮点/);
});
test('odd metadata chunks and data before fmt are scanned without decoding metadata', async () => {
  const base = wavFixture(), extra = Buffer.from([74,85,78,75,1,0,0,0,255,0]);
  const b = Buffer.concat([base.subarray(0,12),extra,base.subarray(36),base.subarray(12,36)]); b.writeUInt32LE(b.length-8,4);
  const info = await inspectWav(file(b),'audio'); assert.equal(info.frames,44100);
});
test('controller terminates on cancel, ignores late success, retries fresh, and fails closed on worker errors/timeouts', async () => {
  const workers = [], converter = createWavConverter({createWorker:() => {
    const worker = {postMessage(data) { this.data=data; },terminate() { this.stopped=true; }}; workers.push(worker); return worker;
  },timeoutMs:40});
  const first = converter.convert(file(),'audio'), late = workers[0].onmessage;
  await assert.rejects(converter.convert(file(),'audio'),/完成或取消/);
  converter.cancel(); await assert.rejects(first,/已取消/); assert.equal(workers[0].stopped,true);
  late({data:{result:{blob:new Blob(['late']),profile:WAV_PROFILE}}});
  const retry = converter.convert(file(),'audio'); workers[1].onerror(); await assert.rejects(retry,/不可用/);
  assert.equal(workers[1].stopped,true);
  await assert.rejects(converter.convert(file(),'audio'),/超时/); assert.equal(workers[2].stopped,true);
  const success = converter.convert(file(),'audio'); workers[3].onmessage({data:{result:{blob:new Blob(['bytes']),profile:WAV_PROFILE,info:{seconds:1}}}});
  const result = await success; assert.equal(result.file.name,'tone.mp3'); assert.equal(result.file.type,'audio/mpeg'); assert.equal(workers[3].stopped,true);
  const count = workers.length; await assert.rejects(converter.convert({name:'big.wav',size:WAV_LIMITS.audio+1},'audio')); assert.equal(workers.length,count);
});
test('independent LGPL module and exact source archive remain pinned, with no codec in page bundle', async () => {
  const vendor = await readFile(new URL('../public/vendor/music-mp3/lamejs-1.2.7.js',import.meta.url));
  const installed = await readFile(new URL('../node_modules/@breezystack/lamejs/dist/lamejs.js',import.meta.url));
  assert.deepEqual(vendor,installed); assert.equal(digest(vendor),'1c5f944911ccf2f6e29ab36c2e568363210ab16f50c0d76077060f40ecf91d28');
  assert.equal(digest(await readFile(new URL('../public/vendor/music-mp3/source-1.2.7.tar.gz',import.meta.url))),'af8f08f0ff9a13777f2ffff737b48e40019b53a4b21db270dd62e829574e2b83');
  const client = await readFile(new URL('../src/scripts/musicWavClient.js',import.meta.url),'utf8');
  assert.doesNotMatch(client,/AudioContext|fetch\(|localStorage|sessionStorage/);
});
