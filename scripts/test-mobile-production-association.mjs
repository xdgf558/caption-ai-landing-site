import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'smol-toml';
import {productionAssociation, productionAssociationPath} from '../src/mobile/productionAssociation.js';

const origin = 'https://wwwstationcat.org';
const noBindings = new Proxy({}, {get: (_target, key) => {
  if (['WAITLIST_DB', 'MUSIC_DB', 'MUSIC_BUCKET'].includes(key)) throw new Error('Unexpected binding access');
  return undefined;
}});

test('clean-checkout association stays unavailable and does not disclose identity or redirect', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await productionAssociation(new Request(origin + productionAssociationPath, {method}), noBindings);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('location'), null);
    assert.doesNotMatch(await response.text(), /2AM5S7BM2N|org\.stationcat\.music/);
  }
});

test('association denies alternate hosts, paths, queries and writes before configuration', async () => {
  const unreadable = new Proxy({}, {get: () => { throw new Error('Unexpected configuration read'); }});
  for (const url of [
    'https://stationcat.org' + productionAssociationPath,
    'https://native.example.test' + productionAssociationPath,
    origin + '.' + productionAssociationPath,
    origin + productionAssociationPath + '?preview=1',
    origin + '/music/'
  ]) assert.equal((await productionAssociation(new Request(url), unreadable)).status, 404);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const response = await productionAssociation(new Request(origin + productionAssociationPath, {method}), unreadable);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
});

test('website assets cannot shadow the native browser or association gates', async () => {
  const config = parse(await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'));
  assert.ok(config.assets.run_worker_first.includes('/auth/mobile/*'));
  assert.ok(config.assets.run_worker_first.includes(productionAssociationPath));
  assert.ok(config.assets.run_worker_first.includes('/api/*'));
  assert.notEqual(config.vars.MOBILE_AUTH_ENABLED, 'true');
});
