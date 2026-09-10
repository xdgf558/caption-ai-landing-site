import { sha256 } from '@noble/hashes/sha2.js';

export const mp3Error = (code, status = 422) => Object.assign(new Error(code), { code, status });
export const MP3_LIMITS = Object.freeze({ audioBytes: 33554432, previewBytes: 4194304,
  chunkBytes: 65536, frameBytes: 2048, tagBytes: 1048576, frames: 150000, reads: 65536, timeoutMs: 10000 });

// Fixed carry space: never retain the complete object or a list of decoded frames.
export class Mp3Stream {
  constructor(stream, { expectedBytes, kind, limits = {}, clock = Date.now, signal } = {}) {
    const ceiling = kind === 'audio' ? MP3_LIMITS.audioBytes : kind === 'preview' ? MP3_LIMITS.previewBytes : 0;
    if (!ceiling || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || typeof stream?.getReader !== 'function' ||
      typeof clock !== 'function' || !limits || typeof limits !== 'object' || Array.isArray(limits) ||
      (signal !== undefined && !(signal instanceof AbortSignal))) throw mp3Error('MUSIC_MP3_INVALID_INPUT', 400);
    if (expectedBytes > ceiling) throw mp3Error('MUSIC_MP3_TOO_LARGE', 413);
    this.limits = { ...MP3_LIMITS };
    for (const [key, value] of Object.entries(limits)) {
      if (!['frames', 'reads', 'tagBytes', 'timeoutMs'].includes(key) || !Number.isSafeInteger(value) || value < 1 || value > MP3_LIMITS[key]) {
        throw mp3Error('MUSIC_MP3_INVALID_LIMIT', 400);
      }
      this.limits[key] = value;
    }
    this.clock = clock; this.started = clock(); this.lastTime = this.started;
    if (!Number.isSafeInteger(this.started) || this.started < 0) throw mp3Error('MUSIC_MP3_CLOCK_UNAVAILABLE', 503);
    if (signal?.aborted) throw mp3Error('MUSIC_MP3_ABORTED', 499);
    this.reader = stream.getReader(); this.expectedBytes = expectedBytes;
    this.buffer = new Uint8Array(MP3_LIMITS.chunkBytes + MP3_LIMITS.frameBytes);
    this.start = 0; this.end = 0; this.bytes = 0; this.reads = 0; this.eof = false;
    this.hash = sha256.create(); this.signal = signal;
    this.stop = new Promise((_, reject) => {
      this.timer = setTimeout(() => reject(mp3Error('MUSIC_MP3_TIMEOUT', 503)), this.limits.timeoutMs);
      this.onAbort = () => reject(mp3Error('MUSIC_MP3_ABORTED', 499));
      signal?.addEventListener('abort', this.onAbort, { once: true });
    });
    // The timer can fire between reads. Keep rejection handled even then.
    this.stop.catch(() => {});
  }
  check() {
    const now = this.clock();
    if (!Number.isSafeInteger(now) || now < this.lastTime) throw mp3Error('MUSIC_MP3_CLOCK_UNAVAILABLE', 503);
    this.lastTime = now;
    if (this.signal?.aborted) throw mp3Error('MUSIC_MP3_ABORTED', 499);
    if (now - this.started >= this.limits.timeoutMs) throw mp3Error('MUSIC_MP3_TIMEOUT', 503);
  }
  async ensure(n) {
    if (!Number.isInteger(n) || n < 1 || n > MP3_LIMITS.frameBytes) throw mp3Error('MUSIC_MP3_INVALID_READ', 500);
    this.check();
    while (this.end - this.start < n && !this.eof) {
      if (++this.reads > this.limits.reads) throw mp3Error('MUSIC_MP3_READ_BUDGET');
      const { value, done } = await Promise.race([this.reader.read(), this.stop]);
      this.check();
      if (done) {
        this.eof = true;
        if (this.bytes !== this.expectedBytes) throw mp3Error('MUSIC_MP3_TRUNCATED');
        break;
      }
      if (!(value instanceof Uint8Array) || !value.byteLength || value.byteLength > MP3_LIMITS.chunkBytes) throw mp3Error('MUSIC_MP3_CHUNK_INVALID');
      this.bytes += value.byteLength;
      if (this.bytes > this.expectedBytes) throw mp3Error('MUSIC_MP3_SIZE_MISMATCH');
      this.buffer.copyWithin(0, this.start, this.end); this.end -= this.start; this.start = 0;
      this.buffer.set(value, this.end); this.end += value.byteLength;
      this.hash.update(value);
    }
    return this.end - this.start >= n;
  }
  async peek(n) {
    if (!await this.ensure(n)) return null;
    return this.buffer.subarray(this.start, this.start + n);
  }
  async read(n) {
    if (!await this.ensure(n)) throw mp3Error('MUSIC_MP3_TRUNCATED');
    const value = this.buffer.slice(this.start, this.start + n); this.start += n; return value;
  }
  async skip(n) {
    while (n > 0) {
      if (!await this.ensure(1)) throw mp3Error('MUSIC_MP3_TRUNCATED');
      const used = Math.min(n, this.end - this.start); this.start += used; n -= used;
    }
  }
  digest() { return Array.from(this.hash.digest(), b => b.toString(16).padStart(2, '0')).join(''); }
  close(success) {
    clearTimeout(this.timer); this.signal?.removeEventListener('abort', this.onAbort);
    if (!success) Promise.resolve(this.reader.cancel()).catch(() => {});
    try { this.reader.releaseLock(); } catch { /* A cancelled read can settle after teardown. */ }
    this.hash.destroy();
  }
}
