// @ts-check
// Expanding music.json: patterns fill the movie, times follow the timeline, and notes come out in seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../../runtime/timeline.js';
import { expandMusic } from '../../runtime/audio/score.js';

// 10 s at 120 bpm: 20 beats, 0.5 s each. Scene "b" starts at 3.1 s, nearest beat 6 (3.0 s).
const TL = buildTimeline({ scenes: [{ id: 'a', duration: 3.1 }, { id: 'b', duration: 6.9, lines: [{ id: 'hi', lang: 'en', text: 'Hi.' }] }] }, { lines: { hi: { duration: 1, file: 'hi.wav' } } });
const expand = (track) => expandMusic({ bpm: 120, tracks: [track] }, TL).tracks[0].notes;

test('a pattern repeats until it covers the movie', () => {
  const kicks = expand({ inst: 'kick', drums: 'x...' });
  assert.equal(kicks.length, 20);
  assert.deepEqual([kicks[0].time, kicks[19].time], [0, 9.5]);
  const chords = expand({ inst: 'pad', progression: ['C', 'F', 'G'] });
  assert.deepEqual(chords.map((n) => n.time), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(chords[1].pitch, [53, 57, 60]);
});

test('from and until snap a pattern to the nearest beat; shift and length change every note', () => {
  assert.deepEqual(expand({ inst: 'bass', roots: ['C'], beats: 1, from: 'b', until: 5 }).map((n) => n.time), [3, 3.5, 4, 4.5]);
  const offbeat = expand({ inst: 'keys', progression: ['C'], style: 'pulse', step: 1, shift: 0.5, length: 0.25 });
  assert.deepEqual([offbeat[0].time, offbeat[0].len], [0.25, 0.125]);
});

test('notes count from at, in beats or in seconds', () => {
  assert.deepEqual(expand({ inst: 'bell', at: 'hi + 0.5', notes: [[1, 2, 'C5']] }).map((n) => [n.time, n.len, n.pitch, n.vel]), [[3.6 + 0.5 + 0.5, 1, [72], 0.8]]);
  assert.deepEqual(expand({ inst: 'bell', unit: 'seconds', at: 'b - 0.1', notes: [[1, 2, ['C5', 'E5'], 0.5]] }).map((n) => [n.time, n.len, n.pitch, n.vel]), [[4, 2, [72, 76], 0.5]]);
});

test('notes before the movie are dropped with a warning, whether at or a negative shift put them there', () => {
  const early = expandMusic({ bpm: 120, tracks: [{ inst: 'swell', unit: 'seconds', at: 'a - 0.6', notes: [[0, 0.6, 'C4'], [1, 0.6, 'C4']] }] }, TL);
  assert.deepEqual(early.tracks[0].notes.map((n) => n.time), [0.4]);
  assert.deepEqual(early.warnings, ['tracks[0]: 1 note(s) start before the movie does, and do not play']);
  const shifted = expandMusic({ bpm: 120, tracks: [{ inst: 'hat', drums: 'x.x.', shift: -0.5 }] }, TL);
  assert.equal(shifted.tracks[0].notes[0].time, 0); // hits every half beat; the one at -0.5 beats is gone
  assert.deepEqual(shifted.warnings, ['tracks[0]: shift moves 1 note(s) before the movie starts, and they do not play']);
  const silent = expandMusic({ bpm: 120, tracks: [{ inst: 'bell', unit: 'seconds', notes: [[11, 1, 'C5']] }] }, TL);
  assert.ok(silent.warnings.includes('tracks[0]: plays no notes within the movie'));
});
