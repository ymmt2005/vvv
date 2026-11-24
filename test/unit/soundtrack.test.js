// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { automateDuck } from '../../runtime/audio/soundtrack.js';

/** Records automation events the way an AudioParam receives them. */
function recorder() {
  const events = [];
  return {
    events,
    setValueAtTime: (v, t) => events.push({ kind: 'set', v, t }),
    linearRampToValueAtTime: (v, t) => events.push({ kind: 'ramp', v, t }),
  };
}

test('ducking events never go back in time, whatever the gap between lines', () => {
  for (const gap of [0, 0.3, 0.8, 0.9, 0.99, 1.0, 1.5, 3]) {
    const p = recorder();
    automateDuck(p, [[0.5, 2.0], [2.0 + gap, 4.0 + gap]], 0.45);
    for (let i = 1; i < p.events.length; i++) {
      assert.ok(p.events[i].t >= p.events[i - 1].t, `gap ${gap}: event ${i} at ${p.events[i].t} s comes before ${p.events[i - 1].t} s`);
    }
  }
});

test('lines close together share one dip; lines far apart get their own', () => {
  const near = recorder();
  automateDuck(near, [[0.5, 2.0], [2.9, 4.0]], 0.45);
  assert.equal(near.events.filter((e) => e.kind === 'ramp' && e.v === 0.45).length, 1);
  const far = recorder();
  automateDuck(far, [[0.5, 2.0], [3.5, 4.0]], 0.45);
  assert.equal(far.events.filter((e) => e.kind === 'ramp' && e.v === 0.45).length, 2);
});
