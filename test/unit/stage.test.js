// @ts-check
// s.notes(name): a named music.json track's notes, timed from the scene's start like s.line().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Stage } from '../../runtime/stage.js';

/** A Stage without a canvas: notesOf needs only the expanded music. */
function stage(music) {
  const s = Object.create(Stage.prototype);
  s.music = music;
  return s;
}

test('notes are timed from the scene start, and an unknown name is an error', () => {
  const s = stage({ bpm: 120, gain: 1, duck: 1, fadeOut: 0, warnings: [], tracks: [
    { inst: 'bark', name: 'barks', gain: 1, pan: 0, reverb: 0, delay: 0, notes: [{ time: 3.35, len: 0.25, pitch: [66], vel: 1 }] },
  ] });
  assert.deepEqual(s.notesOf('barks', 3), [{ start: 3.35 - 3, end: 3.6 - 3, pitch: [66], vel: 1 }]);
  assert.throws(() => s.notesOf('bark', 3), /music\.json has no track named "bark"/);
  assert.throws(() => stage(null).notesOf('barks', 0), /no track named/);
});
