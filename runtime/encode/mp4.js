// @ts-check
// A minimal MP4 (ISO BMFF) writer for exactly what VVV produces:
// one H.264 video track, an optional Opus audio track and optional chapters, whole file at once.
// The moov box comes before mdat ("fast start"), so players can start early.
//
// References: ISO/IEC 14496-12 (ISO BMFF), 14496-15 (avcC),
// "Encapsulation of Opus in ISO Base Media File Format" (dOps),
// and for the chapters, the QuickTime File Format and FFmpeg's libavformat/movenc.c.

/**
 * @typedef {{ data: Uint8Array, timestamp: number, duration: number, key: boolean }} Sample  timestamp and duration in microseconds
 * @typedef {{ width: number, height: number, fps: number, avcC: Uint8Array, samples: Sample[],
 *   color?: { primaries?: number, transfer?: number, matrix?: number, fullRange?: boolean } }} VideoTrack
 * @typedef {{ sampleRate: number, channels: number, preSkip: number, samples: Sample[] }} AudioTrack
 * @typedef {{ title: string, start: number }} ChapterMark  start in seconds
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

/** flags: 1 = enabled, 2 = in movie. */
function tkhd(id, duration, width, height, isAudio, flags) {
  const b = w().u32(0).u32(0).u32(id).u32(0).u32(duration).zeros(8).u16(0).u16(isAudio ? 1 : 0).u16(isAudio ? 0x0100 : 0).u16(0);
  MATRIX.forEach((m) => b.u32(m));
  b.u32(width << 16).u32(height << 16);
  return fullBox('tkhd', 0, flags, b.concat());
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

// QuickTime chapters: a text track whose samples are the chapter titles, which the other tracks
// name in a 'chap' track reference. The layout follows FFmpeg's mov_create_chapter_track(), which
// Apple's players read: a disabled track with a 'text' handler, a 'gmhd' media header, and a
// 'text' sample entry. Each sample is a 16-bit length, the UTF-8 title, and an 'encd' box for UTF-8.
const TEXT_ENTRY = new Uint8Array([
  0, 0, 0, 1, 0, 0, 0, 0, 0, 0, // display flags, justification, background colour
  0, 0, 0, 0, 0, 0, 0, 0, // default text box
  0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, // style record: characters, font 1, style, size, colour
  0, 0, 0, 13, 0x66, 0x74, 0x61, 0x62, 0, 1, 0, 1, 0, // 'ftab' with font 1 and an empty name
]);
const ENCD_UTF8 = new Uint8Array([0, 0, 0, 12, 0x65, 0x6e, 0x63, 0x64, 0, 0, 1, 0]);

const textEntry = () => box('text', w().zeros(6).u16(1).bytes(TEXT_ENTRY).concat());

function gmhd() {
  const gmin = fullBox('gmin', 0, 0, w().u16(0x40).u16(0x8000).u16(0x8000).u16(0x8000).u16(0).u16(0).concat());
  // FFmpeg writes this 'text' box verbatim; Apple's chapter support needs it, and no spec documents it.
  const text = box('text', w().u16(1).u32(0).u32(0).u32(0).u32(1).u32(0).u32(0).u32(0).u32(0x4000).u16(0).concat());
  return box('gmhd', gmin, text);
}

/** One chapter sample per mark, in milliseconds, from the first mark (at 0) to the end of the movie. */
function chapterSamples(marks, movieDurationMs) {
  const starts = marks.map((m, i) => (i === 0 ? 0 : Math.round(m.start * 1000)));
  /** @type {Sample[]} */
  const samples = [];
  marks.forEach((m, i) => {
    const end = Math.min(starts[i + 1] ?? movieDurationMs, movieDurationMs);
    if (end <= starts[i]) return;
    const title = new TextEncoder().encode(m.title);
    const data = w().u16(title.length).bytes(title).bytes(ENCD_UTF8).concat();
    samples.push({ data, timestamp: starts[i] * 1000, duration: (end - starts[i]) * 1000, key: true });
  });
  return samples;
}

const MEDIA = {
  video: { handler: 'vide', name: 'VVV video', header: () => fullBox('vmhd', 0, 1, w().zeros(8).concat()) },
  audio: { handler: 'soun', name: 'VVV audio', header: () => fullBox('smhd', 0, 0, w().u32(0).concat()) },
  text: { handler: 'text', name: 'VVV chapters', header: gmhd },
};

/**
 * @param {{ id: number, kind: 'video' | 'audio' | 'text', samples: Sample[], entry: Uint8Array, timescale: number,
 *   offsets: number[], movieDuration: number, width?: number, height?: number, chapterTrack?: number }} t
 */
function trak(t) {
  const mediaDuration = t.samples.reduce((a, s) => a + Math.round((s.duration * t.timescale) / 1e6), 0);
  const m = MEDIA[t.kind];
  const media = box('mdia',
    mdhd(t.timescale, mediaDuration),
    hdlr(m.handler, m.name),
    box('minf', m.header(), dinf(), stbl(t.entry, t.samples, t.timescale, t.offsets, t.kind === 'video')));
  // The chapter track is in the movie but disabled, so players list it as chapters rather than play it as subtitles.
  const boxes = [tkhd(t.id, t.movieDuration, t.width ?? 0, t.height ?? 0, t.kind === 'audio', t.kind === 'text' ? 2 : 3)];
  if (t.chapterTrack) boxes.push(box('tref', box('chap', w().u32(t.chapterTrack).concat())));
  // No edit list for the Opus priming samples: the decoder already drops dOps PreSkip, and
  // Chrome applies an edit list on top of that, which would cut the priming twice (6.5 ms early).
  boxes.push(media);
  return box('trak', ...boxes);
}

/**
 * Build a complete MP4 file from encoded samples.
 * chapters: the chapter titles and start times, in order. The first chapter starts at 0 whatever its time.
 * @param {{ video: VideoTrack, audio?: AudioTrack | null, chapters?: ChapterMark[] }} t
 * @returns {Uint8Array}
 */
export function muxMp4({ video, audio, chapters = [] }) {
  const vScale = video.fps * 1000;
  const aScale = audio?.sampleRate ?? 48000;
  const MOVIE_SCALE = 1000;
  const lastV = video.samples[video.samples.length - 1];
  const durUs = lastV ? lastV.timestamp + lastV.duration : 0;
  const movieDuration = Math.round((durUs * MOVIE_SCALE) / 1e6);
  const chapterTrack = chapterSamples(chapters, movieDuration);
  const ids = { v: 1, a: audio ? 2 : 0, c: chapterTrack.length ? (audio ? 3 : 2) : 0 };

  // Interleave samples by time in mdat, so a player reads the tracks in step.
  const rank = { v: 0, a: 1, c: 2 };
  /** @type {{ s: Sample, track: 'v' | 'a' | 'c' }[]} */
  const order = [
    ...video.samples.map((s) => ({ s, track: /** @type {const} */ ('v') })),
    ...(audio?.samples ?? []).map((s) => ({ s, track: /** @type {const} */ ('a') })),
    ...chapterTrack.map((s) => ({ s, track: /** @type {const} */ ('c') })),
  ].sort((x, y) => x.s.timestamp - y.s.timestamp || rank[x.track] - rank[y.track]);

  const ftyp = box('ftyp', w().str('isom').u32(0x200).str('isomiso2avc1mp41').concat());

  // Build moov twice: once to learn its size, then with the real chunk offsets.
  const build = (base) => {
    const offsets = { v: [], a: [], c: [] };
    let off = base;
    for (const { s, track } of order) {
      offsets[track].push(off);
      off += s.data.length;
    }
    const media = { movieDuration, chapterTrack: ids.c };
    const traks = [trak({ ...media, id: ids.v, kind: 'video', samples: video.samples, entry: avc1(video), timescale: vScale, offsets: offsets.v, width: video.width, height: video.height })];
    if (audio) traks.push(trak({ ...media, id: ids.a, kind: 'audio', samples: audio.samples, entry: opus(audio), timescale: aScale, offsets: offsets.a }));
    if (ids.c) traks.push(trak({ movieDuration, id: ids.c, kind: 'text', samples: chapterTrack, entry: textEntry(), timescale: MOVIE_SCALE, offsets: offsets.c }));
    return box('moov', mvhd(MOVIE_SCALE, movieDuration, traks.length + 1), ...traks);
  };
  const mdatBody = order.reduce((a, x) => a + x.s.data.length, 0);
  const large = mdatBody + 8 > 0xffffffff;
  const mdatHeader = large ? 16 : 8;
  // Offsets past 4 GiB need 64 bits. Each track switches at most once, and each switch grows moov,
  // which moves every offset, so repeat until moov's size stops changing.
  let moov = build(0);
  for (let i = 0; ; i++) {
    const next = build(ftyp.length + moov.length + mdatHeader);
    const stable = next.length === moov.length;
    moov = next;
    if (stable) break;
    if (i > 4) throw new Error('the MP4 index did not settle');
  }

  const out = new Writer().bytes(ftyp).bytes(moov);
  if (large) out.u32(1).str('mdat').u64(mdatBody + 16);
  else out.u32(mdatBody + 8).str('mdat');
  for (const { s } of order) out.bytes(s.data);
  return out.concat();
}
