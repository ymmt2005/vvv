// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chord, drums, freq, midi, progression, roots } from '../../runtime/audio/music.js';

test('note names map to MIDI numbers and frequencies', () => {
  assert.equal(midi('C4'), 60);
  assert.equal(midi('A4'), 69);
  assert.equal(midi('F#2'), 42);
  assert.equal(midi('Bb3'), 58);
  assert.equal(midi(61), 61);
  assert.equal(freq('A4'), 440);
  assert.throws(() => midi('H2'), /bad pitch/);
});

test('chords and slash chords', () => {
  assert.deepEqual(chord('C', 4), [60, 64, 67]);
  assert.deepEqual(chord('Am7', 3), [57, 60, 64, 67]);
  assert.deepEqual(chord('C/E', 4), [52, 60, 64, 67]);
  assert.throws(() => chord('Cxyz'), /unknown chord quality/);
});

test('progression styles and the bass roots line up in beats', () => {
  assert.deepEqual(progression(['C', 'F'], { beats: 2 }), [[0, 2, [48, 52, 55], 0.8], [2, 2, [53, 57, 60], 0.8]]);
  assert.equal(progression(['C'], { style: 'pulse', step: 1, beats: 4 }).length, 4);
  assert.equal(progression(['C'], { style: 'arp', step: 0.5, beats: 4 }).length, 8);
  assert.deepEqual(roots(['C', 'G/B'], { beats: 4, octave: 2 }).map((n) => [n[0], n[2]]), [[0, 36], [4, 35]]);
});

test('drum patterns place hits by step and repeat', () => {
  const hits = drums('x.o.', { step: 0.5, repeat: 2 });
  assert.deepEqual(hits.map((h) => [h[0], h[3]]), [[0, 1], [1, 0.5], [2, 1], [3, 0.5]]);
});
