// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muxMp4 } from '../../runtime/encode/mp4.js';
import { avcCodec } from '../../runtime/encode/encoder.js';
import { avcCodecString, chapterTitles, readMp4 } from '../mp4-read.js';

const AVCC = new Uint8Array([1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, 0]);

function sample(i, size, us, key) {
  const data = new Uint8Array(size).fill(i & 0xff);
  return { data, timestamp: i * us, duration: us, key };
}

test('the muxer writes samples that a reader finds at their offsets, times and key flags', () => {
  const video = { width: 320, height: 180, fps: 30, avcC: AVCC, samples: Array.from({ length: 10 }, (_, i) => sample(i, 100 + i, 33333, i % 5 === 0)) };
  const audio = { sampleRate: 48000, channels: 2, preSkip: 312, samples: Array.from({ length: 20 }, (_, i) => sample(200 + i, 50, 20000, true)) };
  const bytes = muxMp4({ video, audio });
  const { tracks } = readMp4(bytes.buffer);
  const [v, a] = tracks;
  assert.equal(v.handler, 'vide');
  assert.equal(v.entry, 'avc1');
  assert.deepEqual([...v.config], [...AVCC]);
  assert.equal(avcCodecString(v.config), 'avc1.640028');
  assert.equal(v.samples.length, 10);
  v.samples.forEach((s, i) => {
    assert.equal(s.size, 100 + i);
    assert.ok(bytes.slice(s.offset, s.offset + s.size).every((b) => b === i), `video sample ${i} bytes`);
    assert.equal(s.key, i % 5 === 0);
    assert.ok(Math.abs(s.time - i / 30) < 1e-3);
  });
  assert.equal(a.handler, 'soun');
  assert.equal(a.entry, 'Opus');
  // dOps: version 0, 2 channels, pre-skip 312 (big-endian), 48 kHz.
  assert.deepEqual([...a.config.slice(0, 4)], [0, 2, 312 >> 8, 312 & 0xff]);
  assert.equal(a.elst, undefined, 'no edit list: the decoder applies the pre-skip itself');
  a.samples.forEach((s, i) => assert.ok(bytes.slice(s.offset, s.offset + s.size).every((b) => b === 200 + i)));
});

test('moov comes before mdat, so players can start before the whole file arrives', () => {
  const video = { width: 2, height: 2, fps: 30, avcC: AVCC, samples: [sample(0, 10, 33333, true)] };
  const bytes = muxMp4({ video });
  const types = [];
  for (let o = 0; o < bytes.length;) {
    const size = new DataView(bytes.buffer, bytes.byteOffset + o).getUint32(0);
    types.push(String.fromCharCode(...bytes.slice(o + 4, o + 8)));
    o += size;
  }
  assert.deepEqual(types, ['ftyp', 'moov', 'mdat']);
  assert.equal(readMp4(bytes.buffer).tracks.length, 1);
});

test('the H.264 level is the lowest that fits the frame size and rate', () => {
  assert.equal(avcCodec(1920, 1080, 30), 'avc1.640028');
  assert.equal(avcCodec(1920, 1080, 60), 'avc1.64002a');
  assert.equal(avcCodec(1280, 720, 30), 'avc1.64001f');
  assert.equal(avcCodec(3840, 2160, 30), 'avc1.640033');
  assert.throws(() => avcCodec(7680, 4320, 60), /beyond H.264 level 5.2/);
});

test('chapters become a disabled text track that the video and audio tracks reference', () => {
  const video = { width: 2, height: 2, fps: 10, avcC: AVCC, samples: Array.from({ length: 50 }, (_, i) => sample(i, 10, 100000, i === 0)) };
  const audio = { sampleRate: 48000, channels: 2, preSkip: 312, samples: Array.from({ length: 250 }, (_, i) => sample(i, 5, 20000, true)) };
  const chapters = [{ title: 'Start', start: 0.4 }, { title: '後半 & more', start: 2.25 }, { title: 'too late', start: 5 }];
  const bytes = muxMp4({ video, audio, chapters });
  const { tracks } = readMp4(bytes.buffer);
  const [v, a, c] = tracks;
  assert.deepEqual(tracks.map((t) => [t.id, t.handler, t.flags]), [[1, 'vide', 3], [2, 'soun', 3], [3, 'text', 2]]);
  assert.deepEqual([v.chap, a.chap, c.chap], [3, 3, null]);
  assert.equal(c.entry, 'text');
  // The first chapter starts at 0 whatever its time; a chapter at or after the end of the movie is dropped.
  assert.deepEqual(c.samples.map((s) => [s.time, s.duration]), [[0, 2.25], [2.25, 2.75]]);
  assert.deepEqual(chapterTitles(bytes.buffer, c), ['Start', '後半 & more']);
  const first = c.samples[0];
  assert.deepEqual([...bytes.slice(first.offset + 7, first.offset + first.size)], [0, 0, 0, 12, 0x65, 0x6e, 0x63, 0x64, 0, 0, 1, 0], 'an encd box for UTF-8 after the title');
  assert.equal(readMp4(muxMp4({ video }).buffer).tracks[0].chap, null, 'no chapters, no reference');
});
