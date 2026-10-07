import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

// Optional developer tool; CI reads the checked-in bytes and needs no encoder.
// Pass a local FFmpeg executable. No downloads, project dependencies or remote writes.
const binary = process.argv[2];
assert(binary, 'Usage: node scripts/generate-station-video-fixture.mjs /path/to/ffmpeg');
const source = new URL('./fixtures/station-redesign/assets/gentle-station/hero.webp', import.meta.url);
const target = new URL('../tests/fixtures/station-video/', import.meta.url);
const scratch = await mkdtemp(join(tmpdir(), 'station-video-fixture-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  await mkdir(target, { recursive: true });
  const input = await readFile(source), poster = await sharp(input).resize(640, 360, { fit: 'cover' }).png().toBuffer();
  const posterFile = join(scratch, 'poster.png'); await writeFile(posterFile, poster);
  const file = 'gentle-synthetic.mp4', output = fileURLToPath(new URL(file, target));
  const encoding = ['-t', '30', '-vf', 'format=yuv420p', '-r', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-c:a', 'aac', '-b:a', '48k', '-movflags', '+faststart'];
  const run = spawnSync(binary, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', posterFile, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30', ...encoding, output], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const probe = spawnSync(binary, ['-hide_banner', '-i', output], { encoding: 'utf8' });
  assert.match(probe.stderr, /Duration: 00:00:30\.00/); assert.match(probe.stderr, /Video: h264/); assert.match(probe.stderr, /Audio: aac/);
  const bytes = await readFile(output), version = spawnSync(binary, ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0];
  const manifest = { schemaVersion: 1, purpose: 'Local T11 decoder fixture only. Station design illustration plus synthetic sine tone; no actual song, film, release or production rights.',
    encoder: version, localEncoderPackage: '@ffmpeg-installer/darwin-arm64@4.1.5 (temporary tooling, install scripts skipped)',
    source: { path: 'scripts/fixtures/station-redesign/assets/gentle-station/hero.webp', sha256: hash(input), posterSha256: hash(poster) },
    recipe: { image: '640x360 cover-fit PNG, looped', audio: 'sine=frequency=440:sample_rate=48000:duration=30', options: encoding },
    files: [{ file, sha256: hash(bytes), bytes: bytes.length, durationMs: 30000, width: 640, height: 360, videoCodec: 'h264/yuv420p', audioCodec: 'aac' }] };
  await writeFile(new URL('manifest.json', target), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest.files));
} finally { await rm(scratch, { recursive: true, force: true }); }
