import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'dist');
const outputRoot = path.join(root, '.generated', 'music-staging-assets');
const htmlPath = '/admin/music/index.html';
const fixedAssets = new Set([
  '/favicon.ico',
  '/images/optimized/station-cat-logo-1668c2e5-160.webp',
  '/styles/admin-music.css'
]);

const html = await readFile(path.join(sourceRoot, htmlPath), 'utf8');
const references = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]);
const scriptAssets = references.filter((entry) => /^\/_astro\/music\.astro_[a-zA-Z0-9_.-]+\.js$/.test(entry));
if (scriptAssets.length !== 1) throw new Error('Expected exactly one built music admin script.');

const allowedReferences = new Set(['/admin-v2/', ...fixedAssets, ...scriptAssets]);
const unexpected = references.filter((entry) => !allowedReferences.has(entry));
if (unexpected.length) throw new Error(`Unexpected music admin asset references: ${unexpected.join(', ')}`);

const files = [htmlPath, ...fixedAssets, ...scriptAssets];
await rm(outputRoot, { recursive: true, force: true });
for (const file of files) {
  const relative = file.slice(1);
  const destination = path.join(outputRoot, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(sourceRoot, relative), destination);
}

console.log(`Prepared ${files.length} isolated music staging assets.`);
