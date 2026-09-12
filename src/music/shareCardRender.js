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

export function musicShareCardSvg(data, format, coverPng) {
  const size = MUSIC_SHARE_FORMATS[format]; if (!size) throw new Error('INVALID_SHARE_FORMAT');
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

export async function renderMusicShareCard(data, format, coverPng, fontBuffer) {
  let renderer, raster;
  try {
    renderer = await Resvg.async(musicShareCardSvg(data, format, coverPng), {
      font: { fontBuffers: [fontBuffer], defaultFontFamily: 'Noto Serif SC', serifFamily: 'Noto Serif SC', sansSerifFamily: 'Noto Serif SC', loadSystemFonts: false }
    });
    raster = renderer.render(); const bytes = raster.asPng();
    if (!bytes.length || bytes.length > MUSIC_SHARE_MAX_PNG) throw new Error('SHARE_CARD_TOO_LARGE');
    return bytes;
  } finally { raster?.free(); renderer?.free(); }
}
