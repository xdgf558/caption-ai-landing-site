import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { youtubeIDFromURL } from '../src/redesign/youtubeClip.js';
import { publicationFormReady, listAssetState } from '../src/scripts/stationWorkbenchState.js';
import { draftData } from '../src/redesign/contentAdminModel.js';
import { createContentAdminRuntime } from './helpers/station-content-admin-runtime.mjs';

const id = 'abcdefghijk'; // Synthetic identifier; no request is made to YouTube.
const metadata = { originalLocale: 'zh-Hans', title: { 'zh-Hans': '隔离短片夹具' } };
const data = { metadata, youtubeURL: `https://www.youtube.com/shorts/${id}?si=share-token`, youtubeEmbeddingConfirmed: true };
test('only explicit single-video YouTube addresses become a revision-bound ID', () => {
  for (const value of [`https://youtu.be/${id}?si=abc`, `https://www.youtube.com/watch?v=${id}`, `https://www.youtube.com/shorts/${id}/?feature=share`]) assert.equal(youtubeIDFromURL(value), id);
  for (const value of [`http://youtu.be/${id}`, `https://evil.test/shorts/${id}`, `https://www.youtube.com@evil.test/shorts/${id}`, `https://www.youtube.com:443/shorts/${id}`, `https://www.youtube.com/embed/${id}`, `https://www.youtube.com/shorts/%61bcdefghijk`, `https://youtu.be/${id}#t=3`, `https://www.youtube.com/watch?v=${id}&v=${id}`, `https://www.youtube.com/watch?v=${id}&list=abc`, `https://www.youtube.com/watch?v=${id}&redirect=https://evil.test`, `https://youtu.be/short`, `https://youtu.be/${id}?si=x&si=y`]) assert.equal(youtubeIDFromURL(value), null, value);
  const saved = draftData('clips', data);
  assert.deepEqual(JSON.parse(saved.metadata_json).youtube, { videoId: id, embeddingConfirmed: true });
  assert(!saved.metadata_json.includes('share-token'));
  for (const patch of [{ youtubeEmbeddingConfirmed: false }, { mediaAssetId: randomUUID() }, { durationMs: 30 }, {subtitles: []}, {subtitles: ""}, { metadata: { ...metadata, youtube: { videoId: id } } }]) assert.throws(() => draftData('clips', { ...data, ...patch }));
});

test('admin enables a confirmed YouTube draft without requiring local media and labels its source honestly', () => {
  const options = { identity: {role:'publisher'}, busy:false, pending:false, dirty:false, type:'clips', assets:[], current:{draft:{data}} };
  assert.equal(publicationFormReady(options),true);
  for(const patch of [{dirty:true},{busy:true},{pending:true},{identity:{role:'editor'}},{current:{draft:{data:{...data,youtubeEmbeddingConfirmed:false}}}}]) assert.equal(publicationFormReady({...options,...patch}),false);
  assert.equal(listAssetState({type:'clips',clipProvider:'youtube',expectedAssetCount:0,assetDetails:[]}), 'external');
  assert.equal(listAssetState({type:'clips',clipProvider:'file',expectedAssetCount:2,assetDetails:[]}), 'missing');
});

test('real Worker/D1 publication, compatibility, replay, revocation and rollback of YouTube clips', async t => {
  const f = await createContentAdminRuntime(); t.after(() => f.close());
  const base = '/admin/api/music/site-content', track = f.content.tracks[0];
  const send = async (path, { method = 'GET', body, version = 1, key = randomUUID() } = {}) => {
    const r = await f.mf.dispatchFetch('http://content.local.test' + path, { method, headers: {
      'Cf-Access-Jwt-Assertion': f.actorToken, 'CF-Connecting-IP': '192.0.2.55', Origin: 'http://content.local.test',
      'X-Requested-With': 'StationCatMusicAdmin', 'Content-Type': 'application/json', 'If-Match': `"edit-${version}"`, 'Idempotency-Key': key
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  for (const [path, body, method] of [
    [base + '/tracks', { trackId: track.id, data: { metadata: track.metadata, coverAssetId: track.cover, siteAudioMode: 'none' } }, 'POST'],
    [base + '/assets/' + track.cover + '/rights', { scope: 'cover', status: 'approved', basis: '隔离合成素材，仅测试' }, 'PUT'],
    [base + '/tracks/' + track.id + '/publish', { revision: 1 }, 'POST']
  ]) { const result = await send(path, { method, body }); assert.equal(result.status, 200, JSON.stringify(result.body)); }
  const command = { method: 'POST', key: randomUUID(), body: { trackId: track.id, clipType: 'short_video', data } };
  const created = await send(base + '/clips', command); assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal((await send(base + '/clips', command)).body.id, created.body.id);
  const clip = created.body.id, path = '/api/station/content/tracks/' + track.slug + '/clips';
  assert.deepEqual((await send(path + '?include=youtube')).body.items, []);
  assert.equal((await send(base + '/clips/' + clip + '/publish', { method: 'POST', body: { revision: 1 } })).status, 200);
  assert.deepEqual((await send(path)).body.items, []); // Existing clients/web pages stay file-only.
  assert.deepEqual((await send('/api/station/content/clips')).body.items, []);
  for (const suffix of ['?include=all', '?include=youtube&include=youtube']) assert.equal((await send(path + suffix)).status, 400);
  assert.equal((await send('/api/station/content/clips?include=youtube')).status, 400);
  const live = await send(path + '?include=youtube'); assert.equal(live.status, 200); assert.equal(live.headers.get('cache-control'), 'no-store');
  assert.equal(live.body.items.length, 1); const dto = live.body.items[0];
  assert.equal(dto.provider, 'youtube'); assert.equal(dto.youtubeVideoId, id); assert.equal(dto.watchUrl, `https://www.youtube.com/watch?v=${id}`);
  assert.equal(dto.mediaUrl, null); assert.equal(dto.posterUrl, null); assert.equal(dto.durationMs, null); assert.equal(dto.track.id, track.id);
  assert.doesNotMatch(JSON.stringify(dto), /embeddingConfirmed|share-token|object_key/);
  const changed = { ...data, youtubeURL: 'https://youtu.be/12345678901' };
  assert.equal((await send(base + '/clips/' + clip, { method: 'PATCH', version: 2, body: { revision: 1, data: changed } })).status, 200);
  assert.equal((await send(path + '?include=youtube')).body.items[0].youtubeVideoId, id); // Unsaved publication pointer.
  assert.equal((await send(base + '/clips/' + clip + '/publish', { method: 'POST', version: 3, body: { revision: 2 } })).status, 200);
  assert.equal((await send(path + '?include=youtube')).body.items[0].youtubeVideoId, '12345678901');
  assert.equal((await send(base + '/clips/' + clip + '/unpublish', { method: 'POST', version: 4, body: { revision: 2 } })).status, 200);
  assert.deepEqual((await send(path + '?include=youtube')).body.items, []);
  assert.equal((await send(base + '/clips/' + clip + '/rollback', { method: 'POST', version: 5, body: { revision: 1 } })).status, 200);
  assert.equal((await send(path + '?include=youtube')).body.items[0].youtubeVideoId, id);
  assert.equal((await send(base + '/tracks/' + track.id + '/unpublish', { method: 'POST', version: 2, body: { revision: 1 } })).status, 200);
  assert.equal((await send(path + '?include=youtube')).status, 404);
});
