// @ts-check
// A small MP4 reader for tests: lists each track's codec config and samples,
// so tests can decode VVV's output with WebCodecs and compare it with what
// the stage drew. It reads the boxes that VVV's muxer writes, and looks for an
// edit list only so that a test can check there is none.

function boxes(dv, start, end) {
  const out = [];
  let off = start;
  while (off + 8 <= end) {
    let size = dv.getUint32(off);
    const type = String.fromCharCode(dv.getUint8(off + 4), dv.getUint8(off + 5), dv.getUint8(off + 6), dv.getUint8(off + 7));
    let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(off + 8)); hdr = 16; }
    out.push({ type, start: off, body: off + hdr, end: off + size });
    off += size;
  }
  return out;
}

function find(dv, parent, path) {
  let cur = parent;
  for (const t of path) {
    const kids = boxes(dv, cur.body, cur.end);
    cur = kids.find((b) => b.type === t);
    if (!cur) return null;
  }
  return cur;
}

/**
 * @param {ArrayBuffer} buf
 * @returns {{ tracks: { id: number, flags: number, chap: number | null, handler: string, timescale: number, entry: string, config: Uint8Array,
 *   samples: { offset: number, size: number, time: number, duration: number, key: boolean }[], elst?: number }[] }}
 */
export function readMp4(buf) {
  const dv = new DataView(buf);
  const top = boxes(dv, 0, buf.byteLength);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Error('no moov box');
  const tracks = boxes(dv, moov.body, moov.end).filter((b) => b.type === 'trak').map((trak) => {
    const hdlr = /** @type {any} */ (find(dv, trak, ['mdia', 'hdlr']));
    const handler = String.fromCharCode(...new Uint8Array(buf, hdlr.body + 8, 4));
    const mdhd = /** @type {any} */ (find(dv, trak, ['mdia', 'mdhd']));
    const timescale = dv.getUint32(mdhd.body + 12);
    const stbl = /** @type {any} */ (find(dv, trak, ['mdia', 'minf', 'stbl']));
    const stsd = /** @type {any} */ (find(dv, stbl, ['stsd']));
    const entry = boxes(dv, stsd.body + 8, stsd.end)[0];
    // avc1 and Opus: the first child box (avcC, dOps). Others: the entry's body after the data reference index.
    const skip = { avc1: 78, Opus: 28 }[entry.type];
    const inner = skip ? boxes(dv, entry.body + skip, entry.end)[0] : { body: entry.body + 8, end: entry.end };
    const config = new Uint8Array(buf.slice(inner.body, inner.end));
    const tkhd = /** @type {any} */ (find(dv, trak, ['tkhd']));
    const chap = find(dv, trak, ['tref', 'chap']);
    const stsz = /** @type {any} */ (find(dv, stbl, ['stsz']));
    const n = dv.getUint32(stsz.body + 8);
    const sizes = Array.from({ length: n }, (_, i) => dv.getUint32(stsz.body + 12 + i * 4));
    const stco = find(dv, stbl, ['stco']) ?? find(dv, stbl, ['co64']);
    const big = /** @type {any} */ (stco).type === 'co64';
    const offsets = Array.from({ length: n }, (_, i) => (big ? Number(dv.getBigUint64(stco.body + 8 + i * 8)) : dv.getUint32(stco.body + 8 + i * 4)));
    const stts = /** @type {any} */ (find(dv, stbl, ['stts']));
    const times = [];
    const durations = [];
    let t = 0;
    for (let e = 0, cnt = dv.getUint32(stts.body + 4); e < cnt; e++) {
      const k = dv.getUint32(stts.body + 8 + e * 8);
      const d = dv.getUint32(stts.body + 12 + e * 8);
      for (let j = 0; j < k; j++) { times.push(t); durations.push(d); t += d; }
    }
    const stss = find(dv, stbl, ['stss']);
    const keys = stss ? new Set(Array.from({ length: dv.getUint32(stss.body + 4) }, (_, i) => dv.getUint32(stss.body + 8 + i * 4) - 1)) : null;
    const elst = find(dv, trak, ['edts', 'elst']);
    return {
      id: dv.getUint32(tkhd.body + 12), flags: dv.getUint32(tkhd.body) & 0xffffff, chap: chap ? dv.getUint32(chap.body) : null,
      handler, timescale, entry: entry.type, config,
      samples: sizes.map((size, i) => ({ offset: offsets[i], size, time: times[i] / timescale, duration: durations[i] / timescale, key: keys ? keys.has(i) : true })),
      elst: elst ? dv.getInt32(elst.body + 12) : undefined,
    };
  });
  return { tracks };
}

/**
 * The titles in a QuickTime chapter track: each sample is a 16-bit length, then the UTF-8 title.
 * @param {ArrayBuffer} buf
 * @param {{ samples: { offset: number }[] }} track
 */
export function chapterTitles(buf, track) {
  const dv = new DataView(buf);
  return track.samples.map((s) => new TextDecoder().decode(new Uint8Array(buf, s.offset + 2, dv.getUint16(s.offset))));
}

/** The WebCodecs codec string for an avcC record: avc1.PPCCLL. */
export function avcCodecString(avcC) {
  const hex = (b) => b.toString(16).padStart(2, '0');
  return `avc1.${hex(avcC[1])}${hex(avcC[2])}${hex(avcC[3])}`;
}
