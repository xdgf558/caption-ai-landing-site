import mpeg from 'mp3-parser/lib/lib.js';
import { Mp3Stream, MP3_LIMITS, mp3Error } from './mp3Stream.js';

const ascii = (bytes, offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

async function skipId3(reader) {
  const header = await reader.peek(10);
  if (!header || ascii(header, 0, 3) !== 'ID3') return 0;
  const version = header[3], flags = header[5];
  if (![3, 4].includes(version) || header[4] !== 0 || (flags & (version === 3 ? 31 : 15)) ||
    [...header.subarray(6)].some(b => b & 128)) throw mp3Error('MUSIC_MP3_ID3_UNSUPPORTED');
  const size = header[6] * 2097152 + header[7] * 16384 + header[8] * 128 + header[9];
  const footer = version === 4 && (flags & 16) !== 0, total = 10 + size + (footer ? 10 : 0);
  if (total > reader.limits.tagBytes) throw mp3Error('MUSIC_MP3_TAG_BUDGET');
  const savedHeader = header.slice();
  await reader.skip(10 + size);
  if (footer) {
    const end = await reader.read(10);
    if (ascii(end, 0, 3) !== '3DI' || end.subarray(3).some((b, i) => b !== savedHeader[i + 3])) throw mp3Error('MUSIC_MP3_ID3_INVALID');
  }
  return total;
}

function frameHeader(bytes) {
  // Reject unsupported variants before invoking the pinned parser's version tables.
  if (bytes[0] !== 255 || (bytes[1] & 224) !== 224) throw mp3Error('MUSIC_MP3_FRAME_INVALID');
  const version = (bytes[1] >> 3) & 3, layer = (bytes[1] >> 1) & 3;
  if (![2, 3].includes(version) || layer !== 1 || !(bytes[1] & 1) || (bytes[3] & 3) === 2) throw mp3Error('MUSIC_MP3_UNSUPPORTED');
  const header = mpeg.readFrameHeader(view(bytes));
  if (!header || !Number.isInteger(header.bitrate) || !Number.isInteger(header.samplingRate)) throw mp3Error('MUSIC_MP3_FRAME_INVALID');
  const samples = mpeg.sampleLengthMap[header.mpegAudioVersionBits][header.layerDescriptionBits];
  const length = mpeg.getFrameByteLength(header.bitrate, header.samplingRate, header.framePadding,
    header.mpegAudioVersionBits, header.layerDescriptionBits);
  const channels = header.channelModeBits === '11' ? 1 : 2;
  const sideLength = version === 3 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17);
  if (!Number.isInteger(length) || length < 4 + sideLength || length > MP3_LIMITS.frameBytes) throw mp3Error('MUSIC_MP3_FRAME_INVALID');
  return { length, samples, sampleRate: header.samplingRate, version, channels, sideLength, bitrate: header.bitrate };
}

function infoHeader(bytes, h) {
  if (ascii(bytes, 36, 4) === 'VBRI') throw mp3Error('MUSIC_MP3_VBRI_UNSUPPORTED');
  let offset = 4 + h.sideLength;
  if (!['Xing', 'Info'].includes(ascii(bytes, offset, 4))) return null;
  if (bytes.subarray(4, offset).some(b => b !== 0) || offset + 8 > bytes.length) throw mp3Error('MUSIC_MP3_INFO_INVALID');
  const dv = view(bytes), flags = dv.getUint32(offset + 4); offset += 8;
  if (flags & ~15) throw mp3Error('MUSIC_MP3_INFO_INVALID');
  const result = { frames: null, bytes: null };
  for (const [flag, size, field] of [[1, 4, 'frames'], [2, 4, 'bytes'], [4, 100, null], [8, 4, null]]) {
    if (flags & flag) {
      if (offset + size > bytes.length) throw mp3Error('MUSIC_MP3_INFO_INVALID');
      if (field) { result[field] = dv.getUint32(offset); if (!result[field]) throw mp3Error('MUSIC_MP3_INFO_INVALID'); }
      offset += size;
    }
  }
  return result;
}

/** Strict structural measurement, not an audio decoder or proof of ownership/content provenance. */
export async function inspectMp3(stream, options) {
  let reader, success = false;
  try {
    if (options?.contentType !== 'audio/mpeg') throw mp3Error('MUSIC_MP3_TYPE_INVALID');
    reader = new Mp3Stream(stream, options);
    let tagBytes = await skipId3(reader), sampleCount = 0, frameCount = 0, frameBytes = 0, audioBytes = 0;
    let format = null, info = null, reservoirAvailable = 0, bitrate = null, vbr = false;
    while (await reader.peek(1)) {
      const prefix = await reader.peek(5);
      if (!prefix) throw mp3Error('MUSIC_MP3_TRUNCATED');
      if (ascii(prefix, 0, 3) === 'TAG') {
        await reader.skip(128); tagBytes += 128;
        if (tagBytes > reader.limits.tagBytes) throw mp3Error('MUSIC_MP3_TAG_BUDGET');
        if (await reader.peek(1)) throw mp3Error('MUSIC_MP3_TRAILING_DATA');
        break;
      }
      const h = frameHeader(prefix);
      if (frameCount + (info ? 1 : 0) >= reader.limits.frames) throw mp3Error('MUSIC_MP3_FRAME_BUDGET');
      if (format && (h.version !== format.version || h.sampleRate !== format.sampleRate || h.channels !== format.channels)) throw mp3Error('MUSIC_MP3_FORMAT_CHANGED');
      format = h;
      const bytes = await reader.read(h.length); frameBytes += bytes.length;
      const tag = infoHeader(bytes, h);
      if (tag) {
        if (frameCount || info) throw mp3Error('MUSIC_MP3_CONCATENATED');
        info = tag; continue;
      }
      const mainDataBegin = h.version === 3 ? (bytes[4] << 1) | (bytes[5] >> 7) : bytes[4];
      if (mainDataBegin > reservoirAvailable) throw mp3Error('MUSIC_MP3_RESERVOIR_INVALID');
      reservoirAvailable = Math.min(h.version === 3 ? 511 : 255, reservoirAvailable + h.length - 4 - h.sideLength);
      sampleCount += h.samples; frameCount++; audioBytes += h.length;
      if (bitrate !== null && h.bitrate !== bitrate) vbr = true;
      bitrate = h.bitrate;
    }
    if (frameCount < 2 || !format) throw mp3Error('MUSIC_MP3_NO_AUDIO');
    if (info && ((info.frames !== null && info.frames !== frameCount) || (info.bytes !== null && info.bytes !== frameBytes))) throw mp3Error('MUSIC_MP3_INFO_MISMATCH');
    if (frameBytes + tagBytes !== reader.bytes) throw mp3Error('MUSIC_MP3_SIZE_MISMATCH');
    // Keep encoder delay/padding: untrusted LAME trim values must never shorten the enforced limit.
    const result = { measurement: 'mp3-frames', structureValid: true, contentType: 'audio/mpeg',
      byteSize: reader.bytes, sha256: reader.digest(), durationMs: Math.ceil(sampleCount * 1000 / format.sampleRate),
      sampleCount, sampleRate: format.sampleRate, channels: format.channels, mpegVersion: format.version === 3 ? 1 : 2,
      frameCount, audioBytes, tagBytes, infoFrame: info !== null, vbr,
      bufferCapacityBytes: reader.buffer.length, reads: reader.reads };
    success = true; return result;
  } catch (error) {
    if (error?.code?.startsWith('MUSIC_MP3_')) throw error;
    throw mp3Error('MUSIC_MP3_READ_FAILED', 503);
  } finally { reader?.close(success); }
}
