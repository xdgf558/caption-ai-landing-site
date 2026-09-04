import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'cat-life-room-preview-'));
try {
  const screenshot = join(temporary, 'room.png');
  execFileSync(process.execPath, [
    join(root, 'node_modules/@playwright/test/cli.js'), 'test',
    'scripts/browser-tests/cat-life-commerce.spec.mjs', '--grep', 'room purchase.*1440px'
  ], { cwd: root, stdio: 'inherit', env: { ...process.env, CAT_LIFE_CAPTURE_ROOM_PREVIEW: screenshot } });
  const context = { window: {} };
  vm.runInNewContext(await readFile(join(root, 'public/games/cat-life/content-manifest.js'), 'utf8'), context);
  const product = context.window.CatGameContentManifest.getProduct('cat-life.bundle.station-room');
  const metadata = await sharp(screenshot).metadata();
  assert.equal(metadata.width, product.imageSize.width, 'Review preview dimensions after layout changes');
  assert.equal(metadata.height, product.imageSize.height, 'Review preview dimensions after layout changes');
  await sharp(screenshot).webp({ quality: 85 }).toFile(join(root, 'public/games/cat-life', product.image));
  console.log('Captured the real room UI with mock ownership; no production services were used.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
