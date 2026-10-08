import http from 'node:http';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createStationMemberRuntime, memberFixturePassword } from './helpers/station-member-runtime.mjs';
const port = Number(process.env.STATION_MEMBER_PREVIEW_PORT || 4214);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port');
const root = fileURLToPath(new URL('../.generated/station-member-preview/', import.meta.url));
const runtime = await createStationMemberRuntime({ assetRoot: root }), records = [];
const origin = 'http://127.0.0.1:' + port, cases = ['guest', 'member', 'history', 'expired', 'session-error', 'cloud-error', 'delayed-credits', 'off'];
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const mutations = new Set(['/api/readers/login', '/api/readers/register', '/api/readers/logout', '/api/readers/password/change',
  '/api/readers/password-reset/confirm', '/api/readers/totp/setup', '/api/readers/totp/confirm', '/api/readers/membership/redeem', '/api/readers/bookmarks']);
const server = http.createServer(async (incoming, outgoing) => {
  try {
    if (!['127.0.0.1:' + port, 'localhost:' + port].includes(incoming.headers.host) || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) {
      outgoing.writeHead(403, headers); outgoing.end(); return;
    }
    const url = new URL(incoming.url, origin), cookie = incoming.headers.cookie || '';
    const selected = /(?:^|;\s*)scT14Case=([a-z-]+)/.exec(cookie)?.[1], scenario = cases.includes(selected) ? selected : 'guest';
    const read = ['GET', 'HEAD'].includes(incoming.method);
    if (!read && (incoming.headers.origin !== origin || !mutations.has(url.pathname) || !['POST', 'DELETE'].includes(incoming.method))) {
      outgoing.writeHead(405, { ...headers, Allow: 'GET, HEAD' }); outgoing.end(); return;
    }
    let response;
    if (read && url.pathname === '/__fixture/select') {
      const requested = url.searchParams.get('case');
      if (!cases.includes(requested)) response = new Response('Invalid local fixture', { status: 400, headers });
      else {
        const id = { member: 1, history: 2, expired: 3, 'cloud-error': 2, 'delayed-credits': 2 }[requested];
        const selectedHeaders = new Headers({ ...headers, Location: '/zh-hant/library/' });
        selectedHeaders.append('Set-Cookie', 'scT14Case=' + requested + '; Path=/; SameSite=Strict; HttpOnly');
        if (id) {
          // Re-selecting a local case creates a fresh original reader session.
          // A session revoked by the real Logout action stays revoked.
          const login = await runtime.mf.dispatchFetch(origin + '/api/readers/login', { method: 'POST',
            headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.14' },
            body: JSON.stringify({ identifier: ['GentleMember', 'ArchiveFriend', 'ExpiredFriend'][id - 1],
              password: memberFixturePassword, redirectPath: '/zh-hant/library/' }) });
          const localCookie = login.headers.getSetCookie().find(value => value.startsWith('station_cat_reader_session='));
          await login.body?.cancel();
          if (login.status !== 200 || !localCookie) throw new Error('Local fixture login unavailable');
          selectedHeaders.append('Set-Cookie', localCookie);
        } else selectedHeaders.append('Set-Cookie', 'station_cat_reader_session=; Path=/; SameSite=Strict; HttpOnly; Max-Age=0');
        response = new Response(null, { status: 303, headers: selectedHeaders });
      }
    } else if (read && url.pathname === '/__fixture/') {
      const ids = runtime.content.tracks.slice(0, 3).map(track => track.id);
      response = new Response('<!doctype html><html lang="zh-Hans"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>T14 本机验证夹具</title><style>body{font:16px system-ui;max-width:760px;margin:48px auto;padding:24px}a,button{display:block;padding:14px;margin:8px}code{background:#eee}</style><h1>T14 本机验证夹具</h1><p>仅用于一次性本机数据；账号、订单、云存档和音乐都是合成夹具。所有外部商户与网络调用均被阻止。</p><p>可自行登录：GentleMember / ArchiveFriend / ExpiredFriend<br>统一测试密码：<code>' + memberFixturePassword + '</code></p><p>历史订单：T14-HISTORY-ORDER；游客订单：T14-GUEST-TIP；退款：T14-REFUNDED。</p><h2>账号状态</h2>' + cases.map(name => '<a href="/__fixture/select?case=' + name + '">' + name + '</a>').join('') + '<h2>本机存储夹具</h2><button data-local="music">设置三首测试收藏</button><button data-local="legacy">设置旧版测试收藏</button><button data-local="corrupt">设置损坏测试收藏</button><button data-local="game">设置损坏游客存档</button><p role="status" id="local-status"></p><a href="/zh-hant/library/">回到会员预览</a><script>const ids=' + JSON.stringify(ids) + ';document.querySelectorAll("[data-local]").forEach(button=>button.onclick=()=>{const kind=button.dataset.local;if(kind==="game")localStorage.setItem("catGameSaveV1","{t14-corrupt-local-only");else if(kind==="legacy"){localStorage.removeItem("stationcat.music.v2");localStorage.setItem("stationcat.music.v1",JSON.stringify({schemaVersion:1,favorites:ids}));}else localStorage.setItem("stationcat.music.v2",kind==="corrupt"?"{t14-corrupt-local-only":JSON.stringify({schemaVersion:2,favorites:ids,recent:[ids[0]]}));document.getElementById("local-status").textContent="已设置本机测试夹具。"});</script></html>', { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    } else if (read && url.pathname === '/__fixture/requests') {
      response = Response.json(records, { headers });
    } else if (read && scenario === 'session-error' && url.pathname === '/api/readers/session' || read && scenario === 'cloud-error' && url.pathname === '/api/readers/game-saves/cat-life') {
      response = Response.json({ ok: false }, { status: 503, headers });
    } else {
      let body;
      if (!read) { const chunks = []; let bytes = 0; for await (const chunk of incoming) { bytes += chunk.length; if (bytes > 8192) throw new Error('Local request too large'); chunks.push(chunk); } body = Buffer.concat(chunks); }
      const forwarded = new Headers({ 'CF-Connecting-IP': '192.0.2.14' });
      for (const name of ['origin', 'content-type', 'idempotency-key', 'x-reader-account', 'range', 'if-none-match', 'accept']) if (incoming.headers[name]) forwarded.set(name, incoming.headers[name]);
      // Only a session actually present in the disposable database is forwarded.
      const token = /(?:^|;\s*)station_cat_reader_session=([^;]{1,200})/.exec(cookie)?.[1];
      if (token && await runtime.reader.prepare('SELECT id FROM reader_sessions WHERE session_hash=?').bind(createHash('sha256').update(token).digest('hex')).first()) forwarded.set('Cookie', 'station_cat_reader_session=' + token);
      const publicPath = url.pathname; url.pathname = '/fixture-member-' + (scenario === 'off' ? 'off' : 'on') + url.pathname;
      response = await runtime.mf.dispatchFetch(url, { method: incoming.method, headers: forwarded, ...(body?.length ? { body } : {}), redirect: 'manual' });
      if (read && scenario === 'delayed-credits' && publicPath === '/api/readers/credits') await new Promise(resolve => setTimeout(resolve, 2500));
      records.push({ method: incoming.method, pathname: publicPath, status: response.status }); if (records.length > 1000) records.shift();
    }
    const output = { ...Object.fromEntries(response.headers), ...headers };
    const cookies = response.headers.getSetCookie(); if (cookies.length) output['set-cookie'] = cookies;
    outgoing.writeHead(response.status, output);
    if (incoming.method === 'HEAD' || !response.body) { await response.body?.cancel(); outgoing.end(); }
    else Readable.fromWeb(response.body).on('error', () => outgoing.destroy()).pipe(outgoing);
  } catch (error) { if (!outgoing.headersSent) { outgoing.writeHead(503, headers); outgoing.end('Local T14 preview unavailable'); } else outgoing.destroy(); }
});
server.listen(port, '127.0.0.1', () => console.log('Station Cat T14 local preview: ' + origin + '/zh-hant/library/'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { void runtime.close().finally(() => process.exit()); }));
