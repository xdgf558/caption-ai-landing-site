// Bounded RIFF reader. No AudioContext, metadata interpretation, or whole-file PCM allocation.
export const WAV_PROFILE = 'lamejs-1.2.7-cbr192-pcm16-v1';
export const WAV_LIMITS = Object.freeze({ audio: 256 * 1048576, preview: 32 * 1048576,
  audioSeconds: 1200, previewSeconds: 45, chunks: 256, framesPerRead: 1152 * 8 });
export const wavError = message => new Error(message);
export const isWav = file => /\.wav$/i.test(file?.name || '');
const tag = (view, offset) => String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4));
async function read(file, start, size) {
  const data = await file.slice(start, start + size).arrayBuffer();
  if (data.byteLength !== size) throw wavError('WAV 文件不完整，请重新导出。');
  return new DataView(data);
}
export async function inspectWav(file, kind) {
  const max = WAV_LIMITS[kind];
  if (!['audio', 'preview'].includes(kind) || !Number.isSafeInteger(file?.size) || file.size < 44 || file.size > max) {
    throw wavError('WAV 大小不符合限制：完整音频最大 256 MiB，试听最大 32 MiB。');
  }
  const header = await read(file, 0, 12);
  if (tag(header, 0) !== 'RIFF' || tag(header, 8) !== 'WAVE' || header.getUint32(4, true) + 8 !== file.size) {
    throw wavError('只支持完整的 RIFF/WAVE 文件；不支持 RF64、大端或压缩 WAV。');
  }
  let offset = 12, chunks = 0, fmt, data;
  while (offset < file.size) {
    if (++chunks > WAV_LIMITS.chunks || offset + 8 > file.size) throw wavError('WAV 分块过多或已损坏。');
    const chunk = await read(file, offset, 8), id = tag(chunk, 0), size = chunk.getUint32(4, true);
    const start = offset + 8, end = start + size;
    if (end + (size % 2) > file.size) throw wavError('WAV 分块超出文件边界。');
    if (id === 'fmt ') {
      if (fmt || size < 16 || size > 64) throw wavError('WAV 格式块无效。');
      const v = await read(file, start, size);
      let encoding = v.getUint16(0, true);
      const channels = v.getUint16(2, true), sampleRate = v.getUint32(4, true), blockAlign = v.getUint16(12, true), bits = v.getUint16(14, true);
      if (encoding === 65534) {
        if (size < 40 || v.getUint16(16, true) !== 22) throw wavError('WAV 扩展格式无效。');
        const guid = [...new Uint8Array(v.buffer, 24, 16)];
        encoding = v.getUint32(24, true);
        const tail = [0,0,16,0,128,0,0,170,0,56,155,113];
        const validBits = v.getUint16(18, true), mask = v.getUint32(20, true);
        if (!tail.every((b, i) => guid[i + 4] === b) || validBits < 16 || validBits > bits ||
          (encoding === 3 && validBits !== 32) || (mask !== 0 && mask !== (channels === 1 ? 4 : 3))) throw wavError('不支持此 WAV 位深或声道布局。');
      }
      if (![1, 2].includes(channels) || ![32000, 44100, 48000].includes(sampleRate) ||
        !((encoding === 1 && [16, 24, 32].includes(bits)) || (encoding === 3 && bits === 32))) {
        throw wavError('WAV 需为单／双声道、32/44.1/48 kHz，PCM 16/24/32 位或 Float 32 位。');
      }
      if (blockAlign !== channels * bits / 8 || v.getUint32(8, true) !== sampleRate * blockAlign) throw wavError('WAV 数据速率或帧大小不一致。');
      fmt = { encoding, channels, sampleRate, bits, blockAlign };
    } else if (id === 'data') {
      if (data || !size) throw wavError('WAV 必须只有一个非空音频数据块。');
      data = { offset: start, size };
    }
    offset = end + (size % 2);
  }
  if (!fmt || !data || data.size % fmt.blockAlign) throw wavError('WAV 缺少有效的格式或完整音频帧。');
  const frames = data.size / fmt.blockAlign, seconds = frames / fmt.sampleRate;
  if (seconds < 0.1 || seconds > WAV_LIMITS[kind + 'Seconds']) throw wavError('WAV 时长需至少 0.1 秒；完整音频最长 20 分钟，试听最长 45 秒。');
  return { ...fmt, dataOffset: data.offset, dataBytes: data.size, frames, seconds };
}

export function pcm16(view, info) {
  const frames = view.byteLength / info.blockAlign, channels = Array.from({ length: info.channels }, () => new Int16Array(frames));
  for (let frame = 0; frame < frames; frame++) for (let c = 0; c < info.channels; c++) {
    const offset = frame * info.blockAlign + c * info.bits / 8;
    let sample;
    if (info.encoding === 3) {
      const f = view.getFloat32(offset, true);
      if (!Number.isFinite(f)) throw wavError('WAV 含无效浮点采样，请重新导出。');
      sample = Math.round(Math.max(-1, Math.min(1, f)) * (f < 0 ? 32768 : 32767));
    } else if (info.bits === 16) sample = view.getInt16(offset, true);
    else if (info.bits === 24) sample = (view.getUint8(offset) | view.getUint8(offset + 1) << 8 | view.getInt8(offset + 2) << 16) >> 8;
    else sample = view.getInt32(offset, true) >> 16;
    channels[c][frame] = sample;
  }
  return channels;
}

export async function encodeWav(file, kind, Mp3Encoder, progress = () => {}) {
  const info = await inspectWav(file, kind);
  const encoder = new Mp3Encoder(info.channels, info.sampleRate, 192);
  const parts = [], maxBytes = (kind === 'audio' ? 32 : 4) * 1048576;
  let bytes = 0, percent = -1;
  const append = encoded => {
    bytes += encoded.byteLength;
    if (bytes > maxBytes) throw wavError('生成的 MP3 超过上传上限，请缩短音频。');
    if (encoded.byteLength) parts.push(new Uint8Array(encoded));
  };
  for (let frame = 0; frame < info.frames; frame += WAV_LIMITS.framesPerRead) {
    const count = Math.min(WAV_LIMITS.framesPerRead, info.frames - frame);
    const view = await read(file, info.dataOffset + frame * info.blockAlign, count * info.blockAlign);
    const [left, right] = pcm16(view, info);
    append(encoder.encodeBuffer(left, right));
    const next = Math.min(99, Math.floor((frame + count) / info.frames * 100));
    if (next !== percent) { percent = next; progress(percent); }
  }
  append(encoder.flush());
  if (!bytes) throw wavError('编码器没有生成音频，请重试。');
  progress(100);
  return { blob: new Blob(parts, { type: 'audio/mpeg' }), info, profile: WAV_PROFILE };
}
