import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assetUrl, hashFile, fileFormat, policyForSave, createJournal, request } from '../src/scripts/musicAdminClient.js';

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
  } finally { globalThis.fetch = old; }
});
test('admin shell remains private, explicit publish and no unsupported entrypoints',() => {
  const html = readFileSync(new URL('../src/pages/admin/music.astro',import.meta.url),'utf8');
  assert.match(html,/noindex,nofollow/); assert.match(html,/id="track-publish" type="button"/);
  assert.match(html,/role="tablist"/); assert.match(html,/aria-controls/);
  const client = readFileSync(new URL('../src/scripts/adminMusic.js',import.meta.url),'utf8');
  assert.doesNotMatch(client,/innerHTML|localStorage|canPlayFull/);
  assert.match(client,/confirmedPolicyVersion/); assert.match(client,/actorId !== actor/);
});
