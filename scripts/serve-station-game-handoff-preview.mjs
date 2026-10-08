import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStationMusicRuntime } from './helpers/station-music-runtime.mjs';
import { catLifeSaveHarness } from './helpers/cat-life-save-harness.mjs';
import { readMusicResponse } from '../src/redesign/musicResponse.js';
import { stationGameAssets } from './helpers/station-game-assets.mjs';
const port = Number(process.env.STATION_GAME_HANDOFF_PORT || 4213);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port');
const assetRoot = fileURLToPath(new URL('../.generated/station-game-handoff-preview/', import.meta.url));
const runtime = await createStationMusicRuntime({ gameCases: true, videoCases: true, gameAssets: request => stationGameAssets(request, assetRoot) });
const records = [], cases = ['missing', 'valid', 'corrupt', 'future', 'identity-error', 'boot-failure', 'never-ready', 'delayed-session'];
const save = catLifeSaveHarness().game.state.game; save.player.gold = 87; save.meta.scT12Fixture = 'agent-preview-only';
const control = await readFile(new URL('./fixtures/station-games/control.js', import.meta.url), 'utf8');
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const server = http.createServer(async (incoming, outgoing) => {
  if (!['GET', 'HEAD'].includes(incoming.method) || !['127.0.0.1:' + port, 'localhost:' + port].includes(incoming.headers.host) ||
    !incoming.url.startsWith('/') || incoming.url.startsWith('//')) { outgoing.writeHead(405, { ...headers, Allow: 'GET, HEAD' }); outgoing.end(); return; }
  const url = new URL(incoming.url, 'http://127.0.0.1:' + port);
  const selected = /(?:^|;\s*)scT13Scenario=([a-z-]+)/.exec(incoming.headers.cookie || '')?.[1];
  const scenario = cases.includes(selected) ? selected : 'valid';
  const baseScenario = ['boot-failure', 'never-ready', 'delayed-session'].includes(scenario) ? 'valid' : scenario;
  let response;
  try {
    if (url.pathname === '/__fixture/select') {
      const requested = url.searchParams.get('scenario');
      response = new Response(cases.includes(requested) ? 'Selected disposable fixture' : 'Invalid fixture', { status: cases.includes(requested) ? 200 : 400,
        headers: { ...headers, ...(cases.includes(requested) ? { 'Set-Cookie': 'scT13Scenario=' + requested + '; Path=/; SameSite=Strict; HttpOnly' } : {}) } });
    } else if (url.pathname === '/__fixture/options.js') {
      response = new Response('window.scT12Options=' + JSON.stringify({ scenario: baseScenario, save }) + ';window.scT13Scenario=' + JSON.stringify(scenario) + ';', { headers: { ...headers, 'Content-Type': 'application/javascript' } });
    } else if (url.pathname === '/__fixture/control.js') {
      response = new Response(control, { headers: { ...headers, 'Content-Type': 'application/javascript' } });
    } else if (url.pathname === '/__preview/requests') {
      response = Response.json(records, { headers });
    } else if (url.pathname === '/api/readers/session') {
      if (scenario === 'delayed-session' && (incoming.headers.referer || '').includes('/games/cat-life/?')) await new Promise(resolve => setTimeout(resolve, 2500));
      response = Response.json(scenario === 'identity-error' ? { ok: false } : { ok: true, authenticated: false }, { status: scenario === 'identity-error' ? 503 : 200, headers });
    } else if (url.pathname === '/api/readers/game-saves/cat-life') {
      response = Response.json({ ok: true, save: null }, { headers });
    } else if (scenario === 'boot-failure' && url.pathname === '/games/cat-life/src/js/main.js') {
      response = new Response('Intentional local startup failure', { status: 503, headers });
    } else if (scenario === 'never-ready' && url.pathname === '/games/cat-life/host-bridge.js') {
      response = new Response('// Local fixture deliberately withholds the runtime ready bridge.', { headers: { ...headers, 'Content-Type': 'application/javascript' } });
    } else {
      const publicPath = url.pathname; url.pathname = '/fixture-pages-on' + publicPath;
      const forwarded = new Headers({ 'CF-Connecting-IP': '192.0.2.83' });
      for (const name of ['range', 'if-none-match', 'accept']) if (incoming.headers[name]) forwarded.set(name, incoming.headers[name]);
      response = await runtime.mf.dispatchFetch(url, { method: incoming.method, headers: forwarded, redirect: 'manual' });
      records.push({ method: incoming.method, pathname: publicPath, status: response.status }); if (records.length > 1000) records.shift();
      if (incoming.method === 'GET' && response.status === 200 && response.headers.get('Content-Type')?.includes('text/html')) {
        const html = await readMusicResponse(response, 1024 * 1024);
        const output = new Headers(response.headers); output.delete('Content-Length'); output.delete('ETag');
        const insert = '<script src="/__fixture/options.js"></script><script src="/__fixture/control.js"></script>';
        response = new Response(html.replace('</head>', insert + '</head>'), { headers: output });
      }
    }
    outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), ...headers });
    if (incoming.method === 'HEAD' || !response.body) { await response.body?.cancel(); outgoing.end(); }
    else Readable.fromWeb(response.body).on('error', () => outgoing.destroy()).pipe(outgoing);
  } catch { outgoing.writeHead(503, headers); outgoing.end('Local preview unavailable'); }
});
server.listen(port, '127.0.0.1', () => console.log('Station Cat T13 local preview: http://127.0.0.1:' + port + '/games/cat-life-game/'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { void runtime.close().finally(() => process.exit()); }));
