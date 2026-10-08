import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { writeFile } from 'node:fs/promises';
import { createStationMemberRuntime, memberFixtureCookie, memberFixturePassword } from './helpers/station-member-runtime.mjs';
import { memberOrder } from '../src/redesign/memberReadouts.js';
let runtime;
const observations = [];
before(async () => { runtime = await createStationMemberRuntime(); });
after(async () => { await runtime?.close();
  if (process.env.STATION_MEMBER_EVIDENCE_FILE) await writeFile(process.env.STATION_MEMBER_EVIDENCE_FILE,
    JSON.stringify({ environment: 'disposable local Miniflare.dispatchFetch; actual Worker and D1/R2 bindings; no production HTTP',
      generatedAt: new Date().toISOString(), observations }, null, 2) + '\n');
});
const get = async (path, id = null, options = {}) => {
  const result = await runtime.mf.dispatchFetch('http://127.0.0.1' + path, { redirect: 'manual',
    ...options, headers: { ...(id ? { Cookie: memberFixtureCookie(id) } : {}), 'CF-Connecting-IP': '192.0.2.14', ...options.headers } });
  observations.push({ method: options.method || 'GET', pathname: new URL(path, 'http://127.0.0.1').pathname,
    fixtureAccount: id, status: result.status, headers: Object.fromEntries(['cache-control', 'x-robots-tag', 'vary', 'allow', 'location']
      .flatMap(name => result.headers.has(name) ? [[name, result.headers.get(name)]] : [])) });
  return result;
};
const ownedServices = ['/api/readers/session', '/api/readers/credits', '/api/novels/library', '/api/readers/bookmarks', '/api/readers/totp/status', '/api/readers/game-saves/cat-life', '/api/games/cat-life/entitlements'];
for (const [prefix, locale] of [['zh-hant', 'zh-Hant'], ['zh-hans', 'zh-Hans'], ['en', 'en'], ['ja', 'ja']]) test(`${locale}: actual opt-in shell retains account forms and manual music return without token metadata`, async () => {
  const res = await get('/fixture-member-on/' + prefix + '/library/?source=music&resetToken=private-sample'); assert.equal(res.status, 200);
  const html = await res.text(); assert.match(html, new RegExp('lang="' + locale + '"')); assert.ok(html.includes('data-sc-member-services')); assert.ok(html.includes('id="reader-login-form"'));
  assert.ok(html.includes('href="/games/cat-life/"')); assert.ok(html.includes('data-music-member-return')); assert.ok(!html.includes('private-sample'));
  assert.match(html, new RegExp('rel="canonical" href="http://127.0.0.1/' + prefix + '/library/"'));
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store'); assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow'); assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
  const head = await get('/fixture-member-on/' + prefix + '/library/', null, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
});
test('flag-off uses the original Member page; internal templates stay hidden; wrong method and missing assets fail closed', async () => {
  for (const prefix of ['', '/fixture-member-off']) { const r = await get(prefix + '/en/library/'); assert.equal(r.status, 200); assert.ok(!(await r.text()).includes('data-sc-member-services')); }
  for (const prefix of ['', '/fixture-member-on', '/fixture-member-off']) assert.equal((await get(prefix + '/member/site-shell/en/')).status, 404);
  assert.equal((await get('/fixture-member-on/en/library/', null, { method: 'POST' })).status, 405);
  assert.equal((await get('/fixture-member-no-assets/en/library/')).status, 503);
  const root = await get('/fixture-member-on/library/'); assert.equal(root.status, 301); assert.equal(root.headers.get('Location'), '/zh-hant/library/');
  const noSlash = await get('/fixture-member-on/ja/library'); assert.equal(noSlash.status, 301); assert.equal(noSlash.headers.get('Location'), '/ja/library/');
});
for (const id of [null, 1, 2, 3]) test(`actual reader HTTP permissions and cache policy for ${id === null ? 'visitor' : 'account ' + id}`, async () => {
  for (const path of ownedServices) {
    const res = await get(path, id); assert.equal(res.status, 200, path); assert.match(res.headers.get('Cache-Control'), /no-store/, path); assert.match(res.headers.get('X-Robots-Tag'), /noindex/, path);
    if (['/api/readers/session', '/api/readers/credits', '/api/novels/library', '/api/readers/bookmarks'].includes(path)) assert.match(res.headers.get('Vary'), /Cookie/i);
    const data = await res.json(); assert.equal(data.authenticated, id !== null, path);
    if (id && data.account) assert.equal(data.account.id ?? data.account.accountId, id, path);
    if (path.endsWith('/credits')) { assert.equal(data.account?.balanceCredits ?? 0, ({ 1: 100, 2: 23, 3: 0 })[id] ?? 0);
      assert.equal(Boolean(data.membership), id === 1); }
    if (path === '/api/novels/library') { assert.equal(data.entitlements?.length ?? 0, id === 2 ? 1 : 0); assert.equal(Boolean(data.membership), id === 1); }
    if (path === '/api/readers/bookmarks') assert.equal(data.bookmarks?.length ?? 0, id === 2 ? 1 : 0);
    if (path === '/api/games/cat-life/entitlements') assert.equal(data.entitlements?.length ?? 0, id === 2 ? 1 : 0);
    if (path === '/api/readers/game-saves/cat-life') assert.equal(data.save?.revision ?? 0, id === 2 ? 4 : 0);
  }
});
test('historical novel/game purchases do not grant current membership or a new music entitlement', async () => {
  const data = await (await get('/api/readers/credits', 2)).json(); assert.equal(data.membership, null);
  assert.equal((await get('/api/music/me/capabilities?locale=en', 2)).status, 200);
  const music = await (await get('/api/music/me/capabilities?locale=en', 2)).json(); assert.equal(music.canPlayVipFull, false); assert.equal(music.membershipStatus, 'none');
});
test('original historical order token keeps visitor, owner and other-account access distinctions', async () => {
  assert.equal((await get('/api/novels/payments/order?order=T14-HISTORY-ORDER')).status, 401);
  assert.equal((await get('/api/novels/payments/order?order=T14-HISTORY-ORDER', 1)).status, 403);
  const owned = await get('/api/novels/payments/order?order=T14-HISTORY-ORDER', 2); assert.equal(owned.status, 200);
  assert.equal(memberOrder(await owned.json(), { member: true, id: 2 }).fulfillment, 'fulfilled');
  const unbound = await get('/api/novels/payments/order?order=T14-GUEST-TIP'); assert.equal(unbound.status, 200); assert.equal(memberOrder(await unbound.json(), { member: false, id: null }).fulfillment, 'fulfilled');
  const refunded = await get('/api/novels/payments/order?order=T14-REFUNDED', 2); assert.equal(memberOrder(await refunded.json(), { member: true, id: 2 }).fulfillment, 'refunded');
  assert.equal((await get('/api/novels/payments/order?order=does-not-exist')).status, 404);
});
test('a local login/logout still uses the original cookie contract and identity', async () => {
  const login = await get('/api/readers/login', null, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1' },
    body: JSON.stringify({ identifier: 'ArchiveFriend', password: memberFixturePassword, redirectPath: '/en/library/' }) });
  assert.equal(login.status, 200); assert.equal((await login.json()).account.id, 2);
  const cookie = login.headers.get('Set-Cookie').split(';')[0]; assert.match(cookie, /^station_cat_reader_session=/);
  const active = await get('/api/readers/session', null, { headers: { Cookie: cookie } }); assert.equal((await active.json()).account.id, 2);
  const logout = await get('/api/readers/logout', null, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1' } }); assert.equal(logout.status, 200); assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/i);
  assert.equal((await (await get('/api/readers/session', null, { headers: { Cookie: cookie } })).json()).authenticated, false);
});
test('missing reader schema does not become a successful authenticated/empty service result', async () => {
  for (const path of ['/api/readers/session', '/api/readers/credits', '/api/novels/library', '/api/readers/bookmarks']) {
    const result = await get('/fixture-member-no-readers' + path, 2); assert.equal(result.status, 503, path);
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store'); assert.equal((await result.json()).code, 'READER_SERVICE_UNAVAILABLE');
  }
});
