// Test movie for vvv validate: movie.js gets names wrong in each way that validate reports.
import { defineMovie } from 'vvv';

export default defineMovie({
  background: '#000000',
  captionStyle: { colour: '#ffffff' },
  musik: {},
  scenes: {
    intro: { draw: (g, s) => s.line('hello') },
    titel: { draw() {} },
    title: { drow() {} },
  },
});
