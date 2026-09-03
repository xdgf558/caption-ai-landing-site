import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(projectRoot, 'public');

const logoSourcePath = resolve(projectRoot, 'scripts/assets/station-cat-logo.png');
const expectedLogoHash = '1668c2e5';

const createIco = (png, size) => {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(size >= 256 ? 0 : size, 6);
  header.writeUInt8(size >= 256 ? 0 : size, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
};

const logoSource = await readFile(logoSourcePath);
const logoHash = createHash('sha256').update(logoSource).digest('hex').slice(0, 8);
if (logoHash !== expectedLogoHash) {
  throw new Error(`Update the branded asset filenames for logo hash ${logoHash}.`);
}

const faviconPng = await sharp(logoSource)
  .resize(64, 64, { fit: 'contain' })
  .png({ compressionLevel: 9 })
  .toBuffer();
const appleTouchIcon = await sharp(logoSource)
  .resize(180, 180, { fit: 'contain' })
  .flatten({ background: '#fffaf4' })
  .png({ compressionLevel: 9 })
  .toBuffer();

await writeFile(resolve(publicRoot, 'favicon.ico'), createIco(faviconPng, 64));
await writeFile(resolve(publicRoot, 'favicon-64.png'), faviconPng);
await writeFile(resolve(publicRoot, 'apple-touch-icon.png'), appleTouchIcon);
for (const size of [160, 320]) {
  const optimizedLogo = await sharp(logoSource)
    .resize(size, size, { fit: 'contain' })
    .webp({ quality: 86, alphaQuality: 90, effort: 6 })
    .toBuffer();
  await writeFile(
    resolve(publicRoot, `images/optimized/station-cat-logo-${logoHash}-${size}.webp`),
    optimizedLogo
  );
}

console.log(`Generated Station Cat brand assets for logo ${logoHash}.`);
