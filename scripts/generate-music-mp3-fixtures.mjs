import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Local test tooling only. FFmpeg and source PCM never ship with the site.
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const directory = fileURLToPath(new URL('../tests/fixtures/music-mp3/', import.meta.url));
mkdirSync(directory, { recursive: true });
const run = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 8 * 1024 * 1024 });
const samples = [
  { name: 'cbr-stereo', rate: 44100, channels: 2, seconds: 4, extra: ['-b:a', '128k', '-id3v2_version', '3'] },
  { name: 'vbr-stereo', rate: 48000, channels: 2, seconds: 4, extra: ['-q:a', '4', '-id3v2_version', '4'] },
  { name: 'mpeg2-mono', rate: 22050, channels: 1, seconds: 4, extra: ['-b:a', '48k', '-id3v2_version', '3'] },
  { name: 'preview', rate: 44100, channels: 2, seconds: 1, extra: ['-b:a', '96k', '-id3v2_version', '3'] },
  { name: 'raw', rate: 44100, channels: 1, seconds: 1, extra: ['-b:a', '96k', '-write_xing', '0', '-id3v2_version', '0'] }
];
const manifest = { generator: run(['-version']).toString().split('\n')[0],
  source: 'Locally synthesized sine waves. No songs, voices or third-party recordings.', files: [] };
for (const sample of samples) {
  const path = `${directory}${sample.name}.mp3`;
  const input = `sine=frequency=440:sample_rate=${sample.rate}:duration=${sample.seconds}`;
  run(['-y', '-f', 'lavfi', '-i', input, '-ac', String(sample.channels), '-c:a', 'libmp3lame', ...sample.extra, path]);
  const data = readFileSync(path);
  const packets = run(['-i', path, '-map', '0:a:0', '-c:a', 'copy', '-f', 'framecrc', '-']).toString();
  const tb = /^#tb 0:\s*(\d+)\/(\d+)$/m.exec(packets);
  if (!tb) throw new Error('Missing independent packet timebase');
  const frames = packets.split('\n').filter(line => /^0,/.test(line)).map(line => line.split(',').map(value => value.trim()));
  const packetTicks = frames.reduce((sum, row) => sum + Number(row[3]), 0);
  const decoded = run(['-i', path, '-map', '0:a:0', '-f', 's16le', '-c:a', 'pcm_s16le', '-']);
  manifest.files.push({ file: `${sample.name}.mp3`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'),
    sampleRate: sample.rate, channels: sample.channels, sourceSeconds: sample.seconds,
    packetCount: frames.length, packetSamples: packetTicks * Number(tb[1]) * sample.rate / Number(tb[2]),
    packetDurationMs: Math.ceil(packetTicks * Number(tb[1]) * 1000 / Number(tb[2])),
    decodedSamples: decoded.length / 2 / sample.channels,
    encodingArguments: ['-f', 'lavfi', '-i', input, '-ac', String(sample.channels), '-c:a', 'libmp3lame', ...sample.extra] });
}
writeFileSync(`${directory}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${manifest.files.length} synthetic MP3 fixtures and independent packet/decode measurements.`);
