// Test movie: each frame shows its own index as 8 bit blocks (white = 1), so a
// decoder can tell exactly which frame it got. A kick sounds at 1.000 s; the
// render test looks for it there. A silent bark checks that velocity 0 renders.
import { defineMovie } from 'vvv';

function bits(g, s) {
  const i = Math.round(s.T * s.timeline.fps);
  const w = s.w / 8;
  for (let b = 0; b < 8; b++) {
    g.fillStyle = (i >> (7 - b)) & 1 ? '#ffffff' : '#000000';
    g.fillRect(b * w, 0, w, s.h);
  }
}

export default defineMovie({
  background: '#000000',
  scenes: { a: { draw: bits }, b: { draw: bits } },
  music: () => ({
    bpm: 120,
    tracks: [
      { inst: 'kick', unit: 'seconds', notes: [[1.0, 0.2, 60, 1]] },
      { inst: 'bark', unit: 'seconds', notes: [[2.0, 0.2, 60, 0]] },
    ],
  }),
});
