import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createStationCorePreview } from './helpers/station-core-preview.mjs';
import { event } from './helpers/station-event-fixture.mjs';
import { STATION_EVENT_VERSION } from '../src/redesign/analyticsModel.js';

test('T21 integrated native Assets/Worker/D1/R2 fixture and collection boundaries', async t => {
  const preview = await createStationCorePreview({ port: 4231 }); t.after(() => preview.close());
  const get = (path, options = {}) => fetch(preview.origin + path, { redirect: 'manual', ...options });
  const events = items => get('/api/station/events', { method: 'POST', headers: { Origin: preview.origin, 'Content-Type': 'application/json', 'X-Requested-With': 'StationCatEvents' }, body: JSON.stringify({ consentVersion: STATION_EVENT_VERSION, events: items }) });
  const track = preview.runtime.content.tracks[1];
  await t.test('isolated current migrations are in order and both cleanup prerequisites are healthy', async () => {
    const response = await get('/__fixture/observations'), observation = await response.json();
    assert.equal(observation.production, false); assert.equal(observation.media.videoBytesAreMetadataOnly, false);
    assert.deepEqual(observation.migrationLedger.map(name => name.slice(0, 4)), ['0012','0013','0014','0015','0016','0017','0018']);
    const config = await (await get('/api/station/events/config')).json(); assert.equal(config.available, true); assert.equal(config.runtimeGameId, preview.runtime.content.game.id);
  });
  await t.test('A01 pending homepage stays silent while the unrelated synthetic catalog exists', async () => {
    const response = await get('/'), html = await response.text(); assert.equal(response.status, 200);
    assert.match(html, /主推作品確定後/); assert.doesNotMatch(html, /<(?:audio|video|iframe)\b/); assert.doesNotMatch(html, /晚一點告白/);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
  });
  await t.test('A02 public DTO permits separate preview but still requires old full-playback access', async () => {
    const dto = await (await get('/api/station/content/tracks/vip?locale=zh-Hant')).json();
    assert.equal(dto.track.preview.durationMs, 1045); assert.equal(dto.track.fullPlayback.requiresAccessCheck, true);
    assert.doesNotMatch(JSON.stringify(dto), /object_key|session_hash|music\/(?:audio|preview)\//);
    const full = await get(dto.track.fullPlayback.playbackPath); assert.equal(full.status, 401); assert.doesNotMatch(await full.text(), /object_key|music\/audio\//);
    const previewResponse = await get(dto.track.preview.playbackPath); assert.equal(previewResponse.status, 200);
    const grant = await previewResponse.json(); assert.equal(grant.variant, 'preview'); assert.equal(grant.requiresAccessCheck, undefined);
    assert.match(grant.audioPath, /^\/api\/station\/content\/tracks\/vip\/audio\?variant=preview&v=\d+&p=\d+$/);
    const audio = await get(grant.audioPath); assert.equal(audio.status, 200); assert.equal(audio.headers.get('content-type'), 'audio/mpeg'); assert.equal((await audio.arrayBuffer()).byteLength, 12897);
  });
  await t.test('A11 registered exact tuple stays local while malicious attribution loses all raw fields', async () => {
    const tuple = '/music/tracks/vip/?utm_source=douyin&utm_medium=short_video&utm_campaign=t21-synthetic-campaign&utm_content=' + preview.runtime.content.clip.id;
    const response = await get(tuple); assert.equal(response.status, 200); assert.match(await response.text(), /t21-synthetic-campaign/);
    const bad = await get('/music/tracks/vip/?utm_campaign=bad&token=secret&redirect=https://evil.test'); assert.equal(bad.status, 302);
    assert.equal(new URL(bad.headers.get('location'), preview.origin).origin, preview.origin); assert.equal(new URL(bad.headers.get('location'), preview.origin).search, '?utm_campaign=unknown');
  });
  await t.test('A12 accepted event retry and ten-second qualification append once through HTTP', async () => {
    const start = event('preview_start', { trackId: track.id, playbackId: randomUUID() }), qualified = { ...start, eventId: randomUUID(), name: 'preview_qualified', listenedMs: 10000 };
    const response = await events([start, qualified]); assert.equal(response.status, 200); assert.equal((await response.json()).accepted, 2);
    const retry = await events([start, qualified]); assert.equal(retry.status, 200); assert.equal((await retry.json()).accepted, 0);
    assert.equal((await preview.runtime.db.prepare('SELECT COUNT(*) n FROM station_analytics_events').first()).n, 2);
  });
  await t.test('A19 collector outage leaves guest preview and navigation usable', async () => {
    await (await get('/__fixture/statistics-failure?enabled=1')).text(); assert.equal((await events([event('track_view', { trackId: track.id })])).status, 503);
    assert.equal((await get('/music/tracks/vip/')).status, 200); assert.equal((await get('/api/station/content/tracks/vip/playback?variant=preview')).status, 200);
    await (await get('/__fixture/statistics-failure?enabled=0')).text();
  });
  await t.test('A17 isolated retirees are real 410 and original runtime is still available', async () => {
    assert.equal((await get('/apps/')).status, 410); assert.equal((await get('/blog/')).status, 404); const runtime = await get('/games/cat-life/'); assert.equal(runtime.status, 200); assert.match(await runtime.text(), /CatGame|cat-life/);
    const privateShell = await get('/music/site-shell/zh-Hant/'); assert.equal(privateShell.status, 404);
  });
  await t.test('preview accepts no admin/financial/cloud mutations or rollout headers from the browser', async () => {
    for (const path of ['/admin/music/content/', '/api/readers/game-saves/cat-life', '/api/readers/login', '/__fixture/select?scenario=valid']) assert.equal((await get(path, { method: 'POST', body: '{}' })).status, 403, path);
    assert.equal((await get('/api/station/events', { method: 'POST', headers: { Origin: 'https://foreign.test', 'X-Requested-With': 'StationCatEvents' }, body: '{}' })).status, 403);
    assert.equal((await get('/', { headers: { 'x-sc-fixture-mode': 'closed', Cookie: 'station_cat_reader_session=untrusted' } })).status, 200);
  });
  await t.test('fixture scenario choices are bounded and do not authorize remote access', async () => {
    assert.equal((await get('/__fixture/select?scenario=unknown')).status, 400);
    const response = await get('/__fixture/select?scenario=corrupt'); assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    const options = await get('/__fixture/options.js', { headers: { Cookie: 'scT21Scenario=corrupt; station_cat_reader_session=untrusted' } }); assert.match(await options.text(), /"scenario":"corrupt"/);
  });
});

test('T21 network profile rejects arbitrary proxy/configuration targets', async () => {
  await assert.rejects(createStationCorePreview({ port: 80 }));
  await assert.rejects(createStationCorePreview({ port: 4231, network: 'unbounded-proxy' }));
});
