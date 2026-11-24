// @ts-check
// A minimal MP4 (ISO BMFF) writer for exactly what VVV produces:
// one H.264 video track and one optional Opus audio track, whole file at once.
// The moov box comes before mdat ("fast start"), so players can start early.
//
// References: ISO/IEC 14496-12 (ISO BMFF), 14496-15 (avcC),
// and "Encapsulation of Opus in ISO Base Media File Format" (dOps).

/**
 * @typedef {{ data: Uint8Array, timestamp: number, duration: number, key: boolean }} Sample  timestamp and duration in microseconds
 * @typedef {{ width: number, height: number, fps: number, avcC: Uint8Array, samples: Sample[],
 *   color?: { primaries?: number, transfer?: number, matrix?: number, fullRange?: boolean } }} VideoTrack
 * @typedef {{ sampleRate: number, channels: number, preSkip: number, samples: Sample[] }} AudioTrack
 */

class Writer {
  constructor() {
    /** @type {Uint8Array[]} */
    this.parts = [];
    this.size = 0;
  }
  bytes(b) { this.parts.push(b); this.size += b.length; return this; }
  u8(v) { return this.bytes(new Uint8Array([v & 0xff])); }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return this.bytes(b); }
  i16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); return this.bytes(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return this.bytes(b); }
  u64(v) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v)); return this.bytes(b); }
  str(s) { return this.bytes(new TextEncoder().encode(s)); }
  zeros(n) { return this.bytes(new Uint8Array(n)); }
  concat() {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

/** A box: 32-bit size, 4-character type, then the body. */
function box(type, ...children) {
  const out = new Writer();
  const body = children.flat();
  const size = 8 + body.reduce((a, b) => a + b.length, 0);
  out.u32(size).str(type);
  for (const b of body) out.bytes(b);
  return out.concat();
}

/** A full box: a box whose body starts with version (8 bits) and flags (24 bits). */
function fullBox(type, version, flags, ...children) {
  const vf = new Writer().u8(version).u8(flags >> 16).u16(flags & 0xffff).concat();
  return box(type, vf, ...children);
}

const w = () => new Writer();
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

function mvhd(timescale, duration, nextTrack) {
  const b = w().u32(0).u32(0).u32(timescale).u32(duration).u32(0x00010000).u16(0x0100).zeros(10);
  MATRIX.forEach((m) => b.u32(m));
  b.zeros(24).u32(nextTrack);
  return fullBox('mvhd', 0, 0, b.concat());
}

function tkhd(id, duration, width, height, isAudio) {
  const b = w().u32(0).u32(0).u32(id).u32(0).u32(duration).zeros(8).u16(0).u16(isAudio ? 1 : 0).u16(isAudio ? 0x0100 : 0).u16(0);
  MATRIX.forEach((m) => b.u32(m));
  b.u32(width << 16).u32(height << 16);
  return fullBox('tkhd', 0, 3, b.concat());
}

function mdhd(timescale, duration) {
  // Language "und" packed as three 5-bit letters.
  return fullBox('mdhd', 0, 0, w().u32(0).u32(0).u32(timescale).u32(duration).u16(0x55c4).u16(0).concat());
}

function hdlr(type, name) {
  return fullBox('hdlr', 0, 0, w().u32(0).str(type).zeros(12).str(name).u8(0).concat());
}

const dinf = () => box('dinf', fullBox('dref', 0, 0, w().u32(1).concat(), fullBox('url ', 0, 1)));

/** Sample tables. Every sample is its own chunk, which keeps stsc trivial. */
function stbl(entry, samples, timescale, offsets, isVideo) {
  // stts: run-length encoded sample durations.
  const runs = [];
  for (const s of samples) {
    const d = Math.round((s.duration * timescale) / 1e6);
    const last = runs[runs.length - 1];
    if (last && last[1] === d) last[0]++;
    else runs.push([1, d]);
  }
  const stts = w().u32(runs.length);
  runs.forEach(([n, d]) => stts.u32(n).u32(d));
  const stsc = w().u32(1).u32(1).u32(1).u32(1);
  const stsz = w().u32(0).u32(samples.length);
  samples.forEach((s) => stsz.u32(s.data.length));
  const big = offsets.length > 0 && offsets[offsets.length - 1] > 0xffffffff;
  const co = w().u32(offsets.length);
  offsets.forEach((o) => (big ? co.u64(o) : co.u32(o)));
  const boxes = [
    fullBox('stsd', 0, 0, w().u32(1).concat(), entry),
    fullBox('stts', 0, 0, stts.concat()),
  ];
  if (isVideo && samples.some((s) => !s.key)) {
    const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
    const stss = w().u32(keys.length);
    keys.forEach((k) => stss.u32(k));
    boxes.push(fullBox('stss', 0, 0, stss.concat()));
  }
  boxes.push(fullBox('stsc', 0, 0, stsc.concat()), fullBox('stsz', 0, 0, stsz.concat()), fullBox(big ? 'co64' : 'stco', 0, 0, co.concat()));
  return box('stbl', ...boxes);
}

function avc1(v) {
  const b = w().zeros(6).u16(1).zeros(16).u16(v.width).u16(v.height).u32(0x00480000).u32(0x00480000).u32(0).u16(1);
  const name = 'VVV';
  b.u8(name.length).str(name).zeros(31 - name.length).u16(0x0018).i16(-1);
  const children = [box('avcC', v.avcC)];
  if (v.color) {
    const c = v.color;
    children.push(box('colr', w().str('nclx').u16(c.primaries ?? 1).u16(c.transfer ?? 1).u16(c.matrix ?? 1).u8(c.fullRange ? 0x80 : 0).concat()));
  }
  children.push(box('pasp', w().u32(1).u32(1).concat()));
  return box('avc1', b.concat(), ...children);
}

function opus(a) {
  const b = w().zeros(6).u16(1).zeros(8).u16(a.channels).u16(16).u16(0).u16(0).u32(a.sampleRate << 16);
  // dOps fields are big-endian, unlike the little-endian OpusHead in Ogg.
  const dops = w().u8(0).u8(a.channels).u16(a.preSkip).u32(a.sampleRate).i16(0).u8(0).concat();
  return box('Opus', b.concat(), box('dOps', dops));
}

function trak(id, kind, track, entry, timescale, offsets, movieDuration) {
  const mediaDuration = track.samples.reduce((a, s) => a + Math.round((s.duration * timescale) / 1e6), 0);
  const isVideo = kind === 'video';
  const media = box('mdia',
    mdhd(timescale, mediaDuration),
    hdlr(isVideo ? 'vide' : 'soun', isVideo ? 'VVV video' : 'VVV audio'),
    box('minf',
      isVideo ? fullBox('vmhd', 0, 1, w().zeros(8).concat()) : fullBox('smhd', 0, 0, w().u32(0).concat()),
      dinf(),
      stbl(entry, track.samples, timescale, offsets, isVideo)));
  // No edit list for the Opus priming samples: the decoder already drops dOps PreSkip, and
  // Chrome applies an edit list on top of that, which would cut the priming twice (6.5 ms early).
  const boxes = [tkhd(id, movieDuration, isVideo ? track.width : 0, isVideo ? track.height : 0, !isVideo), media];
  return box('trak', ...boxes);
}

/**
 * Build a complete MP4 file from encoded samples.
 * @param {{ video: VideoTrack, audio?: AudioTrack | null }} t
 * @returns {Uint8Array}
 */
export function muxMp4({ video, audio }) {
  const vScale = video.fps * 1000;
  const aScale = audio?.sampleRate ?? 48000;
  const MOVIE_SCALE = 1000;
  const lastV = video.samples[video.samples.length - 1];
  const durUs = lastV ? lastV.timestamp + lastV.duration : 0;
  const movieDuration = Math.round((durUs * MOVIE_SCALE) / 1e6);

  // Interleave samples by time in mdat, so a player reads both tracks in step.
  /** @type {{ s: Sample, track: 'v' | 'a' }[]} */
  const order = [
    ...video.samples.map((s) => ({ s, track: /** @type {'v'} */ ('v') })),
    ...(audio?.samples ?? []).map((s) => ({ s, track: /** @type {'a'} */ ('a') })),
  ].sort((x, y) => x.s.timestamp - y.s.timestamp || (x.track === 'v' ? -1 : 1));

  const ftyp = box('ftyp', w().str('isom').u32(0x200).str('isomiso2avc1mp41').concat());

  // Build moov twice: once to learn its size, then with the real chunk offsets.
  const build = (base) => {
    const vOff = [];
    const aOff = [];
    let off = base;
    for (const { s, track } of order) {
      (track === 'v' ? vOff : aOff).push(off);
      off += s.data.length;
    }
    const traks = [trak(1, 'video', video, avc1(video), vScale, vOff, movieDuration)];
    if (audio) traks.push(trak(2, 'audio', audio, opus(audio), aScale, aOff, movieDuration));
    return box('moov', mvhd(MOVIE_SCALE, movieDuration, audio ? 3 : 2), ...traks);
  };
  const mdatBody = order.reduce((a, x) => a + x.s.data.length, 0);
  const large = mdatBody + 8 > 0xffffffff;
  const mdatHeader = large ? 16 : 8;
  let moov = build(0);
  // Offsets may need 64 bits, which changes moov's size, so iterate until stable.
  for (let i = 0; i < 3; i++) {
    const next = build(ftyp.length + moov.length + mdatHeader);
    if (next.length === moov.length) { moov = next; break; }
    moov = next;
  }

  const out = new Writer().bytes(ftyp).bytes(moov);
  if (large) out.u32(1).str('mdat').u64(mdatBody + 16);
  else out.u32(mdatBody + 8).str('mdat');
  for (const { s } of order) out.bytes(s.data);
  return out.concat();
}
