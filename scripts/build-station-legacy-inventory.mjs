import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const baseline = JSON.parse(await readFile(new URL('docs/station-cat-redesign/T20-evidence/baseline-source-and-paths.json', root), 'utf8'));
const csv = await readFile(new URL('docs/station-cat-redesign/T02-route-inventory.csv', root), 'utf8');
const sha = createHash('sha256').update(csv).digest('hex');
assert.equal(sha, baseline.t02CsvSha256 || baseline.sourceCsvSha256);
const paths = baseline.paths;
assert.ok(Array.isArray(paths));
const old = /^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?(?:apps|signal|devlog|novel|works)(?:\/|$)/;
const service = path => /^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?apps\/[^/]+\/(?:download|android|support|privacy|terms)(?:\/|$)/.test(path);
const chapter = path => /^\/(?:en\/)?novel\/[^/]+\/chapter\/[^/]+\/$/.test(path);
const retired = new Set(paths.filter(path => old.test(path) && !service(path) && !chapter(path)));
const downloads = new Set(paths.filter(path => /\/apps\/[^/]+\/download\/$/.test(path)).map(path => path.slice(0,-1)));
for (const path of [...retired]) if (path.startsWith('/en/apps/')) retired.add(path.slice(3));
for (const path of [...downloads]) if (path.startsWith('/en/apps/')) downloads.add(path.slice(3));
// Exact aliases already documented in T02; no heuristic HTTP method grants.
for (const prefix of ['', '/zh-hans', '/zh-hant', '/ja']) retired.add(prefix + '/apps/anytls-desktop-manager/');
const inventory = { schemaVersion:1, baseline:baseline.baseline, sourceCsvSha256:sha,
  builtHtmlCount:paths.length, buildCondition:baseline.buildCondition, retiredStaticPaths:[...retired].sort(),
  downloadRoots:[...downloads].sort(), staticChapterPaths:paths.filter(chapter).sort() };
const source = '// T20 read-only source/build inventory. Not an HTTP, permission or deployment receipt.\nconst inventory = ' +
  JSON.stringify(inventory,null,2) + ";\nfor (const key of ['retiredStaticPaths', 'downloadRoots', 'staticChapterPaths']) Object.freeze(inventory[key]);\nexport const stationLegacyInventory = Object.freeze(inventory);\n";
const target = new URL('src/generated/stationLegacyRouteInventory.js', root);
if (process.argv.includes('--check')) assert.equal(await readFile(target,'utf8'),source,'Regenerate source/build inventory from the pinned baseline');
else await writeFile(target,source);
console.log('Pinned legacy inventory verified:', inventory.retiredStaticPaths.length, 'retired static entries,', inventory.downloadRoots.length, 'download roots; HTTP not inferred.');
