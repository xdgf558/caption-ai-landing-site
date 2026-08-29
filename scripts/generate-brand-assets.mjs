import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@cf-wasm/resvg/node';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = resolve(projectRoot, 'public');

const renderPng = async (svg, width) => {
  const renderer = await Resvg.async(svg, {
    fitTo: { mode: 'width', value: width }
  });
  return Buffer.from(renderer.render().asPng());
};

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

const faviconSvg = await readFile(resolve(publicRoot, 'favicon.svg'), 'utf8');
const faviconPng = await renderPng(faviconSvg, 64);
const appleTouchIcon = await renderPng(faviconSvg, 180);

await writeFile(resolve(publicRoot, 'favicon.ico'), createIco(faviconPng, 64));
await writeFile(resolve(publicRoot, 'apple-touch-icon.png'), appleTouchIcon);

console.log('Generated favicon.ico and apple-touch-icon.png.');
