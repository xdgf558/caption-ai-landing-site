// Generated tones only. No private recordings, tags, rights claims, or sessions.
export function wavFixture({ seconds = 1, sampleRate = 44100, channels = 2, bits = 16, encoding = 1, extensible = false } = {}) {
  const frames = Math.round(seconds * sampleRate), block = channels * bits / 8, fmtSize = extensible ? 40 : 16;
  const pad = frames * block % 2, out = Buffer.alloc(12 + 8 + fmtSize + 8 + frames * block + pad);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(fmtSize, 16);
  out.writeUInt16LE(extensible ? 65534 : encoding, 20); out.writeUInt16LE(channels, 22); out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * block, 28); out.writeUInt16LE(block, 32); out.writeUInt16LE(bits, 34);
  if (extensible) {
    out.writeUInt16LE(22, 36); out.writeUInt16LE(bits, 38); out.writeUInt32LE(channels === 1 ? 4 : 3, 40);
    out.writeUInt32LE(encoding, 44); out.set([0,0,16,0,128,0,0,170,0,56,155,113], 48);
  }
  const offset = 20 + fmtSize; out.write('data', offset); out.writeUInt32LE(frames * block, offset + 4);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
    const sample = Math.sin(i / sampleRate * Math.PI * 2 * (c ? 660 : 440)) * 0.3;
    const at = offset + 8 + i * block + c * bits / 8;
    if (encoding === 3) out.writeFloatLE(sample, at);
    else out.writeIntLE(Math.round(sample * (2 ** (bits - 1) - 1)), at, bits / 8);
  }
  return out;
}
