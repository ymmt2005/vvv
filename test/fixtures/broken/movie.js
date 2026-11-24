// Test movie whose draw function throws between 1.5 s and 1.6 s, and whose text overflows its box.
import { defineMovie, text } from 'vvv';

export default defineMovie({
  scenes: {
    a: {
      draw(g, s) {
        if (s.t >= 1.5 && s.t < 1.6) throw new Error('boom');
        g.fillStyle = '#123';
        g.fillRect(0, 0, s.w, s.h);
        text(g, 'This sentence is far too long for its box', { x: 10, y: 10, width: 80, size: 20, maxLines: 1 });
      },
    },
  },
});
