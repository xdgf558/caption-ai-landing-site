// Synthetic read-contract data, exclusively imported by the loopback preview server.
export const tracks = [
  ['11111111-1111-4111-8111-111111111111', '窗边的午后', 'afternoon', 222],
  ['22222222-2222-4222-8222-222222222222', '夜行小站', 'night', 248],
  ['33333333-3333-4333-8333-333333333333', '慢慢醒来', 'morning', 176]
].map(([id, title, art, durationSec]) => ({ id, title, art, creatorName: 'Station Cat', durationSec,
  audioVersion: 1, policyVersion: 1, effectiveAccess: 'free', previewAvailable: false,
  previewDurationSec: null, previewSourceStartSec: null, coverUrl: `/api/music/tracks/${id}/cover?v=1` }));

// Quiet original synthesized arpeggios, generated locally on demand. No third-party recording.
export function demoWav(track) {
  const sampleRate = 12000, samples = sampleRate * track.durationSec;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  const notes = track.art === 'night' ? [220, 261.626, 329.628, 392, 329.628, 261.626]
    : track.art === 'morning' ? [261.626, 329.628, 392, 523.251, 392, 329.628] : [196, 246.942, 293.665, 391.995, 293.665, 246.942];
  for (let i = 0; i < samples; i++) {
    const time = i / sampleRate, beat = Math.floor(time / .8), within = time % .8;
    const f = notes[beat % notes.length], fade = Math.min(1, time / 2, (track.durationSec - time) / 3);
    const envelope = (1 - Math.exp(-within * 28)) * Math.exp(-within * 3.8);
    const tone = Math.sin(2 * Math.PI * f * time) + .16 * Math.sin(4 * Math.PI * f * time);
    const pad = .24 * Math.sin(2 * Math.PI * notes[0] / 2 * time);
    wav.writeInt16LE(Math.round((tone * envelope + pad) * fade * 2700), 44 + i * 2);
  }
  return wav;
}
