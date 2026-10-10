import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

// Local evidence runner. Every command is an existing repository check; this
// tool never deploys, opens remote databases, changes flags or deletes data.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '.generated/station-core-verification');
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
const plan = [
  ['build', ['npm', 'run', 'build'], { ALLOW_EMPTY_SERIAL_CONTENT: '1' }],
  ['legacy', ['npm', 'test']],
  ['acceptance', ['npm', 'run', 'test:redesign:acceptance']],
  ['clip-home-build', ['node', 'scripts/build-station-clip-home-preview.mjs']],
  ['game-preview-build', ['npm', 'run', 'build:redesign:game-session']],
  ['member-preview-build', ['npm', 'run', 'build:redesign:member']],
  ...['routes', 'home', 'model', 'public', 'music', 'player', 'platforms', 'clips', 'games', 'game-session', 'member', 'uploads', 'content-admin', 'campaigns', 'events', 'reports', 'migration'].map(id => [id, ['npm', 'run', 'test:redesign:' + id]]),
  ['native-music', ['npm', 'run', 'test:mobile:music']],
  ['native-library', ['npm', 'run', 'test:mobile:library']],
  ['native-production', ['npm', 'run', 'test:mobile:production']],
  ['deletion-audit', ['python3', 'scripts/test-account-deletion-audit.py']],
  ['staging-build', ['node', 'scripts/build-music-staging-assets.mjs']],
  ['staging-check', ['node', 'scripts/check-music-staging-assets.mjs']],
];
if (only?.some(id => !plan.some(p => p[0] === id))) throw new Error('Unknown check in --only');
await mkdir(join(output, 'logs'), { recursive: true });
async function capture(command) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => chunks.push(chunk));
    child.once('error', reject); child.once('close', code => code === 0 ? resolveResult(Buffer.concat(chunks).toString('utf8').trim()) : reject(new Error('Read-only command failed: ' + command.join(' '))));
  });
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = await capture(['git', 'rev-parse', 'HEAD']);
const branch = await capture(['git', 'branch', '--show-current']);
const inventory = (await capture(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0');
const relevant = inventory.filter(path => /^(?:src\/redesign\/|src\/scripts\/station|src\/worker\.js$|src\/layouts\/Station|src\/components\/Station|src\/pages\/(?:music|games|member)\/site-shell\/|public\/games\/cat-life\/|migrations(?:-music)?\/|scripts\/(?:test-station|test-mobile-music|test-mobile-library|helpers\/station|verify-station-core|serve-station-core)|(?:package(?:-lock)?\.json|wrangler\.toml|astro\.config\.mjs)$)/.test(path));
const anchors = await Promise.all(relevant.map(async path => ({ path, sha256: sha(await readFile(join(root, path))) })));
const configuration = parse(await readFile(join(root, 'wrangler.toml'), 'utf8'));
const selected = plan.filter(([id]) => !only || only.includes(id));
const report = {
  schemaVersion: 1, createdAt: new Date().toISOString(), baseline, branch,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  production: false, productionBuild: false, remoteMigration: false,
  productionConfigurationSha256: sha(await readFile(join(root, 'wrangler.toml'))),
  productionStationFlags: Object.fromEntries(Object.entries(configuration.vars || {}).filter(([key]) => key.startsWith('STATION_'))),
  sourceInventoryScope: 'Relevant tracked and nonignored untracked source files',
  emptySerialContentBuild: true, selectedChecks: selected.map(([id]) => id), sourceAnchors: anchors, checks: [],
};
for (const [id, command, overrides = {}] of selected) {
  const started = Date.now(), logPath = join(output, 'logs', id + '.log');
  console.log('START ' + id + ': ' + command.join(' '));
  const stream = createWriteStream(logPath);
  const result = await new Promise(resolveResult => {
    const child = spawn(command[0], command.slice(1), { cwd: root, env: { ...process.env, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => stream.write(data)); child.stderr.on('data', data => stream.write(data));
    child.once('error', error => { stream.write(String(error)); stream.end(() => resolveResult({ exitCode: null, spawnError: String(error) })); });
    child.once('close', (exitCode, signal) => stream.end(() => resolveResult({ exitCode, signal })));
  });
  const bytes = await readFile(logPath), text = bytes.toString('utf8');
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  const tapRuns = [...clean.matchAll(/^(?:#|ℹ) tests (\d+)\r?\n(?:#|ℹ) suites (\d+)\r?\n(?:#|ℹ) pass (\d+)\r?\n(?:#|ℹ) fail (\d+)/gm)].map(match => ({ tests: +match[1], suites: +match[2], pass: +match[3], fail: +match[4] }));
  report.checks.push({ id, command, environmentOverrides: overrides, ...result, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
    log: 'logs/' + id + '.log', bytes: bytes.length, sha256: sha(bytes), tapRuns, tapTests: tapRuns.length ? tapRuns.reduce((n, run) => n + run.tests, 0) : null });
  await writeFile(join(output, 'verification-summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log((result.exitCode === 0 ? 'PASS ' : 'FAIL ') + id + ' (' + (report.checks.at(-1).tapTests ?? 'non-TAP') + ', ' + (Date.now() - started) + ' ms)');
  if (result.exitCode !== 0) { process.exitCode = 1; break; }
}
report.sourceUnchangedDuringRun = (await Promise.all(anchors.map(async item => sha(await readFile(join(root, item.path))) === item.sha256))).every(Boolean);
report.completedAt = new Date().toISOString();
report.allSelectedChecksPassed = report.checks.length === selected.length && report.checks.every(item => item.exitCode === 0) && report.sourceUnchangedDuringRun;
await writeFile(join(output, 'verification-summary.json'), JSON.stringify(report, null, 2) + '\n');
if (!report.allSelectedChecksPassed) process.exitCode = 1;
console.log('Evidence: ' + output);
