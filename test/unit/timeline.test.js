// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, captionAt, scenesAt } from '../../runtime/timeline.js';

const VOICE = { credits: ['voice credit'], lines: { 'a-1': { duration: 2, file: 'a-1.wav' }, b1: { duration: 1, file: 'b1.wav', rate: 1.1 } } };

const script = (extra = {}) => ({
  timing: { lead: 0.5, gap: 0.3, tail: 0.7 },
  scenes: [
    { id: 'a', lines: [{ lang: 'en', text: 'one' }] },
    { id: 'b', duration: 5, transition: 0.6, lines: [{ id: 'b1', lang: 'en', text: 'two' }] },
  ],
  ...extra,
});

test('lines are placed after the lead, and a scene lasts until its tail or its duration', () => {
  const tl = buildTimeline(script(), VOICE);
  const [a, b] = tl.scenes;
  assert.deepEqual([a.start, a.end], [0, 3.2]); // 0.5 lead + 2 clip + 0.7 tail
  assert.deepEqual(a.lines.map((l) => [l.id, l.start, l.end]), [['a-1', 0.5, 2.5]]);
  assert.deepEqual([b.start, b.end], [3.2, 8.2]); // the 5 s duration beats 0.5 + 1 + 0.7
  assert.equal(b.lines[0].rate, 1.1);
  assert.equal(tl.frames, Math.round(tl.duration * 30));
  assert.deepEqual(tl.warnings, []);
});

test('a voiced movie gets the voice credit and an automatic credits scene', () => {
  const tl = buildTimeline(script({ credits: ['Made with VVV'] }), VOICE);
  assert.deepEqual(tl.credits, ['Made with VVV', 'voice credit']);
  const last = tl.scenes[tl.scenes.length - 1];
  assert.equal(last.id, 'credits');
  assert.equal(last.duration, 3);
});

test('the voice credit is left out when no line plays a clip', () => {
  const silent = { scenes: [{ id: 'a', duration: 2 }] };
  assert.deepEqual(buildTimeline(silent, VOICE).credits, []);
  assert.equal(buildTimeline(silent, VOICE).scenes.length, 1);
  // Lines exist but have no clip yet: no audio, so no voice credit, and a warning.
  const unvoiced = buildTimeline({ scenes: [{ id: 'x', lines: [{ lang: 'ja', text: 'こんにちは' }] }] }, VOICE);
  assert.deepEqual(unvoiced.credits, []);
  assert.match(unvoiced.warnings[0], /line "x-1" has no voice clip/);
});

test('duplicate ids and empty scenes are refused', () => {
  assert.throws(() => buildTimeline({ scenes: [{ id: 'a', duration: 1 }, { id: 'a', duration: 1 }] }, null), /duplicate scene id/);
  assert.throws(() => buildTimeline({ scenes: [{ id: 'a' }] }, null), /neither lines nor a duration/);
});

test('scenesAt crossfades only inside a transition', () => {
  const tl = buildTimeline(script(), { lines: VOICE.lines });
  const b = tl.scenes[1];
  assert.equal(scenesAt(tl, b.start - 0.01).cur.id, 'a');
  const mid = scenesAt(tl, b.start + 0.3);
  assert.equal(mid.cur.id, 'b');
  assert.equal(mid.prev?.id, 'a');
  assert.ok(Math.abs(mid.mix - 0.5) < 1e-9);
  assert.equal(scenesAt(tl, b.start + 0.7).prev, null);
  assert.equal(scenesAt(tl, tl.duration + 10).cur.id, 'b');
});

test('ids named after Object.prototype members are ordinary ids', () => {
  const s = { scenes: [{ id: 'constructor', lines: [{ id: 'toString', lang: 'en', text: 'hi' }, { id: '__proto__', lang: 'en', text: 'yo' }] }] };
  const tl = buildTimeline(s, { lines: JSON.parse('{"__proto__": {"duration": 1, "file": "__proto__.wav"}}') });
  assert.ok(Number.isFinite(tl.duration));
  assert.deepEqual(tl.lines.map((l) => [l.id, l.estimated]), [['toString', true], ['__proto__', false]]);
  assert.deepEqual(tl.credits, []);
});

test('the caption of the line being spoken wins over one that is fading out', () => {
  const tl = buildTimeline({ timing: { lead: 0, gap: 0, tail: 0 }, scenes: [{ id: 'a', lines: [{ lang: 'en', text: 'one' }, { lang: 'en', text: 'two' }] }] },
    { lines: { 'a-1': { duration: 1, file: 'a-1.wav' }, 'a-2': { duration: 1, file: 'a-2.wav' } } });
  assert.equal(captionAt(tl, 0.5)?.line.id, 'a-1');
  assert.equal(captionAt(tl, 1.0)?.line.id, 'a-2', 'line 2 starts at 1.0 s with no gap');
  assert.equal(captionAt(tl, 2.1)?.line.id, 'a-2', 'the last caption lingers after its line');
  assert.equal(captionAt(tl, 2.5), null);
  assert.ok((captionAt(tl, 1.0)?.alpha ?? 0) < 1, 'a new caption fades in');
});

test('a scene with a chapter title starts a chapter that lasts until the next one, and the first starts at 0', () => {
  const tl = buildTimeline({
    scenes: [
      { id: 'cold-open', duration: 2 },
      { id: 'a', chapter: ' Why ', duration: 3 },
      { id: 'b', duration: 1 },
      { id: 'c', chapter: 'How', duration: 4 },
    ],
    credits: ['thanks'],
  }, null);
  assert.deepEqual(tl.chapters, [{ title: 'Why', start: 0, end: 6 }, { title: 'How', start: 6, end: 13 }]); // the credits card belongs to the last chapter
  assert.deepEqual(tl.scenes.map((s) => s.chapter), [null, 'Why', null, 'How', null]);
  assert.deepEqual(buildTimeline({ scenes: [{ id: 'a', duration: 1 }] }, null).chapters, []);
  for (const chapter of ['', '  ', 'two\nlines', 3]) {
    assert.throws(() => buildTimeline({ scenes: [{ id: 'a', duration: 1, chapter }] }, null), /chapter must be a one-line title/);
  }
});
