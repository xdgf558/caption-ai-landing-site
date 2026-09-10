import { fail } from './adminValidation.js';

export const ASSET_LIMITS = Object.freeze({ audio: 33554432, preview: 4194304, cover: 5242880, lyrics: 131072, evidence: 10485760 });
const formats = { mp3: 'audio/mpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain', lrc: 'text/plain', pdf: 'application/pdf' };
const kinds = { audio: ['mp3'], preview: ['mp3'], cover: ['jpeg', 'png', 'webp'], lyrics: ['txt', 'lrc'], evidence: ['jpeg', 'png', 'pdf'] };
const folders = { audio: 'audio', preview: 'previews', cover: 'covers', lyrics: 'lyrics', evidence: 'evidence' };
export function assetType(kind, format) {
  if (!Object.hasOwn(kinds, kind) || !kinds[kind].includes(format)) fail('UNSUPPORTED_MEDIA_TYPE', 415);
  return formats[format];
}
export const assetKey = a => `music/${folders[a.kind]}/${a.owner_track_id}/${a.id}.${a.format}`;
const ascii = (b, start, length) => String.fromCharCode(...b.subarray(start, start + length));
const invalid = () => fail('MUSIC_FILE_STRUCTURE_INVALID');
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});
const dimensions = (width, height) => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) invalid();
  return { width, height, animated: false };
};

// Bounded container/header checks, not pixel/Huffman decoding or malware detection.
function png(b, v) {
  if (ascii(b, 0, 8) !== '\x89PNG\r\n\x1a\n') invalid();
  let offset = 8, size, data = false, ended = false;
  while (offset < b.length) {
    if (offset + 12 > b.length) invalid();
    const n = v.getUint32(offset), type = ascii(b, offset + 4, 4), end = offset + 12 + n;
    if (end > b.length || !/^[A-Za-z]{4}$/.test(type)) invalid();
    if (!size && type !== 'IHDR') invalid();
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) invalid();
    // Validate each PNG chunk checksum without decompressing attacker-controlled data.
    let crc = 0xffffffff;
    for (let i = offset + 4; i < end - 4; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ b[i]) & 255];
    }
    if (((crc ^ 0xffffffff) >>> 0) !== v.getUint32(end - 4)) invalid();
    if (type === 'IHDR') {
      if (size || n !== 13 || b[offset + 18] !== 0 || b[offset + 19] !== 0 || b[offset + 20] > 1) invalid();
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[b[offset + 17]]?.includes(b[offset + 16])) invalid();
      size = dimensions(v.getUint32(offset + 8), v.getUint32(offset + 12));
    } else if (type === 'IDAT') { if (!n) invalid(); data = true; }
    else if (type === 'IEND') { if (n || !data || end !== b.length) invalid(); ended = true; }
    offset = end;
  }
  if (!ended) invalid();
  return size;
}
function jpeg(b, v) {
  if (b[0] !== 255 || b[1] !== 216) invalid();
  let p = 2, size, scan = false;
  while (p < b.length) {
    if (b[p++] !== 255) invalid();
    while (b[p] === 255) p++;
    const marker = b[p++];
    if (marker === 217) { if (p !== b.length || !scan || !size) invalid(); return size; }
    if (marker === 216 || marker === 0 || p + 2 > b.length) invalid();
    const n = v.getUint16(p);
    if (n < 2 || p + n > b.length) invalid();
    if ([192, 193, 194].includes(marker)) {
      if (size || n < 8 || b[p + 2] !== 8) invalid();
      size = dimensions(v.getUint16(p + 5), v.getUint16(p + 3));
    }
    p += n;
    if (marker === 218) {
      if (!size) invalid(); scan = true;
      while (p < b.length) {
        if (b[p] !== 255) { p++; continue; }
        if (b[p + 1] === 0 || (b[p + 1] >= 208 && b[p + 1] <= 215)) { p += 2; continue; }
        break;
      }
    }
  }
  invalid();
}
function webp(b, v) {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP' || v.getUint32(4, true) + 8 !== b.length) invalid();
  let p = 12, size, canvas, image = false;
  while (p < b.length) {
    if (p + 8 > b.length) invalid();
    const type = ascii(b, p, 4), n = v.getUint32(p + 4, true), end = p + 8 + n + (n & 1); p += 8;
    if (end > b.length || ['ANIM', 'ANMF'].includes(type)) invalid();
    if (type === 'VP8X') {
      if (canvas || p !== 20 || n !== 10 || (b[p] & 2)) invalid();
      const u24 = i => b[i] + b[i + 1] * 256 + b[i + 2] * 65536;
      canvas = dimensions(u24(p + 4) + 1, u24(p + 7) + 1);
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (image) invalid(); image = true;
      if (type === 'VP8 ') {
        if (n < 10 || (b[p] & 1) || ascii(b, p + 3, 3) !== '\x9d\x01\x2a') invalid();
        size = dimensions(v.getUint16(p + 6, true) & 16383, v.getUint16(p + 8, true) & 16383);
      } else {
        if (n < 5 || b[p] !== 47 || (b[p + 4] >> 5)) invalid();
        const bits = v.getUint32(p + 1, true);
        size = dimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1);
      }
    }
    p = end;
  }
  if (!image || (canvas && (canvas.width !== size.width || canvas.height !== size.height))) invalid();
  return size;
}
export function inspectSmallAsset(asset, bytes) {
  try {
    const b = bytes, v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (asset.kind === 'lyrics') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(b);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) invalid();
      const lines = text.split(/\r\n|\r|\n/).length;
      if (lines > 5000) fail('MUSIC_LYRICS_INVALID');
      return { utf8: true, lines };
    }
    if (asset.format === 'pdf') {
      // Evidence is download-only under CSP sandbox. Never execute/render PDF in the site.
      if (!/^%PDF-(1\.[0-7]|2\.0)[\r\n]/.test(ascii(b, 0, 12)) ||
        !/startxref\s+\d+\s+%%EOF\s*$/.test(ascii(b, Math.max(0, b.length - 128), 128))) invalid();
      return { measurement: 'pdf-envelope' };
    }
    if (asset.format === 'png') return png(b, v);
    if (asset.format === 'jpeg') return jpeg(b, v);
    if (asset.format === 'webp') return webp(b, v);
    invalid();
  } catch (error) { if (error.status) throw error; invalid(); }
}
