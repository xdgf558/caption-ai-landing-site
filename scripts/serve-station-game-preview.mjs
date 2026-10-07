import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { createStationMusicRuntime } from './helpers/station-music-runtime.mjs';
import { catLifeSaveHarness } from './helpers/cat-life-save-harness.mjs';
import { readMusicResponse } from '../src/redesign/musicResponse.js';
const port = Number(process.env.STATION_GAME_PREVIEW_PORT || 4212);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port');
const runtime = await createStationMusicRuntime({ gameCases: true }), records = [];
const cases = ['missing', 'valid', 'corrupt', 'future', 'unavailable', 'identity-error', 'member-corrupt', 'legacy-empty', 'cached-session-error'];
const save = catLifeSaveHarness().game.state.game; save.player.gold = 87; save.meta.scT12Fixture = 'agent-preview-only';
const script = await readFile(new URL('./fixtures/station-games/control.js', import.meta.url), 'utf8');
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const server = http.createServer(async (incoming, outgoing) => {
  if (!['GET', 'HEAD'].includes(incoming.method) || !['127.0.0.1:' + port, 'localhost:' + port].includes(incoming.headers.host) || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) { outgoing.writeHead(405, { ...headers, Allow: 'GET, HEAD' }); outgoing.end(); return; }
  const url = new URL(incoming.url, 'http://127.0.0.1:' + port);
  const selected = /(?:^|;\s*)scT12Scenario=([a-z-]+)/.exec(incoming.headers.cookie || '')?.[1];
  const scenario = cases.includes(selected) ? selected : 'missing';
  let response;
  try {
    if (url.pathname === '/__fixture/select') {
      const requested = url.searchParams.get('scenario');
      response = new Response(cases.includes(requested) ? 'Selected disposable fixture' : 'Invalid fixture', { status: cases.includes(requested) ? 200 : 400,
        headers: { ...headers, ...(cases.includes(requested) ? { 'Set-Cookie': 'scT12Scenario=' + requested + '; Path=/; SameSite=Strict; HttpOnly' } : {}) } });
    } else if (url.pathname === '/__fixture/control.js') {
      response = new Response(script, { headers: { ...headers, 'Content-Type': 'application/javascript; charset=utf-8' } });
    } else if (url.pathname === '/__preview/requests') {
      response = Response.json(records, { headers });
    } else if (url.pathname === '/api/readers/session') {
      const sessionError = ['identity-error', 'cached-session-error'].includes(scenario);
      response = Response.json(sessionError ? { ok: false } : { ok: true, authenticated: scenario === 'member-corrupt', ...(scenario === 'member-corrupt' ? { account: { id: 7, displayName: 'Local fixture account' } } : {}) }, { status: sessionError ? 503 : 200, headers });
    } else if (url.pathname === '/api/readers/game-saves/cat-life') {
      response = Response.json({ ok: true, save: null }, { headers });
    } else {
      const publicPath = url.pathname; url.pathname = '/fixture-pages-on' + publicPath;
      const forwarded = new Headers({ 'CF-Connecting-IP': '192.0.2.81' });
      for (const name of ['range', 'if-none-match', 'accept']) if (incoming.headers[name]) forwarded.set(name, incoming.headers[name]);
      // Real cookies, credentials and outbound requests never reach fixture Worker/D1/R2.
      response = await runtime.mf.dispatchFetch(url, { method: incoming.method, headers: forwarded, redirect: 'manual' });
      records.push({ method: incoming.method, pathname: publicPath, status: response.status }); if (records.length > 1000) records.shift();
      if (incoming.method === 'GET' && response.headers.get('content-type')?.includes('text/html') && response.status === 200) {
        const html = await readMusicResponse(response, 1024 * 1024);
        const config = JSON.stringify({ scenario, save }).replace(/</g, '\\u003c');
        const output = new Headers(response.headers); output.delete('content-length'); output.delete('etag');
        response = new Response(html.replace('</head>', '<script>window.scT12Options=' + config + ';</script><script src="/__fixture/control.js"></script></head>'), { status: response.status, headers: output });
      }
    }
    outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), ...headers });
    if (incoming.method === 'HEAD' || !response.body) { await response.body?.cancel(); outgoing.end(); }
    else Readable.fromWeb(response.body).on('error', () => outgoing.destroy()).pipe(outgoing);
  } catch { outgoing.writeHead(503, headers); outgoing.end('Local preview unavailable'); }
});
server.listen(port, '127.0.0.1', () => console.log('Station Cat T12 local preview: http://127.0.0.1:' + port + '/games/cat-life-game/'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { void runtime.close().finally(() => process.exit()); }));
