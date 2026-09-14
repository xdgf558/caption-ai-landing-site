import { Resvg } from '@cf-wasm/resvg';
import { PhotonImage, resize, SamplingFilter } from '@cf-wasm/photon';
import qrcode from 'qrcode-generator';
import { inspectSmallAsset } from './assetFormats.js';
import { escapeMusicShare as e, musicShareLines, MUSIC_SHARE_FORMATS, MUSIC_SHARE_MAX_PNG } from './shareCard.js';

const b64 = bytes => { let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(value); };
const text = (value, x, y, size, color = '#1f2d29', extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${e(value)}</text>`;
const lines = (values, x, y, size, height) => values.map((value, i) => text(value, x, y + height * i, size)).join('');

// Decode only checked, bounded raster input. Never pass a URL/SVG into the renderer.
export function normalizeMusicCardCover(bytes, contentType) {
  const format = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpeg' }[contentType];
  if (!format || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 5242880) throw new Error('SHARE_COVER_INVALID');
  const dimensions = inspectSmallAsset({ kind: 'cover', format, content_type: contentType }, bytes);
  if (dimensions.width * dimensions.height > 4194304) throw new Error('SHARE_COVER_TOO_LARGE');
  // PNG is already directly supported by resvg. Preserve its bounded, hash-checked
  // bytes instead of resizing and encoding an intermediate PNG that is decoded again.
  if (format === 'png') return bytes;
  let input, output;
  try {
    input = PhotonImage.new_from_byteslice(bytes);
    if (input.get_width() !== dimensions.width || input.get_height() !== dimensions.height) throw new Error('SHARE_COVER_INVALID');
    const ratio = Math.min(1, 840 / Math.max(dimensions.width, dimensions.height));
    output = resize(input, Math.max(1, Math.round(dimensions.width * ratio)), Math.max(1, Math.round(dimensions.height * ratio)), SamplingFilter.Lanczos3);
    return output.get_bytes();
  } finally { output?.free(); input?.free(); }
}

export function musicShareQr(url) {
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => qr.isDark(y, x)));
}
function qrSvg(url, x, y, box) {
  const cells = musicShareQr(url), unit = Math.floor(box / (cells.length + 8)), side = (cells.length + 8) * unit;
  let svg = `<rect x="${x}" y="${y}" width="${side}" height="${side}" fill="#fff"/>`;
  // QR library matrix, integer modules, four-module quiet zone; not an illustrative QR.
  for (let row = 0; row < cells.length; row++) for (let col = 0; col < cells.length; col++) if (cells[row][col])
    svg += `<rect x="${x + (col + 4) * unit}" y="${y + (row + 4) * unit}" width="${unit}" height="${unit}" fill="#152a23"/>`;
  return svg;
}

function albumShareSvg(data, format, coverPng) {
  const poster = format === 'poster', [width, height] = MUSIC_SHARE_FORMATS[format];
  const slot = poster ? {x:90,y:174,size:900} : {x:48,y:48,size:470};
  const cover = coverPng ? `<image x="${slot.x}" y="${slot.y}" width="${slot.size}" height="${slot.size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#album-cover)" href="data:image/png;base64,${b64(coverPng)}"/>`
    : text(data.station,slot.x+slot.size/2,slot.y+slot.size/2,40,'#52685e','text-anchor="middle"');
  let content = cover;
  if (poster) {
    content += text('STATION CAT / MUSIC',90,100,23,'#2c473b','letter-spacing="5"') +
      text(data.station,990,100,26,'#2c473b','text-anchor="end"') +
      lines(musicShareLines(data.title,8.3,2),90,1194,105,112) +
      text(data.creator,94,1360,43,'#2c473b','letter-spacing="3"') + text(data.count,94,1415,27,'#52685e','letter-spacing="3"') +
      lines(musicShareLines(data.description,26,3),94,1480,32,43) +
      '<line x1="90" y1="1620" x2="990" y2="1620" stroke="#89988b"/>' +
      text(data.scan,94,1690,27,'#2c473b') + text(data.host,94,1740,24,'#52685e','letter-spacing="2"') + qrSvg(data.url,825,1638,168);
  } else {
    content += text('STATION CAT / MUSIC',565,78,19,'#52685e','letter-spacing="3"') +
      lines(musicShareLines(data.title,9,2),563,185,62,82) + text(`${data.creator} · ${data.count}`,565,325,26,'#52685e') +
      lines(musicShareLines(data.description,20,3),565,390,27,40) +
      '<line x1="48" y1="554" x2="1152" y2="554" stroke="#89988b"/>' +
      text(data.station,48,599,24,'#2c473b') + text(data.host,1152,599,23,'#52685e','text-anchor="end"');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Noto Serif SC" font-weight="700"><rect width="100%" height="100%" fill="#f7f3e9"/><defs><clipPath id="album-cover"><rect x="${slot.x}" y="${slot.y}" width="${slot.size}" height="${slot.size}"/></clipPath></defs>${content}</svg>`;
}

export function musicShareCardSvg(data, format, coverPng) {
  const size = MUSIC_SHARE_FORMATS[format]; if (!size) throw new Error('INVALID_SHARE_FORMAT');
  if (data.kind === 'album') return albumShareSvg(data, format, coverPng);
  const poster = format === 'poster';
  const comma = /^(.{1,4}[，、])(.{1,5})$/u.exec(data.title);
  const splitComma = comma && comma.slice(1).every(value => Array.from(value).length <= (poster ? 5 : 4));
  let titleLines = splitComma ? [comma[1], comma[2]] : musicShareLines(data.title, poster ? 5.2 : 4, 3);
  const compact = titleLines.length > 2 || /[A-Za-z0-9]{6,}/.test(data.title);
  const titleSize = poster ? compact ? 126 : 174 : compact ? 82 : 132;
  if (compact && !splitComma) titleLines = musicShareLines(data.title, poster ? 7.4 : 6.5, 3);
  const titleY = poster ? compact ? 230 : 284 : titleLines.length === 1 ? 286 : titleLines.length === 2 ? 188 : 163;
  const titleHeight = poster ? compact ? 144 : 184 : compact ? 116 : 142;
  let content = '';
  const cover = (x, y, edge) => coverPng ? `<image x="${x}" y="${y}" width="${edge}" height="${edge}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)" href="data:image/png;base64,${b64(coverPng)}"/>` : '';
  if (poster) {
    const lastTitle = titleY + (titleLines.length - 1) * titleHeight;
    content = text(`Station Cat · ${data.station}`, 66, 90, 28, '#1f2d29', 'letter-spacing="3"') + lines(titleLines, 66, titleY, titleSize, titleHeight) +
      text(musicShareLines(data.creator, 17, 1)[0], 68, titleLines.length > 2 ? 586 : lastTitle + 100, 52) + text(data.access, 68, titleLines.length > 2 ? 638 : lastTitle + 172, 38, '#286a5e') +
      cover(140, 696, 800) + qrSvg(data.url, 60, 1530, 200) + lines(musicShareLines(data.scan, 15, 2), 284, 1610, 34, 44) +
      text(data.station, 1016, 1670, 32, '#1f2d29', 'text-anchor="end"') + text(data.host, 1016, 1715, 25, '#52685e', 'text-anchor="end"') +
      '<line x1="66" y1="1750" x2="1014" y2="1750" stroke="#6f8a7b"/>';
  } else {
    const lastTitle = titleY + (titleLines.length - 1) * titleHeight;
    content = lines(titleLines, 60, titleY, titleSize, titleHeight) +
      text(musicShareLines(data.creator, 12, 1)[0], 62, Math.min(472, lastTitle + 100), 42) +
      text(data.access, 62, Math.min(516, lastTitle + 154), 30, '#286a5e') + cover(638, 24, 506) +
      '<line x1="60" y1="562" x2="1140" y2="562" stroke="#6f8a7b"/>' +
      text(data.station, 62, 602, 25) + text(data.host, 1138, 602, 21, '#52685e', 'text-anchor="end"');
  }
  const slot = poster ? { x: 140, y: 696, size: 800 } : { x: 638, y: 24, size: 506 };
  if (!coverPng) content += text(data.station, slot.x + slot.size / 2, slot.y + slot.size / 2, poster ? 42 : 36, '#64736d', 'text-anchor="middle"');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}" viewBox="0 0 ${size[0]} ${size[1]}" font-family="Noto Serif SC" font-weight="700">
    <rect width="100%" height="100%" fill="#fffaf4"/><defs><clipPath id="cover"><rect x="${slot.x}" y="${slot.y}" width="${slot.size}" height="${slot.size}" rx="14"/></clipPath></defs>${content}</svg>`;
}

// Native compression avoids the CPU-heavy WASM PNG encoder. Pixel data is
// unchanged: PNG Sub filtering and CRC-32 frame a bounded RGBA deflate stream.
const pngCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const pngChunk = (type, bytes) => {
  const chunk = new Uint8Array(bytes.length + 12), view = new DataView(chunk.buffer);
  view.setUint32(0, bytes.length);
  chunk.set(new TextEncoder().encode(type), 4); chunk.set(bytes, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < chunk.length - 4; i++) crc = pngCrcTable[(crc ^ chunk[i]) & 255] ^ (crc >>> 8);
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0); return chunk;
};
export async function encodeMusicRgbaPng(pixels, width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
    width * height > 1944000 || !(pixels instanceof Uint8Array) || pixels.length !== width * height * 4) throw new Error('SHARE_RASTER_INVALID');
  const stride = width * 4, scanlines = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = y * stride, out = y * (stride + 1); scanlines[out] = 1;
    for (let x = 0; x < stride; x++) scanlines[out + x + 1] = (pixels[start + x] - (x >= 4 ? pixels[start + x - 4] : 0)) & 255;
  }
  const source = new ReadableStream({ start(controller) { controller.enqueue(scanlines); controller.close(); } });
  const reader = source.pipeThrough(new CompressionStream('deflate')).getReader();
  const parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length + 57 > MUSIC_SHARE_MAX_PNG) throw new Error('SHARE_CARD_TOO_LARGE');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const compressed = new Uint8Array(length); let offset = 0;
  for (const part of parts) { compressed.set(part, offset); offset += part.length; }
  const header = new Uint8Array(13), fields = new DataView(header.buffer);
  fields.setUint32(0, width); fields.setUint32(4, height); header[8] = 8; header[9] = 6;
  const chunks = [new Uint8Array([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())];
  const png = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0)); offset = 0;
  for (const chunk of chunks) { png.set(chunk, offset); offset += chunk.length; }
  return png;
}

export async function renderMusicShareCard(data, format, coverPng, fontBuffer) {
  let renderer, raster;
  try {
    renderer = await Resvg.async(musicShareCardSvg(data, format, coverPng), {
      // Avoid the expensive default photo resampler; text and QR remain vector-sharp.
      imageRendering: 1,
      font: { fontBuffers: [fontBuffer], defaultFontFamily: 'Noto Serif SC', serifFamily: 'Noto Serif SC', sansSerifFamily: 'Noto Serif SC', loadSystemFonts: false }
    });
    raster = renderer.render(); const pixels = raster.pixels, width = raster.width, height = raster.height;
    raster.free(); raster = null; renderer.free(); renderer = null;
    const bytes = await encodeMusicRgbaPng(pixels, width, height);
    if (!bytes.length || bytes.length > MUSIC_SHARE_MAX_PNG) throw new Error('SHARE_CARD_TOO_LARGE');
    return bytes;
  } finally { raster?.free(); renderer?.free(); }
}
