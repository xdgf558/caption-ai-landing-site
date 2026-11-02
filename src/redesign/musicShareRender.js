import { Resvg } from '@cf-wasm/resvg';
import { PhotonImage, resize, SamplingFilter } from '@cf-wasm/photon';
import { inspectSmallAsset } from '../music/assetFormats.js';
import { escapeMusicShare as e, musicShareLines } from '../music/shareCard.js';
import { encodeMusicRgbaPng } from '../music/shareCardRender.js';

const b64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };
const text = (value, x, y, size, color = '#101b50', extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${e(value)}</text>`;
const lines = (values, x, y, size, height, color) => values.map((value, i) => text(value, x, y + i * height, size, color)).join('');
const clean = value => String(value || '').replace(/[\s\u0085]+/gu, ' ').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim();

export function stationMusicShareSvg(target, copy, cover, icon) {
  const title = musicShareLines(clean(target.title), 12, 2);
  const description = musicShareLines(clean(target.description), 26, 3);
  // CJK closing punctuation belongs on the preceding line, not by itself.
  for (let i = 1; i < description.length; i++) {
    while (/^[，。！？、；：）】》」』]/u.test(description[i])) {
      description[i - 1] += Array.from(description[i])[0];
      description[i] = Array.from(description[i]).slice(1).join('');
    }
  }
  const coverImage = cover ? `<image x="80" y="100" width="650" height="650" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)" href="data:image/png;base64,${b64(cover)}"/>` :
    '<rect x="80" y="100" width="650" height="650" rx="22" fill="#e0e0ed"/>';
  const iconImage = icon ? `<image x="80" y="1350" width="80" height="80" clip-path="url(#icon)" href="data:image/png;base64,${b64(icon)}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1500" font-family="Noto Serif SC" font-weight="700">
  <defs><linearGradient id="paper" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#f4f2f8"/><stop offset="0.58" stop-color="#e7e8f2"/><stop offset="1" stop-color="#c5cae4"/></linearGradient><clipPath id="cover"><rect x="80" y="100" width="650" height="650" rx="22"/></clipPath><clipPath id="icon"><rect x="80" y="1350" width="80" height="80" rx="16"/></clipPath></defs>
  <rect width="1200" height="1500" fill="url(#paper)"/><path d="M740 1250 C400 1020 950 830 1220 760 M750 1500 C560 1270 930 1110 1220 1090" fill="none" stroke="#a29ddd" stroke-opacity=".65" stroke-width="2"/>
  ${coverImage}
  ${text(copy[target.kind], 80, 833, 28)}<line x1="180" y1="822" x2="620" y2="822" stroke="#777bb1" stroke-width="2"/>
  ${lines(title, 80, 925, 68, 75, '#101b50')}
  ${target.artist ? text(clean(target.artist), 80, 1090, 31, '#26366d') : ''}
  ${lines(description, 80, 1170, 28, 43, '#536294')}
  <line x1="80" y1="1320" x2="1120" y2="1320" stroke="#a6aac8" stroke-width="2"/>
  ${iconImage}${text('STATION CAT MUSIC', 180, 1399, 22, '#101b50', 'letter-spacing="3"')}
  ${text(copy.download, 1120, 1399, 24, '#101b50', 'text-anchor="end"')}</svg>`;
}

export async function renderStationMusicShareCard(target, copy, cover, font, iconWebp) {
  let icon, iconPng, renderer, raster;
  try {
    if (iconWebp) { icon = PhotonImage.new_from_byteslice(iconWebp); iconPng = icon.get_bytes(); }
    renderer = await Resvg.async(stationMusicShareSvg(target, copy, cover, iconPng), {
      imageRendering:1, font:{fontBuffers:[font], defaultFontFamily:'Noto Serif SC', serifFamily:'Noto Serif SC', sansSerifFamily:'Noto Serif SC', loadSystemFonts:false}
    });
    raster = renderer.render();
    const pixels = raster.pixels, width = raster.width, height = raster.height;
    raster.free(); raster = null; renderer.free(); renderer = null;
    return await encodeMusicRgbaPng(pixels, width, height);
  } finally { icon?.free(); raster?.free(); renderer?.free(); }
}

// The iOS artwork loader caps responses at 2 MiB. Keep alpha by returning a
// bounded PNG rather than converting a transparent cover to JPEG.
export function stationShareCoverThumbnail(png) {
  const limit = 2 * 1024 * 1024;
  if (!(png instanceof Uint8Array) || !png.length || png.length > 5 * 1024 * 1024) throw new Error('COVER_THUMBNAIL_INVALID');
  const dimensions = inspectSmallAsset({kind:'cover',format:'png',content_type:'image/png'},png);
  if (dimensions.width * dimensions.height > 4194304) throw new Error('COVER_THUMBNAIL_TOO_LARGE');
  if (Math.max(dimensions.width, dimensions.height) <= 512 && png.length <= limit) return png;
  let image, result;
  try {
    image = PhotonImage.new_from_byteslice(png);
    if (image.get_width() !== dimensions.width || image.get_height() !== dimensions.height) throw new Error('COVER_THUMBNAIL_INVALID');
    const ratio = Math.min(1, 512 / Math.max(dimensions.width, dimensions.height));
    result = resize(image, Math.max(1, Math.round(dimensions.width * ratio)), Math.max(1, Math.round(dimensions.height * ratio)), SamplingFilter.Lanczos3);
    const output = result.get_bytes();
    if (!output.length || output.length > limit) throw new Error('COVER_THUMBNAIL_TOO_LARGE');
    return output;
  } finally {result?.free();image?.free();}
}
