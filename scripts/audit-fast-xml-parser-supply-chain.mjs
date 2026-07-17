import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = readJson(join(projectRoot, 'package.json'));
const packageLock = readJson(join(projectRoot, 'package-lock.json'));

const expectedPackages = new Map([
  ['fast-xml-parser', {
    version: '5.10.1',
    integrity: 'sha512-IEMIf7298kXuZSRFoGfMYrl7is8LpavODgbNz1cwIudv7KwVFnuU+UsMporfq6PD6aXSlawZlARiA3UywCTfMw==',
    repository: 'git+https://github.com/NaturalIntelligence/fast-xml-parser.git',
    bin: { fxparser: 'src/cli/cli.js' }
  }],
  ['@nodable/entities', {
    version: '3.0.0',
    integrity: 'sha512-8L9xFeTYKhm49xfIypoe2W5wV1m/3Z58kT+7kR9A8OyFxcPduI4VmxaUMQyKYrRjUoLLSXv6EKKID5Tvj9cUVw==',
    repository: 'git+https://github.com/nodable/val-parsers.git'
  }],
  ['fast-xml-builder', {
    version: '1.3.0',
    integrity: 'sha512-F74cZEdCvuw9P41GAC3rod4X04jjWGM1JPEv/GWSqFTWLsdyMSBMBMlm9Hk3GLBgLBbdBNY8yee0pQh2RBVESQ==',
    repository: 'git+https://github.com/NaturalIntelligence/fast-xml-builder.git'
  }],
  ['is-unsafe', {
    version: '2.0.0',
    integrity: 'sha512-2LdV822R+wmI86unXA93WCFpL6g+av8ynWk0nrHyJqGop5VoocYsSLFgN8jrfalT6iGeLNM4KXuVSsULP53kEA==',
    repository: 'https://github.com/NaturalIntelligence/is-unsafe'
  }],
  ['path-expression-matcher', {
    version: '1.6.2',
    integrity: 'sha512-enSlaiat05iasnzmgNxRj8reFdj3puY2QpNgP1aPIaVfT6nn9ICuPoFlKHk8EN22HcwewshO+mN2DGbkCEOtqQ==',
    repository: 'https://github.com/NaturalIntelligence/path-expression-matcher'
  }],
  ['strnum', {
    version: '2.4.1',
    integrity: 'sha512-M9eUSMT2dCB2cTNPG7UYj6KuK7RJR2SN2+yCV/fTW3xzTCS6EaGZ5pSMgDIjB7r8zSfTGk+dvvn9rTjpVS9Mwg==',
    repository: 'https://github.com/NaturalIntelligence/strnum'
  }],
  ['xml-naming', {
    version: '0.3.0',
    integrity: 'sha512-ghig2TBE/H11aOVgmahA3MhimvkBr6JIYknH/Dhdk10nXwdbIqBJsbfMxpvFPG8bAw77gN29aQWvKpmVoPlvPQ==',
    repository: 'https://github.com/NaturalIntelligence/xml-naming'
  }],
  ['anynum', {
    version: '1.0.1',
    integrity: 'sha512-N6//FLET/tXYNM/F6ABca1oH6fWB+KlTt909Le28WMDBk8oaT4vY17DCrwg2MvmuqUKt3Ni4N5dGJ/EoBgcO6A==',
    repository: 'https://github.com/NaturalIntelligence/anynum'
  }]
]);

const blockedInstallScripts = ['preinstall', 'install', 'postinstall'];
const blockedBinaryExtensions = new Set([
  '.bat', '.cmd', '.dll', '.dylib', '.exe', '.node', '.ps1', '.sh', '.so'
]);

assert.equal(
  packageJson.dependencies?.['fast-xml-parser'],
  '5.10.1',
  'fast-xml-parser must remain pinned to 5.10.1'
);
assert.equal(
  packageLock.packages?.['']?.dependencies?.['fast-xml-parser'],
  '5.10.1',
  'package-lock must preserve the exact fast-xml-parser root dependency'
);

const actualClosure = collectDependencyClosure('fast-xml-parser');
assert.deepEqual(
  [...actualClosure].sort(),
  [...expectedPackages.keys()].sort(),
  'fast-xml-parser dependency closure changed; review every new or removed package before updating this allowlist'
);

for (const [name, expected] of expectedPackages) {
  const lockEntry = packageLock.packages?.[`node_modules/${name}`];
  assert.ok(lockEntry, `${name} is missing from package-lock.json`);
  assert.equal(lockEntry.version, expected.version, `${name} version changed`);
  assert.equal(lockEntry.integrity, expected.integrity, `${name} integrity hash changed`);
  assert.match(
    lockEntry.resolved || '',
    /^https:\/\/registry\.npmjs\.org\//,
    `${name} must resolve from the official npm registry`
  );
  assert.notEqual(lockEntry.hasInstallScript, true, `${name} unexpectedly declares an install script`);

  const packageRoot = join(projectRoot, 'node_modules', name);
  const installedManifest = readJson(join(packageRoot, 'package.json'));
  assert.equal(installedManifest.version, expected.version, `${name} installed version differs from the lockfile`);
  assert.equal(installedManifest.license, 'MIT', `${name} license changed`);
  assert.equal(repositoryUrl(installedManifest.repository), expected.repository, `${name} repository changed`);
  assert.match(String(installedManifest.author || ''), /^Amit Gupta\b/, `${name} author changed`);
  assert.deepEqual(installedManifest.bin || undefined, expected.bin, `${name} executable entry changed`);

  for (const scriptName of blockedInstallScripts) {
    assert.equal(
      installedManifest.scripts?.[scriptName],
      undefined,
      `${name} declares a ${scriptName} lifecycle script`
    );
  }

  inspectPackageFiles(packageRoot, name);
}

console.log(`fast-xml-parser supply-chain audit passed (${expectedPackages.size} exact packages).`);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function repositoryUrl(repository) {
  return typeof repository === 'string' ? repository : repository?.url || '';
}

function collectDependencyClosure(rootName) {
  const found = new Set();
  const pending = [rootName];

  while (pending.length > 0) {
    const name = pending.pop();
    if (found.has(name)) continue;
    found.add(name);

    const lockEntry = packageLock.packages?.[`node_modules/${name}`];
    assert.ok(lockEntry, `${name} is missing from the lockfile dependency tree`);
    for (const dependencyName of Object.keys(lockEntry.dependencies || {})) {
      assert.ok(
        packageLock.packages?.[`node_modules/${dependencyName}`],
        `${name} dependency ${dependencyName} is not hoisted as expected; review the new lockfile shape`
      );
      pending.push(dependencyName);
    }
  }

  return found;
}

function inspectPackageFiles(packageRoot, packageName) {
  const pending = [packageRoot];

  while (pending.length > 0) {
    const currentPath = pending.pop();
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = join(currentPath, entry.name);
      const stats = lstatSync(entryPath);
      assert.equal(stats.isSymbolicLink(), false, `${packageName} contains an unexpected symbolic link`);

      if (stats.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      if (stats.isFile()) {
        assert.equal(
          blockedBinaryExtensions.has(extname(entry.name).toLowerCase()),
          false,
          `${packageName} contains an unexpected executable or native file: ${entry.name}`
        );
      }
    }
  }
}
