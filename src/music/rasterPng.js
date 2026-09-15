export const MUSIC_SHARE_MAX_PNG = 4194304;

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

