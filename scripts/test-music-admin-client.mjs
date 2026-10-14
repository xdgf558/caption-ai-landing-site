import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { assetUrl, hashFile, fileFormat, inspectUploadFile, limits, policyForSave, createJournal, request } from '../src/scripts/musicAdminClient.js';

const picture = sharp({ create: { width: 177, height: 177, channels: 4, background: '#729284' } });
const images = { png: await picture.clone().png().toBuffer(), jpeg: await picture.clone().jpeg().toBuffer(), webp: await picture.clone().webp().toBuffer() };

test('cover format follows validated bytes instead of the filename or browser MIME', async () => {
  for (const [format, content] of Object.entries(images)) {
    for (const [name, type] of [['cover.jpg', 'image/jpeg'], ['cover.PNG', 'image/png'], ['cover', ''], ['cover.bin', 'application/octet-stream']]) {
      const file = new File([content], name, { type });
      assert.deepEqual(await inspectUploadFile('cover', file), { format, type: 'image/' + format });
      assert.equal(await hashFile(file), createHash('sha256').update(content).digest('hex'));
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), content);
    }
  }
});
test('image inspection rejects unsupported, corrupt, oversized and unreadable files before upload', async () => {
  const badCrc = Buffer.from(images.png); badCrc[29] ^= 1;
  const tooWide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#729284' } }).png().toBuffer();
  const animated = await sharp(Buffer.concat([Buffer.alloc(8 * 8 * 3), Buffer.alloc(8 * 8 * 3, 255)]),
    { raw: { width: 8, height: 16, pageHeight: 8, channels: 3 } }).webp().toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  for (const content of [Buffer.from('<svg></svg>'), Buffer.from('not an image'),
    images.png.subarray(0, 20), images.jpeg.subarray(0, -2), images.webp.subarray(0, -1), badCrc, tooWide, animated]) {
    await assert.rejects(inspectUploadFile('cover', new File([content], 'cover.jpg', { type: 'image/jpeg' })), /封面/);
  }
  for (const kind of ['cover', 'evidence']) {
    for (const size of [0, limits[kind] + 1, NaN]) {
      await assert.rejects(inspectUploadFile(kind, { size, slice() { assert.fail('invalid size must not read bytes'); } }), /不能为空/);
    }
  }
  await assert.rejects(inspectUploadFile('cover', { size: 10, slice() { throw Error('unavailable'); } }), /无法读取文件/);
  await assert.rejects(inspectUploadFile('cover', { size: 10, slice() { return new Blob(['partial']); } }), /未完整读取/);
});
test('evidence keeps its narrower formats and non-image uploads retain their existing contract', async () => {
  for (const format of ['png', 'jpeg']) {
    assert.deepEqual(await inspectUploadFile('evidence', new File([images[format]], 'evidence.pdf', { type: 'application/pdf' })), { format, type: 'image/' + format });
  }
  const pdf = new File(['%PDF-1.7\nfixture\nstartxref\n9\n%%EOF\n'], 'evidence.jpg', { type: 'image/jpeg' });
  assert.deepEqual(await inspectUploadFile('evidence', pdf), { format: 'pdf', type: 'application/pdf' });
  await assert.rejects(inspectUploadFile('cover', pdf), /封面格式/);
  await assert.rejects(inspectUploadFile('evidence', new File([images.webp], 'evidence.png')), /PDF、JPEG 或 PNG/);
  await assert.rejects(inspectUploadFile('evidence', new File(['%PDF-1.7\ntruncated'], 'evidence.pdf')), /不完整/);
  for (const [kind, name, format, type] of [['audio', 'audio.mp3', 'mp3', 'audio/mpeg'], ['preview', 'preview.mp3', 'mp3', 'audio/mpeg'], ['lyrics', 'lyrics.lrc', 'lrc', 'text/plain']]) {
    assert.deepEqual(await inspectUploadFile(kind, new File(['existing contract'], name)), { format, type });
  }
  await assert.rejects(inspectUploadFile('audio', new File([images.png], 'cover.png')));
});

test('asset paths reject external URLs and non-UUID identifiers',() => {
  assert.throws(() => assetUrl('https://evil.test/file'));
  assert.throws(() => assetUrl('../tracks'));
  assert.match(assetUrl('00000000-0000-4000-8000-000000000001'),/^\/admin\/api\/music\/assets\//);
});
test('file hashing is incremental and exact; extension does not authorize the server',async () => {
  const content = new Uint8Array(160000).fill(73), sizes = [];
  const file = { size:content.length, slice:(start,end) => { sizes.push(end-start); return new Blob([content.slice(start,end)]); } };
  assert.equal(await hashFile(file),createHash('sha256').update(content).digest('hex'));
  assert.ok(sizes.every(n => n <= 65536));
  assert.deepEqual(fileFormat('audio',{name:'A.MP3',size:1}),{format:'mp3',type:'audio/mpeg'});
  assert.throws(() => fileFormat('cover',{name:'evil.svg',size:1}));
  assert.throws(() => fileFormat('audio',{name:'a.mp3',size:33554433}));
});
test('policy versions follow the published policy, never the draft counter',() => {
  const previous = {accessMode:'vip',earlyAccessUntil:null,postEarlyAccessMode:null,policyVersion:3};
  assert.equal(policyForSave('vip','',null,previous).policyVersion,3);
  assert.equal(policyForSave('free','',null,previous).policyVersion,4);
  assert.equal(policyForSave('vip','',null,null).policyVersion,1);
  assert.throws(() => policyForSave('early_access','invalid','free',previous));
});
test('journal survives reload, isolates actors and refuses unavailable storage',() => {
  const data = new Map(), storage = {getItem:k => data.get(k),setItem:(k,v) => data.set(k,v)};
  const first = createJournal(storage,'one'); const op = {key:'original-key',body:{title:'draft'},etag:'"edit-1"'};
  first.update({pending:op});
  assert.deepEqual(createJournal(storage,'one').get().pending,op);
  assert.equal(createJournal(storage,'two').get().pending,null);
  assert.throws(() => createJournal({getItem:() => null,setItem:() => { throw Error('blocked'); }},'one'));
});
test('requests preserve original key/version and fail closed on redirected or uncertain replies',async () => {
  const old = globalThis.fetch; const calls = [];
  try {
    globalThis.fetch = async (url,options) => { calls.push({url,options}); return Response.json({ok:true}); };
    await request('/tracks',{method:'POST',body:{slug:'test'},key:'original-key',etag:'"edit-1"'});
    await assert.rejects(() => request('/tracks/../../readers/membership/redeem'));
    await assert.rejects(() => request('/uploads/%2e%2e/status'));
    assert.equal(calls[0].options.headers['X-Requested-With'],'StationCatMusicAdmin');
    assert.equal(calls[0].options.headers['If-Match'],'"edit-1"');
    assert.equal(calls[0].options.redirect,'error'); assert.equal(calls[0].options.credentials,'same-origin');
    globalThis.fetch = async () => Response.json({ok:false,code:'TEMPORARY'},{status:503});
    await assert.rejects(() => request('/status'),e => e.uncertain);
    globalThis.fetch = async () => Response.json({ok:false,code:'MUSIC_EDIT_CONFLICT'},{status:409});
    await assert.rejects(() => request('/status'),e => !e.uncertain && e.status === 409);
    globalThis.fetch = async () => new Response('<html>Access login</html>');
    await assert.rejects(() => request('/status'),e => e.uncertain);
    globalThis.fetch = async () => new Response('<html>Worker exceeded resource limits; private diagnostic</html>', {status:503});
    await assert.rejects(() => request('/uploads/00000000-0000-4000-8000-000000000001/complete', {method:'POST',body:{},key:'original-key'}), e => {
      assert.equal(e.code,'MUSIC_SERVER_UNAVAILABLE'); assert.equal(e.status,503); assert.equal(e.uncertain,true);
      assert.match(e.message,/服务器处理失败/); assert.doesNotMatch(e.message,/登录|private diagnostic/); return true;
    });
  } finally { globalThis.fetch = old; }
});
test('admin shell remains private, explicit publish and no unsupported entrypoints',() => {
  const html = readFileSync(new URL('../src/pages/admin/music.astro',import.meta.url),'utf8');
  assert.match(readFileSync(new URL('../src/layouts/StationAdminLayout.astro',import.meta.url),'utf8'),/noindex,nofollow/); assert.match(html,/id="track-publish" type="button"/);
  assert.match(html,/role="tablist"/); assert.match(html,/aria-controls/);
  const client = readFileSync(new URL('../src/scripts/adminMusic.js',import.meta.url),'utf8');
  assert.doesNotMatch(client,/innerHTML|localStorage|canPlayFull/);
  assert.match(client,/confirmedPolicyVersion/); assert.match(client,/actorId !== actor/);
});

test('limited-free editor preserves the deadline and versions actual policy changes', () => {
  const end = '2099-01-01T12:30:00.000Z';
  const first = policyForSave('limited_free', end, null, null);
  assert.equal(first.freeUntil, end); assert.equal(first.policyVersion, 1);
  assert.deepEqual(policyForSave('limited_free', end, null, first), first);
  assert.equal(policyForSave('limited_free', '2099-02-01T12:30:00.000Z', null, first).policyVersion, 2);
  assert.equal(policyForSave('vip', '', null, first).freeUntil, undefined);
});
