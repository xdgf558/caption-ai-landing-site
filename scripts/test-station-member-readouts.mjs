import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMemberMusic, memberIdentity, memberCloudSave, memberGameItems, memberOrder, createMemberReadouts } from '../src/redesign/memberReadouts.js';
import { createMemberReaderEpoch } from '../src/redesign/memberReaderEpoch.js';
import { handleStationMemberPage, stationMemberRoute } from '../src/redesign/memberPages.js';
import { privateReaderResponse, privateReaderRequest } from '../src/redesign/memberPrivacy.js';
import { memberCopy } from '../src/redesign/memberCopy.js';
const a = 'ca760000-0000-4000-8000-000000000001', b = 'ca760000-0000-4000-8000-000000000002';
const memory = rows => { const values = new Map(rows), writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem: (...args) => writes.push(args), removeItem: (...args) => writes.push(args) }; };
const response = (data, status = 200) => Response.json(data, { status });
const session = id => ({ ok: true, authenticated: id !== null, ...(id !== null ? { account: { id } } : {}) });
const probe = { baseKey: 'catGameSaveV1', memberKey: id => 'catGameSaveV1:member:' + id, inspect: (_, key) => ({ status: key === 'catGameSaveV1' ? 'corrupt' : 'missing' }) };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise(done => setImmediate(done));

test('opening Member reads v2/v1 without writing, migrating, adopting or leaking stored playback secrets', () => {
  for (const version of [1, 2]) {
    const raw = JSON.stringify({ schemaVersion: version, favorites: [a, a, 'bad', b], recent: [b], queue: [a], privateAudioUrl: 'must-not-project' });
    const storage = memory([['stationcat.music.v' + version, raw]]);
    assert.deepEqual(readMemberMusic(() => storage), { favorites: [a, b], recent: version === 1 ? [] : [b], warning: version === 1 ? 'legacy' : null });
    assert.deepEqual(storage.writes, []); assert.equal(storage.values.size, 1); assert.equal(storage.getItem('stationcat.music.v' + version), raw);
  }
});
test('damaged, future and inaccessible local music are distinct from a genuinely empty library', () => {
  for (const raw of ['{', '{"schemaVersion":99}', '{"schemaVersion":2,"favorites":{}}', 'x'.repeat(512 * 1024 + 1)]) {
    const storage = memory([['stationcat.music.v2', raw]]);
    assert.equal(readMemberMusic(() => storage).warning, 'corrupt'); assert.deepEqual(storage.writes, []);
  }
  assert.equal(readMemberMusic(() => { throw new Error('denied'); }).warning, 'storage');
  assert.deepEqual(readMemberMusic(() => memory([])), { favorites: [], recent: [], warning: null });
});
test('current data takes precedence over legacy without overwriting either copy', () => {
  const storage = memory([['stationcat.music.v2', '{'], ['stationcat.music.v1', JSON.stringify({ schemaVersion: 1, favorites: [a] })]]);
  assert.equal(readMemberMusic(() => storage).warning, 'corrupt'); assert.deepEqual(storage.writes, []);
});
test('identity, cloud presence and game items require the confirmed same account', () => {
  const identity = memberIdentity(session(1)); assert.deepEqual(memberIdentity(session(null)), { member: false, id: null });
  for (const data of [{}, { ok: true }, session(0), session('1'), { ok: false, authenticated: false }]) assert.throws(() => memberIdentity(data));
  assert.deepEqual(memberCloudSave({ ...session(1), save: null }, identity), { status: 'missing' });
  assert.deepEqual(memberCloudSave({ ...session(1), save: { revision: 4, updatedAt: '2026-10-08T00:00:00Z', data: 'secret' } }, identity), { status: 'saved', revision: 4, updatedAt: '2026-10-08T00:00:00Z' });
  for (const data of [{ ...session(2), save: null }, { ...session(null), save: null }]) assert.throws(() => memberCloudSave(data, identity), /ACCOUNT_CHANGED/);
  for (const save of [undefined, {}, { revision: 0, updatedAt: 'bad' }]) assert.throws(() => memberCloudSave({ ...session(1), save }, identity));
  assert.deepEqual(memberGameItems({ ...session(1), entitlements: [{}] }, identity), { status: 'known', count: 1 });
  assert.throws(() => memberGameItems({ ...session(2), entitlements: [] }, identity), /ACCOUNT_CHANGED/);
});
test('order projection preserves anonymous historical access and reports refund/reversal before old delivery', () => {
  const data = { ...session(null), order: { status: 'finished', priceAmount: '2.00', priceCurrency: 'USD', originalOrderToken: 'secret', paymentUrl: 'private' },
    fulfillment: { complete: true, needsReview: false, pending: false } };
  assert.deepEqual(memberOrder(data, null), { status: 'found', amount: '2.00', currency: 'USD', fulfillment: 'fulfilled' });
  assert.equal(memberOrder({ ...data, order: { ...data.order, status: 'refunded' } }, null).fulfillment, 'refunded');
  assert.equal(memberOrder({ ...data, fulfillment: { ...data.fulfillment, reason: 'credits_reversed' } }, null).fulfillment, 'refunded');
  for (const status of ['failed', 'expired']) assert.equal(memberOrder({ ...data, order: { ...data.order, status } }, null).fulfillment, status);
  assert.throws(() => memberOrder({ ...data, ...session(2) }, { member: true, id: 1 }), /ACCOUNT_CHANGED/);
  assert.throws(() => memberOrder({ ...data, fulfillment: {} }, null));
});
test('guest readout probes only the guest slot and never reads cloud/private native music', async () => {
  const reads = [], storage = memory([['catGameSaveV1', '{']]);
  const view = createMemberReadouts({ storage: () => storage, probe, fetcher: async (path, options) => { reads.push([path, options.credentials, options.cache]); return response(session(null)); } });
  await view.refresh(); assert.equal(view.snapshot().local, 'corrupt'); assert.equal(view.snapshot().cloud.status, 'guest');
  assert.deepEqual(reads, [['/api/readers/session', 'same-origin', 'no-store']]); assert.deepEqual(storage.writes, []); view.destroy();
});
test('confirmed account probes its own local slot, never claims the guest slot, and errors do not become missing saves', async () => {
  const slots = [], view = createMemberReadouts({ storage: () => memory([]), probe: { ...probe, inspect: (_, key) => { slots.push(key); return { status: 'missing' }; } },
    fetcher: async path => response(path.endsWith('session') ? session(2) : { ok: false }, 200) });
  await view.refresh(); assert.deepEqual(slots, ['catGameSaveV1:member:2']); assert.equal(view.snapshot().cloud.status, 'error'); assert.equal(view.snapshot().items.status, 'error'); view.destroy();
});
test('late read responses after an account change cannot revive identity, saves or items even when abort is ignored', async () => {
  const gate = deferred(); let account = 1, observedSignal;
  const view = createMemberReadouts({ storage: () => memory([]), probe, fetcher: async (path, options) => {
    if (path.endsWith('session')) return response(session(account));
    if (account === 1) { observedSignal = options.signal; await gate.promise; return response({ ...session(1), save: { revision: 9, updatedAt: '2026-10-08T00:00:00Z' }, entitlements: [{}] }); }
    return response({ ...session(2), save: null, entitlements: [] });
  } });
  const first = view.refresh(); await flush(); view.invalidate(); assert.equal(observedSignal.aborted, true);
  account = 2; await view.refresh(); gate.resolve(); await first;
  assert.equal(view.snapshot().identity.id, 2); assert.equal(view.snapshot().cloud.status, 'missing'); assert.equal(view.snapshot().items.count, 0); view.destroy();
});
test('returned different owner clears the whole readout rather than borrowing permissions', async () => {
  const view = createMemberReadouts({ storage: () => memory([]), probe, fetcher: async path => response(path.endsWith('session') ? session(1) : { ...session(2), save: null, entitlements: [{}] }) });
  await view.refresh(); assert.equal(view.snapshot().phase, 'changed'); assert.equal(view.snapshot().identity, null); assert.equal(view.snapshot().order.status, 'idle'); view.destroy();
});
test('failed identity never probes a slot, and a later explicit retry recovers', async () => {
  let fail = true, calls = 0;
  const view = createMemberReadouts({ storage: () => memory([]), probe: { ...probe, inspect: () => { ++calls; return { status: 'valid' }; } }, fetcher: async () => response(fail ? { ok: false } : session(null), fail ? 503 : 200) });
  await view.refresh(); assert.equal(view.snapshot().phase, 'error'); assert.equal(calls, 0);
  fail = false; await view.refresh(); assert.equal(view.snapshot().phase, 'guest'); assert.equal(calls, 1); view.destroy();
});
test('historical order authentication, missing and service failure remain distinct', async () => {
  for (const [http, expected] of [[401, 'auth'], [403, 'other'], [404, 'missing'], [503, 'error']]) {
    const view = createMemberReadouts({ storage: () => memory([]), probe, fetcher: async path => response(path.endsWith('session') ? session(null) : { ok: false }, path.endsWith('session') ? 200 : http) });
    await view.refresh(); await view.lookupOrder('original-token'); assert.equal(view.snapshot().order.status, expected); view.destroy();
  }
});
test('late historical order result is dropped and aborted when session changes or page is disposed', async () => {
  const gate = deferred(); let signal;
  const view = createMemberReadouts({ storage: () => memory([]), probe, fetcher: async (path, options) => {
    if (path.endsWith('session')) return response(session(null)); signal = options.signal; await gate.promise;
    return response({ ...session(null), order: { status: 'finished' }, fulfillment: { complete: true, needsReview: false, pending: false } });
  } });
  await view.refresh(); const lookup = view.lookupOrder('unbound-original'); await flush(); view.invalidate(); assert.equal(signal.aborted, true);
  gate.resolve(); await lookup; assert.equal(view.snapshot().order.status, 'idle'); view.destroy();
});
test('oversized service bodies fail closed instead of displaying partial records', async () => {
  const view = createMemberReadouts({ storage: () => memory([]), probe, fetcher: async () => new Response('x'.repeat(128 * 1024 + 1)) });
  await view.refresh(); assert.equal(view.snapshot().phase, 'error'); view.destroy();
});
test('reader presentation epoch rejects late responses, other-account credits and invalid session shapes', () => {
  let clears = 0, mismatches = 0;
  const guard = createMemberReaderEpoch({ onInvalidate: () => ++clears, onMismatch: () => ++mismatches });
  const old = guard.begin(); assert.equal(guard.bind(old, session(1)), true);
  assert.equal(guard.accept(old, { ...session(1), account: { accountId: 1 } }), true);
  assert.equal(guard.accept(old, { ...session(1), account: undefined }, { ownerRequired: false }), true);
  assert.equal(guard.accept(old, session(2)), false); assert.equal(mismatches, 1);
  const fresh = guard.begin(); guard.bind(fresh, session(2)); assert.equal(guard.accept(old, session(1)), false);
  assert.equal(guard.accept(fresh, session(2)), true); assert.equal(guard.bind(fresh, session('2')), false); assert.ok(clears >= 3);
});
test('closed member rollout does not touch bindings, methods, redirects or content flags', async () => {
  const env = new Proxy({}, { get: (_, key) => { if (key === 'STATION_MEMBER_PAGES_ENABLED') return 'false'; throw new Error('binding touched: ' + String(key)); } });
  for (const path of ['/library/', '/en/library', '/ja/library/', '/zh-hans/library/']) for (const method of ['GET', 'HEAD', 'POST']) {
    assert.equal(await handleStationMemberPage(new Request('https://wwwstationcat.org' + path, { method }), env), null);
  }
  assert.equal(await handleStationMemberPage(new Request('https://wwwstationcat.org/music/'), env), null);
  assert.equal((await handleStationMemberPage(new Request('https://wwwstationcat.org/member/site-shell/en/'), env)).status, 404);
  assert.deepEqual(stationMemberRoute('/library'), { locale: 'zh-Hant' }); assert.equal(stationMemberRoute('/en/library/old/'), null);
});
test('enabled shell failures are private, retryable and do not read D1', async () => {
  const env = { STATION_MEMBER_PAGES_ENABLED: 'true', get WAITLIST_DB() { throw new Error('no D1'); }, ASSETS: { fetch: async () => new Response('wrong body', { headers: { 'Content-Type': 'text/html' } }) } };
  const invalid = await handleStationMemberPage(new Request('https://wwwstationcat.org/en/library/'), env);
  assert.equal(invalid.status, 503); assert.equal(invalid.headers.get('Cache-Control'), 'private, no-store'); assert.equal(invalid.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const method = await handleStationMemberPage(new Request('https://wwwstationcat.org/en/library/', { method: 'POST' }), env); assert.equal(method.status, 405); assert.equal(method.headers.get('Allow'), 'GET, HEAD');
  const alias = await handleStationMemberPage(new Request('https://wwwstationcat.org/en/library?source=music'), env); assert.equal(alias.headers.get('Location'), '/en/library/?source=music');
});
test('private reader policy preserves status, cookies, existing vary and exact response body', async () => {
  const original = new Response('{"ok":true,"balance":23}', { status: 201, headers: { 'Set-Cookie': 'synthetic-only=value', Vary: 'Accept-Encoding', 'Content-Type': 'application/json' } });
  const result = privateReaderResponse(original); assert.equal(result.status, 201); assert.equal(result.headers.get('Set-Cookie'), 'synthetic-only=value');
  assert.equal(result.headers.get('Vary'), 'Accept-Encoding, Cookie'); assert.equal(result.headers.get('Cache-Control'), 'private, no-store'); assert.equal(await result.text(), '{"ok":true,"balance":23}');
});
test('all Member readout states have complete four-language messages', () => {
  const keys = Object.keys(memberCopy['zh-Hant']).sort();
  for (const copy of Object.values(memberCopy)) { assert.deepEqual(Object.keys(copy).sort(), keys); for (const message of Object.values(copy)) assert.equal(typeof message, 'string'); }
});
test('reader database failures return a private retryable response without stack or SQL details', async () => {
  const result = await privateReaderRequest(() => { throw new Error('private SQL and account details'); });
  assert.equal(result.status, 503); assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(result.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const text = await result.text(); assert.ok(!text.includes('SQL')); assert.equal(JSON.parse(text).code, 'READER_SERVICE_UNAVAILABLE');
});
