// LOCAL ONLY. Loopback host, no credentials, no proxy and no external bindings. NEVER DEPLOY.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tracks, demoWav } from './fixtures/music-player/data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const libraryPreview = process.env.MUSIC_LIBRARY_PREVIEW === 'true';
const output = resolve(root, '.generated/music-player-preview');
const port = Number(process.env.MUSIC_PLAYER_PREVIEW_PORT || 4198);
const origin = `http://127.0.0.1:${port}`;
const wavs = new Map();
const counters = { catalog: 0, capabilities: 0, access: 0, audio: 0 };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}` || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(403); res.end(); return; }
  const url = new URL(req.url, origin);
  const send = (status, data, type = 'application/json', headers = {}) => {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(type === 'application/json' ? JSON.stringify(data) : data);
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Length': body.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  try {
    const scenario = process.env.MUSIC_PLAYER_PREVIEW_SCENARIO;
    // Local-only switches live outside tracked files. They are not sessions or credentials.
    const fixture = scenario === 'access-lifecycle'
      ? JSON.parse(await readFile(resolve(root, '.generated/music-player-access-state.json'), 'utf8')) : {};
    const locale = ['zh-Hans', 'zh-Hant', 'en', 'ja'].includes(url.searchParams.get('locale')) ? url.searchParams.get('locale') : 'zh-Hans';
    const names = { 'zh-Hans': ['窗边的午后', '夜行小站', '慢慢醒来'], 'zh-Hant': ['窗邊的午後', '夜行小站', '慢慢醒來'], en: ['Afternoon by the Window', 'Night Station', 'Waking Slowly'], ja: ['窓辺の午後', '夜の小駅', 'ゆっくり目覚めて'] };
    const baseTracks = scenario === 'library-500' ? Array.from({ length: 500 }, (_, i) => ({ ...tracks[i % 3], id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` })) : tracks;
    const demoTracks = baseTracks.map(track => scenario === 'access-lifecycle' && fixture.catalog !== 'free' && track.art !== 'night'
      ? { ...track, effectiveAccess: 'vip', previewAvailable: true, previewDurationSec: 30, previewSourceStartSec: 12 } : track).map((track, i) => ({ ...track,
      title: names[locale][i % 3] + (scenario === 'library-500' ? ` ${i + 1}` : ''),
      effectiveAccess: libraryPreview && i % 3 === 1 ? 'vip' : track.effectiveAccess,
      previewAvailable: libraryPreview && i % 3 === 1 ? true : track.previewAvailable,
      previewDurationSec: libraryPreview && i % 3 === 1 ? 30 : track.previewDurationSec,
      previewSourceStartSec: libraryPreview && i % 3 === 1 ? 12 : track.previewSourceStartSec,
      genres: i % 2 ? ['Ambient'] : ['Piano', 'Acoustic'], moods: i % 3 ? ['Calm'] : ['Warm'],
      summary: locale === 'en' ? 'Original synthesized audio for local interaction testing.' : locale === 'ja' ? '操作確認用に合成したローカル音源です。' : '本地合成演示音频，仅用于交互预览。',
      publishedAt: new Date(Date.UTC(2026, 8, 11) - i * 86400000).toISOString(), coverUrl: `/api/music/tracks/${track.id}/cover?v=1`
    }));
    const collections = libraryPreview ? [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'quiet-days', title: locale === 'en' ? 'Quiet Days' : locale === 'ja' ? '静かな日々' : '安静的日常', description: '', trackIds: demoTracks.slice(0, 3).map(t => t.id).reverse() }] : [];
    const expired = fixture.validUntil && Date.parse(fixture.validUntil) <= Date.now();
    const vip = fixture.membership === 'vip' && !expired;
    const fullAccess = track => track.effectiveAccess === 'free' ? 200 : fixture.membership === 'unavailable' ? 503 : vip ? 200 : expired ? 403 : 401;
    if (url.pathname === '/__local/requests') { send(200, counters); return; }
    if (url.pathname === '/api/music/catalog') {
      counters.catalog++;
      if (scenario === 'catalog-error') { send(503, { error: { code: 'MUSIC_PUBLIC_DISABLED' } }); return; }
      send(200, { schemaVersion: 2, catalogVersion: 1, locale, collections,
        tracks: scenario === 'empty' ? [] : demoTracks.map(({ art, ...track }) => track) }); return;
    }
    if (url.pathname === '/api/music/me/capabilities') {
      counters.capabilities++;
      send(fixture.membership === 'unavailable' ? 503 : 200, {
        authenticated: fixture.membership === 'vip', canPlayVipFull: vip, membershipStatus: vip ? 'active' : expired ? 'expired' : 'none',
        musicVipDeliveryEnabled: scenario === 'access-lifecycle', serverNow: new Date().toISOString(),
        validUntil: fixture.membership === 'vip' ? fixture.validUntil || new Date(Date.now() + 60000).toISOString() : null
      }); return;
    }
    const match = /^\/api\/music\/tracks\/([a-f0-9-]+)\/(cover|audio|access)$/.exec(url.pathname);
    if (match) {
      const track = demoTracks.find(item => item.id === match[1]);
      if (!track || url.searchParams.get('v') !== '1') { send(404, { error: { code: 'NOT_FOUND' } }); return; }
      if (match[2] === 'cover') { send(200, await readFile(resolve(root, 'scripts/fixtures/music-player/artwork', `${track.art}.webp`)), 'image/webp'); return; }
      if (match[2] === 'access') {
        counters.access++;
        const status = fullAccess(track), code = status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'MEMBERSHIP_EXPIRED' : 'MEMBERSHIP_UNAVAILABLE';
        send(status, { effectiveAccess: track.effectiveAccess, canPlayFull: status === 200, canPreview: track.previewAvailable,
          ...(status === 200 ? {} : { error: { code } }) }); return;
      }
      counters.audio++;
      if (scenario === 'queue-errors' || fixture.audioError === true) {
        send(503, { error: { code: 'LOCAL_AUDIO_FAILURE' } }); return;
      }
      const variant = url.searchParams.get('variant');
      if (!['full', 'preview'].includes(variant) || (variant === 'preview' && !track.previewAvailable)) { send(404, { error: { code: 'PREVIEW_UNAVAILABLE' } }); return; }
      if (variant === 'full' && fullAccess(track) !== 200) { send(fullAccess(track), { error: { code: 'LOCAL_FULL_DENIED' } }); return; }
      const key = `${track.id}:${variant}`;
      if (!wavs.has(key)) wavs.set(key, demoWav(variant === 'preview' ? { ...track, durationSec: 30 } : track));
      const bytes = wavs.get(key), range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (range) {
        const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        if (start >= bytes.length || start > end) { send(416, '', 'audio/wav', { 'Content-Range': `bytes */${bytes.length}` }); return; }
        send(206, bytes.subarray(start, end + 1), 'audio/wav', { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }); return;
      }
      send(200, bytes, 'audio/wav', { 'Accept-Ranges': 'bytes' }); return;
    }
    if (url.pathname === '/brand.webp') {
      send(200, await readFile(resolve(root, 'public/images/optimized/station-cat-logo-1668c2e5-160.webp')), 'image/webp'); return;
    }
    const staticRoot = libraryPreview ? resolve(root, 'dist') : output;
    const file = resolve(staticRoot, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(staticRoot + sep)) { send(404, 'Not found', 'text/plain'); return; }
    send(200, await readFile(file), mime[extname(file)] || 'application/octet-stream');
  } catch { send(404, 'Local preview unavailable', 'text/plain'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local music player: ${origin}/`));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
