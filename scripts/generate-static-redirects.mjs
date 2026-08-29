import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = resolve(projectRoot, 'dist');
const redirectsPath = resolve(distRoot, '_redirects');

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  }));
  return files.flat();
};

const existing = await readFile(redirectsPath, 'utf8').catch(() => '');
const existingSources = new Set(
  existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])
);

const redirects = [];
for (const file of await walk(distRoot)) {
  if (!file.endsWith(`${sep}index.html`)) continue;
  const directory = relative(distRoot, dirname(file)).split(sep).join('/');
  if (!directory) continue;
  const target = `/${directory}/`;
  const source = target.slice(0, -1);
  if (existingSources.has(source)) continue;
  redirects.push(`${source} ${target} 301`);
}

redirects.sort((left, right) => left.localeCompare(right, 'en'));
const output = [existing.trimEnd(), '', '# Permanent canonical redirects for generated directory routes.', ...redirects, '']
  .join('\n')
  .replace(/^\n+/, '');
await writeFile(redirectsPath, output);

console.log(`Generated ${redirects.length} permanent trailing-slash redirects.`);
