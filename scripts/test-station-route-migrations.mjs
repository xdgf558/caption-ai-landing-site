import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrationFlags, routeMigrationEnabled, migrationPath, migrationServicePath, chapterRoute, brandHref, publicSearchRoute, cleanMigrationQuery } from '../src/redesign/routeMigrationPaths.js';
import { handleStationRouteMigration } from '../src/redesign/routeMigrations.js';
import { assessRouteProposal } from '../src/redesign/legacyRouteStore.js';
import { applyMigrationMetadata, searchIndexing } from '../src/redesign/searchMetadata.js';
import { stationLanguageHref } from '../src/redesign/routes.js';
import { inspectMigrationRouting } from '../src/redesign/routeMigrationProfile.js';
const enabled = Object.fromEntries(migrationFlags.map(key => [key, true]));
for (const flag of migrationFlags) test(`missing ${flag} preserves legacy dispatch without binding/method inspection`, async () => {
  let reads = 0;
  const env = { ...enabled, [flag]: undefined, get ASSETS() { reads++; throw new Error('no reads'); }, get MUSIC_DB() { reads++; throw new Error('no reads'); } };
  for (const path of ['/?token=private','/apps/','/music/unknown/child/','/games/','/novel/a/chapter/b/','/sitemap.xml']) {
    assert.equal(await handleStationRouteMigration(new Request('https://wwwstationcat.org' + path, { method: 'POST' }), env), null);
  }
  const response = new Response('unchanged', { headers: { 'Content-Type': 'text/html' } });
  assert.equal(applyMigrationMetadata(new Request('https://wwwstationcat.org/'), env, response), response);
  assert.equal(reads, 0);
});
test('migration path normalization excludes nested encodings and control/query injection', () => {
  assert.equal(migrationPath('/en/%6dusic/tracks/a/index.html'), '/en/music/tracks/a/');
  assert.equal(migrationPath('/signal//old\\child'), '/signal/old/child');
  for (const path of ['/signal/%2561/','/%00/','/%3f/','/%23/','/%20/','/%bad/','//']) {
    if (path === '//') assert.equal(migrationPath(path), '/'); else assert.equal(migrationPath(path), null);
  }
});
test('service priority retains runtime resources, accounts, downloads and policies', () => {
  for (const path of ['/api/mobile/v1/me/music/likes','/api/payments/creem/webhook','/admin/api/music','/games/cat-life/index.html',
    '/games/cat-life/src/js/main.js','/en/apps/caption-ai/android/','/apps/privatepinyin/support/','/ja/apps/simplecut-pro/download/','/zh-hant/library/']) assert.equal(migrationServicePath(path), true);
  assert.equal(migrationServicePath('/en/apps/cat-life-game/'), false);
});
test('chapter aliases preserve the actual root/en reading address', () => {
  assert.equal(chapterRoute('/works/story/ch-one/').href, '/novel/story/chapter/ch-one/');
  assert.equal(chapterRoute('/ja/works/story/ch-one/').href, '/novel/story/chapter/ch-one/');
  assert.equal(chapterRoute('/en/works/story/ch-one/').href, '/en/novel/story/chapter/ch-one/');
  assert.equal(chapterRoute('/ja/novel/story/chapter/ch-one/'), null);
});
test('localized about applies only to the migration profile; canonical has four corresponding entities', () => {
  assert.equal(stationLanguageHref('en','/about/'), '/about/');
  assert.equal(stationLanguageHref('en','/about/','',{brandRoutes:true}), '/en/about/');
  assert.equal(brandHref('zh-Hant','about'), '/about/');
  assert.equal(publicSearchRoute('/en/music/tracks/a/').alternates.length, 4);
  assert.equal(publicSearchRoute('/games/cat-life/'), null);
  assert.equal(publicSearchRoute('/novel/a/chapter/b/'), null);
});
test('proposal soft associations cannot authorize a runtime redirect or credential transfer', () => {
  for (const target of ['https://example.test/','//example.test/','/admin/','/api/private/','/games/cat-life/','/old/']) {
    assert.equal(assessRouteProposal({old_path:'/old/',action:'redirect',new_path:target}), 'invalid');
  }
  assert.equal(assessRouteProposal({old_path:'/old/',action:'redirect',new_path:'/music/tracks/valid/',approved_at:1}), 'requires-entity-and-http-review');
  assert.equal(cleanMigrationQuery('?token=secret&src=a&src=b&utm_source=good&redirect=https://example.test'), 'utm_source=good');
});
test('preview hosts never enable indexing even with the search switch', () => {
  assert.equal(searchIndexing(new URL('http://127.0.0.1:4220/'),{STATION_SEARCH_INDEXING_ENABLED:true}), false);
  assert.equal(searchIndexing(new URL('https://other.example/'),{STATION_SEARCH_INDEXING_ENABLED:true}), false);
  assert.equal(searchIndexing(new URL('https://wwwstationcat.org/'),{STATION_SEARCH_INDEXING_ENABLED:true}), true);
  assert.equal(routeMigrationEnabled(enabled), true);
});
test('upstream Assets routing is a separate release dependency, not implicit in runtime flags', () => {
  assert.equal(inspectMigrationRouting(true).satisfied,true);
  assert.equal(inspectMigrationRouting(['/*']).satisfied,true);
  const insufficient=inspectMigrationRouting(['/en/*','/music/*','/*%*']);
  assert.equal(insufficient.satisfied,false);assert.ok(insufficient.missing.includes('/'));
  assert.ok(insufficient.missing.includes('/robots.txt'));
});
