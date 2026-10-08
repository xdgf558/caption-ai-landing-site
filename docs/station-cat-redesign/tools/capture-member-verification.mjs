// Preserve the already completed final local run, not a hosted-CI assertion.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = new URL('../T14-evidence/', import.meta.url);
const base = 'd2c7f6b4a759734286c1496bd042f673c49756de';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const read = path => readFile(new URL(path, 'file://' + root));
if (process.argv.includes('--verify')) {
  const saved = JSON.parse(await readFile(new URL('manifest.json', evidence), 'utf8'));
  for (const file of saved.files) if (hash(await read(file.path)) !== file.sha256) throw new Error('Source changed: ' + file.path);
  for (const artifact of saved.artifacts) if (hash(await readFile(new URL(artifact.name, evidence))) !== artifact.sha256) throw new Error('Artifact changed: ' + artifact.name);
  console.log(JSON.stringify({ verifiedSources: saved.files.length, verifiedArtifacts: saved.artifacts.length }));
  process.exit(0);
}
const commands = [
  ['member-tests', 'STATION_MEMBER_EVIDENCE_FILE=/private/tmp/station-cat-t14-http-contract.json npm run test:redesign:member', 32],
  ['player-tests', 'npm run test:redesign:player', 149],
  ['games-tests', 'npm run test:redesign:games', 52],
  ['game-session-tests', 'npm run test:redesign:game-session', 13],
  ['mobile-music', 'npm run test:mobile:music', 18],
  ['mobile-library', 'npm run test:mobile:library', 23],
  ['npm-test', 'npm test', null],
  ['preview-build', 'npm run build:redesign:member', null],
  ['home-preview-build', 'npm run build:redesign:preview', null],
  ['build', 'ALLOW_EMPTY_SERIAL_CONTENT=1 ASTRO_TELEMETRY_DISABLED=1 npm run build', null],
  ['staging-build', 'node scripts/build-music-staging-assets.mjs', null],
  ['staging-check', 'node scripts/check-music-staging-assets.mjs', null],
];
const results = [];
for (const [name, command, count] of commands) {
  const original = '/private/tmp/station-cat-t14-' + name + '.log';
  const bytes = await readFile(original), info = await stat(original), output = bytes.toString();
  if (count && (!output.includes('ℹ tests ' + count) || !output.includes('ℹ fail 0'))) throw new Error('Invalid final log: ' + name);
  if (name === 'npm-test' && !output.includes('Signal DeepSeek controlled-rollout tests passed.')) throw new Error('Incomplete original npm test');
  if (name === 'staging-check' && !output.includes('Verified 8 staging pages and 36 exact asset files.')) throw new Error('Staging check failed');
  await copyFile(original, new URL(name + '.log', evidence));
  results.push({ name, command, exitCode: 0, recordedExitCodeSource: 'completed exec shell result; not inferred from absence of errors',
    completedAt: info.mtime.toISOString(), count, sha256: hash(bytes), rawLog: name + '.log' });
}
await copyFile('/private/tmp/station-cat-t14-http-contract.json', new URL('http-contract.json', evidence));
await copyFile(new URL('../../../design-qa.md', import.meta.url), new URL('design-qa.md', evidence));
const current = git(['diff', '--name-only', base, '--']).split('\n').filter(path => path && !path.startsWith('docs/station-cat-redesign/T14-evidence/'));
const newFiles = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(path =>
  /^(?:src\/|scripts\/|public\/)/.test(path));
const anchors = ['package-lock.json', 'astro.config.mjs', 'wrangler.toml', 'public/_headers',
  'src/readerMembership.js', 'src/music/access.js', 'src/music/membership.js', 'src/music/navigation.js',
  'src/scripts/musicLocalData.js', 'src/scripts/musicMemberReturn.js', 'src/scripts/readerSessionEvents.js',
  'src/mobile/library.js', 'src/mobile/music.js', 'src/mobile/musicEntitlements.js', 'src/mobile/sessions.js',
  'src/mobile/deletion.js', 'src/mobile/environment.js',
  'public/games/cat-life/src/js/main.js', 'public/games/cat-life/src/js/state/saveStatus.js',
  'public/games/cat-life/src/js/state/saveSystem.js', 'public/games/cat-life/src/js/utils/storage.js',
  'public/games/cat-life/cloud-sync.js', 'public/games/cat-life/cloud-sync-policy.js',
  'public/games/cat-life/host-bridge.js',
  'docs/station-cat-redesign/T14-member-and-historical-services.md',
  'docs/station-cat-redesign/tools/build-member-comparisons.mjs', 'docs/station-cat-redesign/tools/capture-member-verification.mjs',
  'docs/station-cat-redesign/T04-evidence/gentle-station/source.png',
  'scripts/fixtures/station-redesign/assets/gentle-station/hero.webp'];
const migrations = git(['ls-files', '--', '*.sql']).split('\n').filter(path => /^migrations(?:-.*)?\//.test(path));
const files = [];
for (const path of new Set([...current, ...newFiles, ...anchors, ...migrations])) {
  let bytes;
  try { bytes = await read(path); } catch (error) { if (error.code === 'ENOENT' && anchors.includes(path)) continue; throw error; }
  let baseSha256 = null;
  try { baseSha256 = hash(execFileSync('git', ['show', base + ':' + path], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })); } catch {}
  files.push({ path, bytes: bytes.length, sha256: hash(bytes), baseSha256,
    unchangedFromBase: baseSha256 ? hash(bytes) === baseSha256 : null });
}
if (files.some(file => migrations.includes(file.path) && !file.unchangedFromBase)) throw new Error('T14 must not change migrations');
const art = files.find(file => file.path === 'public/images/station-gentle/member-hero.webp');
if (art.sha256 !== files.find(file => file.path.endsWith('/gentle-station/hero.webp')).sha256) throw new Error('Approved artwork bytes differ');
const observations = JSON.parse(await readFile(new URL('browser-observations.json', evidence), 'utf8'));
const summary = { task: 'T14', generatedAt: new Date().toISOString(), baseCommit: base, branch: git(['branch', '--show-current']),
  environment: { os: 'macOS local', node: process.version, npm: execFileSync('npm', ['--version'], { cwd: root, encoding: 'utf8' }).trim(),
    browser: 'Codex IAB; 1440/360px four-language guests, 390px confirmed current member; viewport only', remoteCredentials: false, productionRequests: false },
  results, migrationsUnchanged: migrations.length, sourceManifest: 'manifest.json', browserObservations: observations.length,
  uiResult: 'passed for documented local scope', hostedCi: 'Not evidenced here; verify this PR exact head independently',
  caveats: ['The main build permits empty protected serial body content; it is not a production bundle.',
    'Synthetic cloud revision=4 proves existence display only, not save validity or synchronization.',
    'Original browser storage bytes and disabled storage are model-test evidence, not a native browser settings/export check.',
    'In-flight writes, Cookie/write atomicity, localStorage atomicity, T13 one-second exit/no sandbox remain unchanged.',
    'No production bindings/schema, real media/orders, real devices, embedded browsers, VoiceOver or full keyboard certification.',
    'Original npm test has many scripts; no invented aggregate unique-test total.'] };
await writeFile(new URL('verification-summary.json', evidence), JSON.stringify(summary, null, 2) + '\n');
const artifacts = [];
for (const entry of await readdir(evidence, { withFileTypes: true })) if (entry.isFile() && entry.name !== 'manifest.json') {
  const bytes = await readFile(new URL(entry.name, evidence)); artifacts.push({ name: entry.name, bytes: bytes.length, sha256: hash(bytes) });
}
await writeFile(new URL('manifest.json', evidence), JSON.stringify({ baseCommit: base, generatedAt: summary.generatedAt,
  files, artifacts, note: 'Raw logs and their final source bytes, not GitHub CI, deployment or production evidence.' }, null, 2) + '\n');
console.log(JSON.stringify({ sourceFiles: files.length, artifacts: artifacts.length, migrationsUnchanged: migrations.length, commands: results.length }));
