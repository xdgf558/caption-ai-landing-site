// LOCAL ONLY. Loopback host, no credentials, no proxy and no external bindings. NEVER DEPLOY.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tracks, demoWav } from './fixtures/music-player/data.mjs';
import { MUSIC_ANALYTICS_VERSION, validateMusicEvents } from '../src/music/analytics.js';
import { musicShareCardData, musicShareMetadata, MUSIC_SHARE_FONT } from '../src/music/shareCard.js';
import { normalizeMusicCardCover, renderMusicShareCard } from '../src/music/shareCardRender.js';
import { musicPageLocale } from '../src/music/pagePaths.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const libraryPreview = process.env.MUSIC_LIBRARY_PREVIEW === 'true';
const output = resolve(root, '.generated/music-player-preview');
const port = Number(process.env.MUSIC_PLAYER_PREVIEW_PORT || 4198);
const origin = `http://127.0.0.1:${port}`;
const wavs = new Map();
const analyticsPreview = process.env.MUSIC_ANALYTICS_PREVIEW === 'true';
const counters = { catalog: 0, track: 0, collection: 0, capabilities: 0, access: 0, audio: 0, lyrics: 0, analytics: 0, cards: 0 };
const sharePreview = process.env.MUSIC_SHARE_CARDS_PREVIEW === 'true';
async function analyticsAvailable() {
  if (!analyticsPreview) return false;
  try { return JSON.parse(await readFile(resolve(root,'.generated/music-analytics-preview-state.json'),'utf8')).available === true; }
  catch { return false; }
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  const analyticsPost=analyticsPreview && req.method==='POST' && url.pathname==='/api/music/events' && !url.search &&
    req.headers.origin===origin && req.headers['x-requested-with']==='StationCatMusicAnalytics';
  if (req.headers.host !== `127.0.0.1:${port}` || url.origin!==origin || (!['GET', 'HEAD'].includes(req.method) && !analyticsPost)) { res.writeHead(403); res.end(); return; }
  const send = (status, data, type = 'application/json', headers = {}) => {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(type === 'application/json' ? JSON.stringify(data) : data);
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Length': body.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  try {
    if(url.pathname==='/api/music/analytics/config') {
      send(200,{available:await analyticsAvailable(),consentVersion:MUSIC_ANALYTICS_VERSION});return;
    }
    if(analyticsPost) {
      if(!await analyticsAvailable()) {send(503,{error:{code:'LOCAL_STATISTICS_DISABLED'}});return;}
      // Opt-in fixture only: validate and count, retain no event/session payload.
      // Atomicity, publication and retention are tested in the separate D1 harness.
      let length=0, chunks=[];
      for await(const chunk of req) {length+=chunk.length;if(length>16384){send(413,{error:{code:'REQUEST_TOO_LARGE'}});return;}chunks.push(chunk);}
      try {
        const events=validateMusicEvents(JSON.parse(Buffer.concat(chunks).toString('utf8')),Date.now());
        counters.analytics+=events.length;send(200,{ok:true,accepted:events.length});
      } catch {send(400,{error:{code:'INVALID_INPUT'}});} return;
    }
    const scenario = process.env.MUSIC_PLAYER_PREVIEW_SCENARIO;
    const sharingDemo = ['sharing-return', 'sharing-large-text'].includes(scenario);
    // Local-only switches live outside tracked files. They are not sessions or credentials.
    const fixture = sharingDemo ? { membership: 'member' } : scenario === 'access-lifecycle'
      ? JSON.parse(await readFile(resolve(root, '.generated/music-player-access-state.json'), 'utf8')) : {};
    const locale = ['zh-Hans', 'zh-Hant', 'en', 'ja'].includes(url.searchParams.get('locale')) ? url.searchParams.get('locale') : url.pathname.includes('/music') ? musicPageLocale(url.pathname) : 'zh-Hans';
    const names = { 'zh-Hans': ['窗边的午后', '夜行小站', '慢慢醒来'], 'zh-Hant': ['窗邊的午後', '夜行小站', '慢慢醒來'], en: ['Afternoon by the Window', 'Night Station', 'Waking Slowly'], ja: ['窓辺の午後', '夜の小駅', 'ゆっくり目覚めて'] };
    const lyricsDemo = sharingDemo || ['lyrics-local', 'lyrics-error', 'lyrics-large-text'].includes(scenario);
    const mobileDesign = lyricsDemo || ['mobile-design', 'mobile-large-text'].includes(scenario);
    const mobileTracks = [tracks[0], tracks[2], tracks[1], { ...tracks[0], id: '44444444-4444-4444-8444-444444444444', art: 'rain', durationSec: 204 }];
    const mobileNames = { 'zh-Hans': ['窗边的午后', '清晨第一缕光', '晚安，小城市', '雨落在屋檐'], 'zh-Hant': ['窗邊的午後', '清晨第一縷光', '晚安，小城市', '雨落在屋簷'], en: ['Afternoon by the Window', 'The First Light of Morning', 'Goodnight, Little City', 'Rain on the Roof'], ja: ['窓辺の午後', '朝の最初の光', 'おやすみ、小さな街', '軒先に降る雨'] };
    const baseTracks = mobileDesign ? mobileTracks : scenario === 'library-500' ? Array.from({ length: 500 }, (_, i) => ({ ...tracks[i % 3], id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` })) : tracks;
    const demoTracks = baseTracks.map(track => scenario === 'access-lifecycle' && fixture.catalog !== 'free' && track.art !== 'night'
      ? { ...track, effectiveAccess: 'vip', previewAvailable: true, previewDurationSec: 30, previewSourceStartSec: 12 } : track).map((track, i) => ({ ...track,
      title: (mobileDesign ? mobileNames[locale][i] : names[locale][i % 3]) + (scenario === 'library-500' ? ` ${i + 1}` : ''),
      instrumental: lyricsDemo && track.art === 'morning', lyricsKind: lyricsDemo ? track.art === 'morning' ? 'none' : track.art === 'rain' ? 'txt' : 'lrc' : 'none',
      effectiveAccess: libraryPreview && (mobileDesign ? track.art === 'night' : i % 3 === 1) ? 'vip' : track.effectiveAccess,
      previewAvailable: libraryPreview && (mobileDesign ? track.art === 'night' : i % 3 === 1) ? true : track.previewAvailable,
      previewDurationSec: libraryPreview && (mobileDesign ? track.art === 'night' : i % 3 === 1) ? 30 : track.previewDurationSec,
      previewSourceStartSec: libraryPreview && (mobileDesign ? track.art === 'night' : i % 3 === 1) ? 12 : track.previewSourceStartSec,
      genres: i % 2 ? ['Ambient'] : ['Piano', 'Acoustic'], moods: i % 3 ? ['Calm'] : ['Warm'],
      summary: locale === 'en' ? 'Original synthesized audio for local interaction testing.' : locale === 'ja' ? '操作確認用に合成したローカル音源です。' : '本地合成演示音频，仅用于交互预览。',
      publishedAt: new Date(Date.UTC(2026, 8, 11) - i * 86400000).toISOString(), coverUrl: `/api/music/tracks/${track.id}/cover?v=1`
    }));
    const collections = libraryPreview ? [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'quiet-days', title: locale === 'en' ? 'Quiet Days' : locale === 'ja' ? '静かな日々' : '安静的日常', description: '', trackIds: demoTracks.slice(0, 3).map(t => t.id).reverse() }] : [];
    const expired = fixture.validUntil && Date.parse(fixture.validUntil) <= Date.now();
    const vip = fixture.membership === 'vip' && !expired;
    const fullAccess = track => track.effectiveAccess === 'free' ? 200 : fixture.membership === 'unavailable' ? 503 : vip ? 200 : expired ? 403 : 401;
    if (url.pathname === '/__local/requests') { send(200, counters); return; }
    const shareMatch = /^\/api\/music\/tracks\/([a-f0-9-]+)\/share\.png$/.exec(url.pathname);
    if (shareMatch) {
      if (!sharePreview) { send(503, { error: { code: 'MUSIC_SHARE_CARDS_DISABLED' } }); return; }
      const track = demoTracks.find(item => item.id === shareMatch[1]), format = url.searchParams.get('format');
      if (!track || url.searchParams.get('v') !== '1' || !['card', 'poster'].includes(format) || [...url.searchParams.keys()].sort().join(',') !== 'format,locale,v') { send(400, { error: { code: 'INVALID_INPUT' } }); return; }
      let state = {}; try { state = JSON.parse(await readFile(resolve(root, '.generated/music-share-preview-state.json'), 'utf8')); } catch {}
      if (state.unavailable) { send(503, { error: { code: 'LOCAL_CARD_UNAVAILABLE' } }); return; }
      counters.cards++;
      const cover = normalizeMusicCardCover(await readFile(resolve(root, 'scripts/fixtures/music-player/artwork', `${track.art}.webp`)), 'image/webp');
      const card = await renderMusicShareCard(musicShareCardData(track, origin, locale), format, cover, await readFile(resolve(root, 'public' + MUSIC_SHARE_FONT)));
      send(200, Buffer.from(card), 'image/png'); return;
    }
    if (url.pathname === '/api/music/catalog') {
      counters.catalog++;
      if (scenario === 'catalog-error') { send(503, { error: { code: 'MUSIC_PUBLIC_DISABLED' } }); return; }
      send(200, { schemaVersion: 2, catalogVersion: 1, locale, collections,
        tracks: scenario === 'empty' ? [] : (sharingDemo ? demoTracks.slice(0, 1) : demoTracks).map(({ art, ...track }) => track) }); return;
    }
    const trackDetail = /^\/api\/music\/tracks\/([a-f0-9-]+)$/.exec(url.pathname);
    if (trackDetail) {
      counters.track++;
      const track = demoTracks.find(item => item.id === trackDetail[1]);
      send(track ? 200 : 404, track ? { schemaVersion: 2, track } : { error: { code: 'TRACK_NOT_FOUND' } }); return;
    }
    const collectionDetail = /^\/api\/music\/collections\/([a-z0-9-]+)$/.exec(url.pathname);
    if (collectionDetail) {
      counters.collection++;
      const collection = collections.find(item => item.slug === collectionDetail[1]);
      send(collection ? 200 : 404, collection ? { schemaVersion: 2, collection, tracks: collection.trackIds.map(id => demoTracks.find(track => track.id === id)) }
        : { error: { code: 'COLLECTION_NOT_FOUND' } }); return;
    }
    if (url.pathname === '/api/music/me/capabilities') {
      counters.capabilities++;
      send(fixture.membership === 'unavailable' ? 503 : 200, {
        authenticated: ['vip', 'member'].includes(fixture.membership), canPlayVipFull: vip, membershipStatus: vip ? 'active' : expired ? 'expired' : 'none',
        musicVipDeliveryEnabled: sharingDemo || scenario === 'access-lifecycle', serverNow: new Date().toISOString(),
        validUntil: fixture.membership === 'vip' ? fixture.validUntil || new Date(Date.now() + 60000).toISOString() : null
      }); return;
    }
    // Read-only membership fixture. All POST requests remain rejected at the host gate.
    if (sharingDemo && ['/api/readers/session', '/api/readers/credits', '/api/readers/bookmarks', '/api/readers/totp/status', '/api/novels/library', '/api/novels/payments/status'].includes(url.pathname)) {
      send(200, { ok: true, authenticated: true, account: { id: 1, email: 'preview@example.test', username: 'Local preview', balanceCredits: 0 },
        membership: { active: false, expiresAt: null }, membershipSettings: { enabled: false }, entitlements: [], bookmarks: [], ledger: [], packs: [],
        totp: { enabled: false }, checkoutEnabled: false, publicCheckoutEnabled: false, readerCredits: { enabled: false, packs: [] } }); return;
    }
    const match = /^\/api\/music\/tracks\/([a-f0-9-]+)\/(cover|audio|access|lyrics)$/.exec(url.pathname);
    if (match) {
      const track = demoTracks.find(item => item.id === match[1]);
      if (!track || url.searchParams.get('v') !== '1') { send(404, { error: { code: 'NOT_FOUND' } }); return; }
      if (match[2] === 'cover') { send(200, await readFile(resolve(root, 'scripts/fixtures/music-player/artwork', `${track.art}.webp`)), 'image/webp'); return; }
      if (match[2] === 'lyrics') {
        counters.lyrics++;
        if (!lyricsDemo || track.lyricsKind === 'none' || scenario === 'lyrics-error') { send(scenario === 'lyrics-error' ? 503 : 404, { error: { code: 'LOCAL_LYRICS_UNAVAILABLE' } }); return; }
        const lines = ['窗边有一束慢慢的光', '落在书页和你的身旁', '城市轻轻放慢了脚步', '听风经过安静的小巷', '把今天的忙碌放下', '留一点时间给晚霞', '杯里的温暖还在', '远处的灯一盏盏亮', '雨声落在屋檐上', '小猫蜷在窗台旁', '愿你有柔软的梦', '明天再向阳光出发'];
        const words = track.lyricsKind === 'txt' ? lines.join('\n') : '[ti:本地原创交互测试]\n[offset:+250]\n' + lines.map((line, i) => `[00:${String(i * 5).padStart(2, '0')}.250]${line}`).join('\n');
        send(200, words, 'text/plain; charset=utf-8'); return;
      }
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
    let bytes = await readFile(file);
    if (sharePreview && extname(file) === '.html' && url.pathname.endsWith('/music/') && url.searchParams.has('track')) {
      const track = demoTracks.find(item => item.id === url.searchParams.get('track'));
      if (track) bytes = Buffer.from(bytes.toString().replace(/<title>[\s\S]*?<\/title>|<link\b[^>]*rel="canonical"[^>]*>|<meta\b[^>]*(?:property="og:[^"]*"|name="(?:twitter:[^"]*|description)")[^>]*>/gi, '').replace('</head>', musicShareMetadata(track, origin, locale) + '</head>'));
    }
    if (['mobile-large-text', 'lyrics-large-text', 'sharing-large-text'].includes(scenario) && extname(file) === '.html') bytes = Buffer.from(bytes.toString().replace('</head>', '<style>html{font-size:200% !important}</style></head>'));
    send(200, bytes, mime[extname(file)] || 'application/octet-stream');
  } catch { send(404, 'Local preview unavailable', 'text/plain'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local music player: ${origin}/`));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
