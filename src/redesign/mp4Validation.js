import { fail } from '../music/adminValidation.js';
import { STATION_VIDEO_LIMITS as limits } from './mediaFormats.js';

// Bounded ISO-BMFF container/SPS inspection, not a codec decoder or transcoder.
// Only self-contained, non-fragmented avc1 (8-bit 4:2:0 H.264) + optional mp4a
// uploads are accepted. All bytes are separately hashed by the storage reader.
const bad = () => fail('STATION_VIDEO_STRUCTURE_INVALID');
const unsupported = () => fail('STATION_VIDEO_UNSUPPORTED');
const tag = (bytes, p) => String.fromCharCode(...bytes.subarray(p, p + 4));
function view(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function integer64(v, p) {
  const n = v.getBigUint64(p);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) bad();
  return Number(n);
}
function boxes(bytes, start = 0, end = bytes.length, budget = { n: 0 }) {
  const v = view(bytes), out = [];
  for (let p = start; p < end;) {
    if (end - p < 8 || ++budget.n > limits.boxes) bad();
    let n = v.getUint32(p), header = 8;
    if (n === 1) { if (end - p < 16) bad(); n = integer64(v, p + 8); header = 16; }
    if (n < header || p + n > end) bad();
    out.push({ type: tag(bytes, p + 4), bytes: bytes.subarray(p + header, p + n), start: p, end: p + n });
    p += n;
  }
  return out;
}
function one(items, type, optional = false) {
  const found = items.filter(b => b.type === type);
  if (found.length !== (optional && !found.length ? 0 : 1)) bad();
  return found[0]?.bytes;
}
function full(bytes, versions = [0]) {
  if (!bytes || bytes.length < 4 || !versions.includes(bytes[0])) bad();
  return view(bytes);
}
function timing(bytes, movie = false) {
  const v = full(bytes, [0, 1]), p = bytes[0] === 1 ? 20 : 12;
  if (bytes.length < p + (bytes[0] === 1 ? 12 : 8)) bad();
  const scale = v.getUint32(p), duration = bytes[0] === 1 ? integer64(v, p + 4) : v.getUint32(p + 4);
  const ms = duration / scale * 1000;
  if (!scale || !duration || !Number.isFinite(ms) || ms < 1 || ms > limits.durationMs + (movie ? 0 : 1000)) bad();
  return { scale, duration, ms };
}
function sampleTable(bytes, stride) {
  const v = full(bytes);
  if (bytes.length < 8) bad();
  const n = v.getUint32(4);
  if (!n || n > limits.samples || bytes.length !== 8 + n * stride) bad();
  return { v, n };
}

// Parse just the SPS fields needed for coded/cropped pixel dimensions. Loops and
// Exp-Golomb lengths are bounded independently of the declared frame dimensions.
function spsDimensions(nal) {
  if (nal.length < 5 || nal.length > 65536 || nal[0] & 128 || (nal[0] & 31) !== 7) bad();
  const rbsp = [];
  for (let i = 1; i < nal.length; i++) {
    if (i > 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) {
      if (i + 1 === nal.length || nal[i + 1] > 3) bad();
    } else rbsp.push(nal[i]);
  }
  let bit = 0;
  const bits = n => {
    if (n > 32 || bit + n > rbsp.length * 8) bad();
    let value = 0;
    for (let i = 0; i < n; i++, bit++) value = value * 2 + ((rbsp[bit >> 3] >> (7 - (bit & 7))) & 1);
    return value;
  };
  const ue = () => { let zeros = 0; while (bits(1) === 0) if (++zeros > 24) bad(); return 2 ** zeros - 1 + bits(zeros); };
  const se = () => { const n = ue(); return n & 1 ? (n + 1) / 2 : -n / 2; };
  const profile = bits(8); bits(8); bits(8);
  if (![66, 77, 100].includes(profile)) unsupported();
  if (ue() > 31) bad();
  if (profile === 100) {
    if (ue() !== 1 || ue() !== 0 || ue() !== 0) unsupported();
    bits(1);
    if (bits(1)) for (let i = 0; i < 8; i++) if (bits(1)) {
      let last = 8, next = 8;
      for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
        if (next) { const delta = se(); if (delta < -128 || delta > 127) bad(); next = (last + delta + 256) % 256; }
        last = next || last;
      }
    }
  }
  if (ue() > 12) bad();
  const order = ue();
  if (order === 0) { if (ue() > 12) bad(); }
  else if (order === 1) { bits(1); se(); se(); const n = ue(); if (n > 256) bad(); for (let i = 0; i < n; i++) se(); }
  else if (order !== 2) bad();
  if (ue() > 16) bad(); bits(1);
  const columns = ue() + 1, rows = ue() + 1;
  if (columns > 480 || rows > 480) bad();
  const progressive = bits(1);
  if (!progressive) bits(1);
  bits(1);
  let left = 0, right = 0, top = 0, bottom = 0;
  if (bits(1)) { left = ue(); right = ue(); top = ue(); bottom = ue(); }
  const width = columns * 16 - (left + right) * 2;
  const height = (2 - progressive) * rows * 16 - (top + bottom) * 2 * (2 - progressive);
  if (width < 1 || height < 1 || width > limits.dimension || height > limits.dimension) bad();
  return { width, height };
}
function avc(bytes, width, height) {
  if (!bytes || bytes.length < 7 || bytes[0] !== 1 || (bytes[4] & 3) !== 3) unsupported();
  const v = view(bytes), sets = bytes[5] & 31;
  if (!sets || sets > 8) bad();
  let p = 6;
  for (let i = 0; i < sets; i++) {
    if (p + 2 > bytes.length) bad(); const n = v.getUint16(p); p += 2;
    if (!n || p + n > bytes.length) bad();
    const dimensions = spsDimensions(bytes.subarray(p, p + n));
    if (dimensions.width !== width || dimensions.height !== height || bytes[p + 1] !== bytes[1]) bad();
    p += n;
  }
  if (p === bytes.length) bad();
  const pictures = bytes[p++];
  if (!pictures || pictures > 8) bad();
  for (let i = 0; i < pictures; i++) {
    if (p + 2 > bytes.length) bad(); const n = v.getUint16(p); p += 2;
    if (n < 2 || p + n > bytes.length || (bytes[p] & 31) !== 8 || bytes[p] & 128) bad();
    p += n;
  }
  if (p !== bytes.length) {
    // High-profile avcC extension: 4:2:0, 8 bit, no additional SPS extension.
    if (bytes[1] !== 100 || bytes.length - p !== 4 || (bytes[p] & 3) !== 1 ||
      (bytes[p + 1] & 7) !== 0 || (bytes[p + 2] & 7) !== 0 || bytes[p + 3] !== 0) unsupported();
  }
}
function aac(esds, rate) {
  const v = full(esds);
  if (esds.length > 4096) bad();
  const descriptor = (p, end, type) => {
    if (p >= end || esds[p++] !== type) bad();
    let n = 0, done = false;
    for (let i = 0; i < 4; i++) { if (p >= end) bad(); const b = esds[p++]; n = n * 128 + (b & 127); if (!(b & 128)) { done = true; break; } }
    if (!done || !n || p + n > end) bad();
    return { p, end: p + n };
  };
  const es = descriptor(4, esds.length, 3);
  if (es.end !== esds.length || es.end - es.p < 3 || esds[es.p + 2] !== 0) unsupported();
  const decoder = descriptor(es.p + 3, es.end, 4);
  if (decoder.end - decoder.p < 15 || esds[decoder.p] !== 64 || (esds[decoder.p + 1] >> 2) !== 5) unsupported();
  const config = descriptor(decoder.p + 13, decoder.end, 5);
  if (config.end - config.p < 2 || config.end !== decoder.end) bad();
  const asc = v.getUint16(config.p), objectType = asc >> 11, index = (asc >> 7) & 15, channels = (asc >> 3) & 15;
  const rates = [96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350];
  if (objectType !== 2 || ![1, 2].includes(channels) || rates[index] !== rate) unsupported();
  const sl = descriptor(decoder.end, es.end, 6);
  if (sl.end !== es.end || sl.end - sl.p !== 1 || esds[sl.p] !== 2) unsupported();
}
function description(bytes, handler, budget) {
  const v = full(bytes);
  if (bytes.length < 16 || v.getUint32(4) !== 1) unsupported();
  const items = boxes(bytes, 8, bytes.length, budget);
  if (items.length !== 1) bad();
  const entry = items[0], b = entry.bytes, e = view(b);
  if (b.length < 8 || e.getUint16(6) !== 1) unsupported();
  if (handler === 'vide') {
    if (entry.type !== 'avc1' || b.length < 78) unsupported();
    const width = e.getUint16(24), height = e.getUint16(26);
    const children = boxes(b, 78, b.length, budget);
    avc(one(children, 'avcC'), width, height);
    const aspect = one(children, 'pasp', true);
    if (aspect && (aspect.length !== 8 || view(aspect).getUint32(0) !== view(aspect).getUint32(4) || !view(aspect).getUint32(0))) unsupported();
    return { width, height, codec: 'avc1' };
  }
  if (handler !== 'soun' || entry.type !== 'mp4a' || b.length < 28 || e.getUint16(8) !== 0 ||
    ![1, 2].includes(e.getUint16(16)) || e.getUint16(18) !== 16 || e.getUint32(24) < 8000 * 65536 || e.getUint32(24) > 96000 * 65536) unsupported();
  const esds = one(boxes(b, 28, b.length, budget), 'esds');
  if (!esds || esds.length < 12 || esds.length > 4096 || esds[0] !== 0) bad();
  aac(esds, e.getUint32(24) / 65536);
  // AAC-LC decoder configuration is checked; packet decoding is a manual review.
  return { codec: 'mp4a' };
}
function selfContained(bytes, budget) {
  const dref = one(boxes(bytes, 0, bytes.length, budget), 'dref'), v = full(dref);
  if (dref.length < 8 || v.getUint32(4) !== 1) unsupported();
  const entries = boxes(dref, 8, dref.length, budget);
  if (entries.length !== 1 || entries[0].type !== 'url ' || entries[0].bytes.length !== 4 || view(entries[0].bytes).getUint32(0) !== 1) unsupported();
}
function track(bytes, movie, budget) {
  const children = boxes(bytes, 0, bytes.length, budget), tkhd = one(children, 'tkhd'), tv = full(tkhd, [0, 1]);
  const shift = tkhd[0] === 1 ? 12 : 0;
  if (tkhd.length !== 84 + shift) bad();
  const id = tv.getUint32(12 + (shift ? 8 : 0));
  const duration = shift ? integer64(tv, 28) : tv.getUint32(20);
  const ms = duration / movie.scale * 1000;
  if (!id || !duration || Math.abs(ms - movie.ms) > 1000) bad();
  const media = boxes(one(children, 'mdia'), 0, one(children, 'mdia').length, budget);
  const time = timing(one(media, 'mdhd')), hdlr = one(media, 'hdlr');
  if (hdlr.length < 12) bad(); full(hdlr); const handler = tag(hdlr, 8);
  const minf = one(media, 'minf'), min = boxes(minf, 0, minf.length, budget);
  selfContained(one(min, 'dinf'), budget);
  const stbl = one(min, 'stbl'), samples = boxes(stbl, 0, stbl.length, budget);
  const desc = description(one(samples, 'stsd'), handler, budget);
  if (handler === 'vide') {
    const matrix = 40 + shift, a = tv.getInt32(matrix), b = tv.getInt32(matrix + 4), c = tv.getInt32(matrix + 12), d = tv.getInt32(matrix + 16);
    if (tv.getInt32(matrix + 8) || tv.getInt32(matrix + 20) || tv.getInt32(matrix + 32) !== 1073741824 ||
      ![[65536,0,0,65536],[-65536,0,0,-65536],[0,65536,-65536,0],[0,-65536,65536,0]].some(m => m[0] === a && m[1] === b && m[2] === c && m[3] === d) ||
      tv.getUint32(76 + shift) !== desc.width * 65536 || tv.getUint32(80 + shift) !== desc.height * 65536) unsupported();
    if (b) [desc.width, desc.height] = [desc.height, desc.width];
  }
  const edit = one(children, 'edts', true);
  if (edit) {
    const elst = one(boxes(edit, 0, edit.length, budget), 'elst'), ev = full(elst, [0, 1]), stride = elst[0] ? 20 : 12;
    const n = ev.getUint32(4);
    if (!n || n > 2 || elst.length !== 8 + n * stride) unsupported();
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const p = 8 + i * stride, segment = stride === 20 ? integer64(ev, p) : ev.getUint32(p);
      const offset = stride === 20 ? ev.getBigInt64(p + 8) : BigInt(ev.getInt32(p + 4));
      if (!segment || offset < -1n || offset > BigInt(time.duration) || ev.getUint32(p + stride - 4) !== 65536) unsupported();
      sum += segment;
    }
    if (sum !== duration) bad();
  }
  const size = one(samples, 'stsz'), sv = full(size);
  if (size.length < 12) bad();
  const constant = sv.getUint32(4), count = sv.getUint32(8);
  if (!count || count > limits.samples || size.length !== 12 + (constant ? 0 : count * 4)) bad();
  const stts = sampleTable(one(samples, 'stts'), 8); let ticks = 0, timed = 0, maxDelta = 0;
  for (let i = 0; i < stts.n; i++) {
    const n = stts.v.getUint32(8 + i * 8), delta = stts.v.getUint32(12 + i * 8);
    if (!n || !delta || (timed += n) > count) bad(); ticks += n * delta; maxDelta = Math.max(maxDelta, delta);
  }
  // Encoders can include one AAC priming frame in stts outside mdhd duration.
  if (timed !== count || !Number.isSafeInteger(ticks) || ticks < time.duration ||
    ticks - time.duration > (handler === 'soun' ? maxDelta : 0)) bad();
  const composition = one(samples, 'ctts', true);
  if (composition) {
    full(composition, [0, 1]); if (composition.length < 8) bad();
    const cv = view(composition), n = cv.getUint32(4); let total = 0, decode = 0, timeIndex = 0;
    let timeLeft = stts.v.getUint32(8), delta = stts.v.getUint32(12);
    if (!n || n > count || composition.length !== 8 + n * 8) bad();
    for (let i = 0; i < n; i++) {
      let remaining = cv.getUint32(8 + i * 8);
      const offset = composition[0] ? cv.getInt32(12 + i * 8) : cv.getUint32(12 + i * 8);
      if (!remaining || (total += remaining) > count) bad();
      // This upload profile permits at most one second of frame reordering.
      // Check presentation times as well as decode duration; a forged ctts
      // offset must not make a short declared movie play far beyond its end.
      if (Math.abs(offset) > time.scale) unsupported();
      while (remaining) {
        const take = Math.min(remaining, timeLeft), end = decode + take * delta;
        if (decode + offset < -time.scale || end + offset > ticks + time.scale) bad();
        decode = end; remaining -= take; timeLeft -= take;
        if (!timeLeft && total - remaining < count) {
          timeIndex++; if (timeIndex >= stts.n) bad();
          timeLeft = stts.v.getUint32(8 + timeIndex * 8); delta = stts.v.getUint32(12 + timeIndex * 8);
        }
      }
    }
    if (total !== count) bad();
  }
  const sync = one(samples, 'stss', true);
  if (sync) { const ss = sampleTable(sync, 4); let previous = 0;
    for (let i = 0; i < ss.n; i++) { const n = ss.v.getUint32(8 + i * 4); if (n <= previous || n > count) bad(); previous = n; }
  }
  const mapping = sampleTable(one(samples, 'stsc'), 12);
  const offsets = one(samples, 'stco', true), wide = one(samples, 'co64', true);
  if (!!offsets === !!wide) bad();
  const chunks = sampleTable(offsets || wide, wide ? 8 : 4), ranges = [];
  let map = 0, next = Infinity, sample = 0, perChunk = 0, previous = 0;
  for (let i = 0; i < mapping.n; i++) {
    const first = mapping.v.getUint32(8 + i * 12);
    if (first <= previous || first > chunks.n || (!i && first !== 1) || !mapping.v.getUint32(12 + i * 12) || mapping.v.getUint32(16 + i * 12) !== 1) bad();
    previous = first;
  }
  for (let i = 1; i <= chunks.n; i++) {
    if (i === 1 || i === next) {
      perChunk = mapping.v.getUint32(12 + map * 12); map++;
      next = map < mapping.n ? mapping.v.getUint32(8 + map * 12) : Infinity;
    }
    if (sample + perChunk > count) bad();
    let length = 0;
    for (let j = 0; j < perChunk; j++, sample++) { const n = constant || sv.getUint32(12 + sample * 4); if (!n) bad(); length += n; }
    const offset = wide ? integer64(chunks.v, 8 + (i - 1) * 8) : chunks.v.getUint32(8 + (i - 1) * 4);
    ranges.push({ start: offset, end: offset + length });
  }
  if (sample !== count) bad();
  return { id, handler, ms, ...desc, ranges };
}
function movie(bytes, mdats) {
  const budget = { n: 0 }, children = boxes(bytes, 0, bytes.length, budget);
  if (children.some(b => ['mvex', 'cmov'].includes(b.type))) unsupported();
  const time = timing(one(children, 'mvhd'), true), tracks = children.filter(b => b.type === 'trak');
  if (!tracks.length || tracks.length > 2) unsupported();
  const records = tracks.map(b => track(b.bytes, time, budget)), videos = records.filter(t => t.handler === 'vide');
  if (videos.length !== 1 || records.filter(t => t.handler === 'soun').length > 1 || new Set(records.map(t => t.id)).size !== records.length) unsupported();
  const ranges = records.flatMap(t => t.ranges).sort((a, b) => a.start - b.start);
  let previous = 0;
  for (const r of ranges) {
    if (r.start < previous || !Number.isSafeInteger(r.end) || !mdats.some(m => r.start >= m.start && r.end <= m.end)) bad();
    previous = r.end;
  }
  return { durationMs: Math.round(time.ms), width: videos[0].width, height: videos[0].height,
    measurement: 'mp4-container-sps-v1', videoCodec: 'avc1', audioCodec: records.find(t => t.handler === 'soun')?.codec || null };
}

// Only the moov (<=2 MiB) and ftyp (<=256 bytes) are buffered. mdat is skipped
// while the caller hashes it. Both faststart and tail-moov files are supported.
export function createMp4Inspector(totalBytes) {
  let position = 0, header = new Uint8Array(16), used = 0, needed = 8, active = null, count = 0, moov = null, ftyp = false;
  const mdats = [];
  const finish = box => {
    if (box.type === 'ftyp') {
      if (box.buffer.length < 8 || box.buffer.length % 4 || !['isom','iso2','mp41','mp42','avc1'].includes(tag(box.buffer, 0))) unsupported();
      ftyp = true;
    } else if (box.type === 'moov') moov = box.buffer;
  };
  return {
    push(bytes) {
      for (let p = 0; p < bytes.length;) {
        if (!active) {
          const n = Math.min(needed - used, bytes.length - p);
          header.set(bytes.subarray(p, p + n), used); used += n; p += n; position += n;
          if (used < needed) continue;
          const hv = view(header);
          if (needed === 8 && hv.getUint32(0) === 1) { needed = 16; continue; }
          const start = position - needed, size = needed === 16 ? integer64(hv, 8) : hv.getUint32(0), type = tag(header, 4);
          if (!size || size < needed || start + size > totalBytes || ++count > limits.boxes) bad();
          if (!['ftyp','moov','mdat','free','skip'].includes(type)) unsupported();
          if ((type === 'ftyp' && (start !== 0 || ftyp)) || (type === 'moov' && moov)) bad();
          if ((type === 'ftyp' && size - needed > 256) || (type === 'moov' && size - needed > limits.moovBytes)) fail('STATION_VIDEO_METADATA_TOO_LARGE');
          active = { type, remaining: size - needed, buffer: ['ftyp','moov'].includes(type) ? new Uint8Array(size - needed) : null, written: 0 };
          if (type === 'mdat') { if (size === needed) bad(); mdats.push({ start: position, end: start + size }); }
          used = 0; needed = 8;
        }
        const n = Math.min(active.remaining, bytes.length - p);
        active.buffer?.set(bytes.subarray(p, p + n), active.written);
        active.remaining -= n; active.written += n; p += n; position += n;
        if (!active.remaining) { finish(active); active = null; }
      }
    },
    finish() {
      if (position !== totalBytes || active || used || !ftyp || !moov || !mdats.length) bad();
      try { return movie(moov, mdats); }
      catch (error) { if (error.code) throw error; bad(); }
    }
  };
}
