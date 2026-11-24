// @ts-check
// Music theory helpers for writing a score in movie.js.
//
// A score is { bpm, tracks: [{ inst, gain?, pan?, reverb?, delay?, unit?, notes }] }.
// A note is [at, len, pitch, vel?] or { at, len, pitch, vel }.
// at and len are in beats, or in seconds when the track has unit: 'seconds'.
// pitch is a MIDI number, a name such as 'C#4', or an array of them (a chord).

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' → 60, 'F#2' → 42, 'Bb3' → 58. Numbers pass through. */
export function midi(p) {
  if (typeof p === 'number') return p;
  const m = /^([A-G])([#b]*)(-?\d+)$/.exec(p);
  if (!m) throw new Error(`bad pitch "${p}"`);
  const acc = [...m[2]].reduce((a, c) => a + (c === '#' ? 1 : -1), 0);
  return NAMES[m[1]] + acc + (Number(m[3]) + 1) * 12;
}

export const freq = (m) => 440 * 2 ** ((midi(m) - 69) / 12);

const QUALITIES = {
  '': [0, 4, 7], M: [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10],
  add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], '9': [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14],
};

/**
 * Chord symbol to MIDI notes, root in the given octave. 'Am7', 'Fmaj7', 'G7', 'C/E' (slash bass, an octave below).
 * @returns {number[]}
 */
export function chord(symbol, octave = 3) {
  const [main, bass] = symbol.split('/');
  const m = /^([A-G][#b]?)(.*)$/.exec(main);
  if (!m) throw new Error(`bad chord "${symbol}"`);
  const q = QUALITIES[m[2]];
  if (!q) throw new Error(`unknown chord quality "${m[2]}" in "${symbol}"`);
  const root = midi(`${m[1]}${octave}`);
  const notes = q.map((i) => root + i);
  if (bass) notes.unshift(midi(`${bass}${octave - 1}`));
  return notes;
}

const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], pentatonic: [0, 2, 4, 7, 9], minorPentatonic: [0, 3, 5, 7, 10],
};

/** Scale degree (0-based, may exceed the octave or be negative) to MIDI. scale('C4', 'major')(4) → G4. */
export function scale(root, mode = 'major') {
  const steps = MODES[mode];
  if (!steps) throw new Error(`unknown mode "${mode}"`);
  const r = midi(root);
  return (deg) => {
    const o = Math.floor(deg / steps.length);
    return r + o * 12 + steps[((deg % steps.length) + steps.length) % steps.length];
  };
}

/** The chord symbols repeated o.repeat times, each with its start beat. */
function sequence(chords, o) {
  const beats = o.beats ?? 4;
  return Array.from({ length: o.repeat ?? 1 }, () => chords).flat().map((sym, i) => ({ sym, at: (o.start ?? 0) + i * beats }));
}

/**
 * Notes for a chord progression.
 * style 'block' holds each chord; 'arp' plays it note by note every `step` beats; 'pulse' repeats it every `step` beats.
 * @param {string[]} chords
 * @param {{ beats?: number, start?: number, octave?: number, style?: 'block' | 'arp' | 'pulse', step?: number, vel?: number, repeat?: number }} o
 */
export function progression(chords, o = {}) {
  const beats = o.beats ?? 4;
  const step = o.step ?? 0.5;
  const vel = o.vel ?? 0.8;
  const notes = [];
  sequence(chords, o).forEach(({ sym, at }) => {
    const ns = chord(sym, o.octave ?? 3);
    if (!o.style || o.style === 'block') notes.push([at, beats, ns, vel]);
    else if (o.style === 'pulse') for (let b = 0; b < beats; b += step) notes.push([at + b, step * 0.9, ns, vel]);
    else {
      const up = [...ns, ns[1] + 12, ns[2] + 12];
      for (let k = 0, b = 0; b < beats; b += step, k++) notes.push([at + b, step * 1.5, up[k % up.length], vel]);
    }
  });
  return notes;
}

/** Root notes of a progression, for a bass line. */
export function roots(chords, o = {}) {
  const beats = o.beats ?? 4;
  const step = o.step ?? beats;
  const notes = [];
  sequence(chords, o).forEach(({ sym, at }) => {
    // chord() puts a slash chord's bass first, an octave below the root, so C → G/B → Am walks down.
    const r = chord(sym, o.octave ?? 2)[0];
    for (let b = 0; b < beats; b += step) notes.push([at + b, step * 0.85, r, o.vel ?? 0.9]);
  });
  return notes;
}

/** A drum pattern from strings, one character per step: 'x' hit, 'o' soft hit, '.' rest. */
export function drums(pattern, o = {}) {
  const step = o.step ?? 0.25;
  const steps = [...pattern.replace(/\s/g, '')];
  const notes = [];
  for (let r = 0; r < (o.repeat ?? 1); r++) {
    steps.forEach((c, i) => {
      if (c === 'x' || c === 'o') notes.push([(o.start ?? 0) + (r * steps.length + i) * step, step, 60, c === 'x' ? 1 : 0.5]);
    });
  }
  return notes;
}

/** Beats ↔ seconds at a tempo. */
export const beatsToSeconds = (beats, bpm) => (beats * 60) / bpm;
export const secondsToBeats = (sec, bpm) => (sec * bpm) / 60;
