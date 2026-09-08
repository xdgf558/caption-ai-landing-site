import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const input = process.argv[2];
if (!input) throw new Error('Pass the generated-image directory. Originals remain unchanged.');
const output = fileURLToPath(new URL('../public/assets/', import.meta.url));
const mouthSource = 'exec-da9fe279-c80b-4bbd-822c-45dea99d2c32.png';
const foodSource = 'exec-3b6731a2-eba8-4de5-8043-a9ffd19b0de6.png';
const source = await readFile(path.join(input, mouthSource));
// Keep only the new cavity/tongue/lip artwork. Eyes, nose, cheeks and bow
// always remain the original head texture, avoiding a face-swap on each bite.
const crop = { left: 94, top: 316, width: 96, height: 88 };
const { data, info } = await sharp(source).resize(520, 516).extract(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const redness = Math.min((r - g - 22) / 12, (165 - g) / 18, (r - b - 30) / 12);
  data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, redness)));
}
await sharp(data, { raw: info }).webp({ quality: 94, alphaQuality: 100 }).toFile(path.join(output, 'mouth-open.webp'));
const food = await readFile(path.join(input, foodSource));
const foodMeta = await sharp(food).metadata();
if (!foodMeta.hasAlpha) throw new Error('Kibble must have real alpha, not a printed transparent background.');
await sharp(food).trim().resize(96, 96, { fit: 'inside' }).webp({ quality: 92, alphaQuality: 100 }).toFile(path.join(output, 'kibble.webp'));
await writeFile(path.join(output, 'feeding-meta.json'), JSON.stringify({
  mouth: { source: mouthSource, sourceSHA256: createHash('sha256').update(source).digest('hex'), crop, upperLip: { x: 118, y: 323 } },
  kibble: { source: foodSource, sourceSHA256: createHash('sha256').update(food).digest('hex') }
}, null, 2) + '\n');
console.log('Prepared original-face mouth overlay and alpha kibble.');
