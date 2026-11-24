// @ts-check
// Score: expands music.json into notes at absolute times, in seconds.
// Pattern tracks (progression, roots, drums) repeat to the end of the movie, and times can
// name a scene or line, so the music stays in step when the narration changes length.
// Pure code with no browser or Node APIs: the page plays the result, and vvv validate checks it.

import { beatsToSeconds, chord, drums, midi, progression, roots, secondsToBeats } from './music.js';
import { timeOf } from '../timeline.js';

/**
 * @typedef {number | string} TimeRef  seconds from the movie's start, or "<scene or line id>", "<id> + 1.5", "<id> - 0.5"
 * @typedef {[number, number, number | string | (number | string)[], number?]} NoteSpec  [at, length, pitch, velocity]
 * @typedef {{ inst: string, name?: string, gain?: number, pan?: number, reverb?: number, delay?: number,
 *   notes?: NoteSpec[], unit?: 'beats' | 'seconds', at?: TimeRef,
 *   progression?: string[], roots?: string[], drums?: string,
 *   beats?: number, octave?: number, style?: 'block' | 'pulse' | 'arp', step?: number, vel?: number, shift?: number, length?: number,
 *   from?: TimeRef, until?: TimeRef }} TrackSpec
 * @typedef {{ bpm?: number, gain?: number, duck?: number, fadeOut?: number, tracks?: TrackSpec[] }} MusicSpec
 * @typedef {{ time: number, len: number, pitch: number[], vel: number }} Note  seconds, MIDI pitches
 * @typedef {{ inst: string, name: string | null, gain: number, pan: number, reverb: number, delay: number, notes: Note[] }} Track
 * @typedef {{ bpm: number, gain: number, duck: number, fadeOut: number, tracks: Track[], warnings: string[] }} Music
 */

const GENERATORS = /** @type {const} */ (['notes', 'progression', 'roots', 'drums']);

/** Track options that apply only to some kinds of track. */
const OPTION_KINDS = {
  unit: ['notes'], at: ['notes'], style: ['progression'],
  beats: ['progression', 'roots'], octave: ['progression', 'roots'], vel: ['progression', 'roots'],
  step: ['progression', 'roots', 'drums'], shift: ['progression', 'roots', 'drums'], length: ['progression', 'roots', 'drums'],
};

/** An error in music.json, about the field at path, such as "tracks[2].at". unknownId is set for a time that names no scene or line. */
export class MusicError extends Error {
  /** @param {string} path @param {string} message @param {{ unknownId?: string }} [o] */
  constructor(path, message, o = {}) {
    super(`${path}: ${message}`);
    this.unknownId = o.unknownId ?? null;
  }
}

/** Seconds from the movie's start for the time reference in the field at path. */
function resolveTime(ref, timeline, path) {
  const r = timeOf(timeline, ref);
  if ('error' in r) throw new MusicError(path, r.unknownId ? `${r.error} in script.json` : r.error, { unknownId: r.unknownId });
  return r.time;
}

/**
 * Expand music.json into notes at absolute times, checking it against the timeline.
 * It throws a MusicError for a score that cannot play as written, such as a time that names no
 * scene or line, and returns warnings for one that plays but likely not as meant.
 * @param {MusicSpec} spec
 * @param {import('../timeline.js').Timeline} timeline
 * @returns {Music}
 */
export function expandMusic(spec, timeline) {
  const bpm = spec.bpm ?? 100;
  const sec = (b) => beatsToSeconds(b, bpm);
  const warnings = [];
  const names = new Map();
  const tracks = (spec.tracks ?? []).map((tr, i) => {
    const path = `tracks[${i}]`;
    const kinds = GENERATORS.filter((k) => tr[k] !== undefined);
    if (kinds.length !== 1) throw new MusicError(path, `a track needs exactly one of ${GENERATORS.join(', ')}${kinds.length ? `; it has ${kinds.join(' and ')}` : ''}`);
    for (const [option, owners] of Object.entries(OPTION_KINDS)) {
      if (tr[option] !== undefined && !owners.includes(kinds[0])) {
        throw new MusicError(`${path}.${option}`, `applies only to a track with ${owners.join(' or ')}, not ${kinds[0]}`);
      }
    }
    const at = (key) => (tr[key] === undefined ? null : resolveTime(tr[key], timeline, `${path}.${key}`));
    const from = at('from');
    const until = at('until');
    if (from !== null && until !== null && until <= from) {
      throw new MusicError(`${path}.until`, `${until.toFixed(2)} s is not after from, ${from.toFixed(2)} s`);
    }
    if (tr.name !== undefined) {
      if (names.has(tr.name)) throw new MusicError(`${path}.name`, `"${tr.name}" is also the name of ${names.get(tr.name)}`);
      names.set(tr.name, path);
    }
    /** @type {Note[]} */
    let notes;
    if (tr.notes) {
      const base = at('at') ?? 0;
      const toSec = tr.unit === 'seconds' ? (x) => x : sec;
      notes = tr.notes.map(([t, len, pitch, vel], j) => ({ time: base + toSec(t), len: toSec(len), pitch: pitches(pitch, `${path}.notes[${j}]`), vel: vel ?? 0.8 }));
      notes = notes.filter((n) => (from === null || n.time >= from) && (until === null || n.time < until));
      const early = notes.filter((n) => n.time < 0).length;
      const late = notes.filter((n) => n.time >= timeline.duration).length;
      if (early) warnings.push(`${path}: ${early} note(s) start before the movie does, and do not play`);
      if (late) warnings.push(`${path}: ${late} note(s) start after the movie ends at ${timeline.duration.toFixed(2)} s, and do not play`);
      notes = notes.filter((n) => n.time >= 0);
    } else {
      // Patterns run on the beat grid from the movie's start; from and until snap to the nearest beat.
      const total = secondsToBeats(timeline.duration, bpm);
      const fromBeat = from === null ? -Infinity : Math.round(secondsToBeats(from, bpm));
      const untilBeat = until === null ? Infinity : Math.round(secondsToBeats(until, bpm));
      notes = pattern(tr, total, path)
        .map(([a, l, p, v]) => [a + (tr.shift ?? 0), tr.length ?? l, p, v])
        .filter(([a]) => a >= fromBeat && a < untilBeat)
        .map(([a, l, p, v]) => ({ time: sec(a), len: sec(l), pitch: Array.isArray(p) ? p : [p], vel: v }));
      // A negative shift moves the first notes before the movie; they cannot play.
      const early = notes.filter((n) => n.time < 0).length;
      if (early) warnings.push(`${path}: shift moves ${early} note(s) before the movie starts, and they do not play`);
      notes = notes.filter((n) => n.time >= 0);
    }
    if (!notes.some((n) => n.time >= 0 && n.time < timeline.duration)) warnings.push(`${path}: plays no notes within the movie`);
    return { inst: tr.inst, name: tr.name ?? null, gain: tr.gain ?? 1, pan: tr.pan ?? 0, reverb: tr.reverb ?? 0, delay: tr.delay ?? 0, notes };
  });
  return { bpm, gain: spec.gain ?? 0.8, duck: spec.duck ?? 0.45, fadeOut: spec.fadeOut ?? 1.5, tracks, warnings };
}

/** A pattern's notes in beats, [at, len, pitch, vel], repeated until they cover `total` beats. */
function pattern(tr, total, path) {
  const cycles = (beatsPerCycle) => Math.max(1, Math.ceil(total / beatsPerCycle));
  if (tr.drums !== undefined) {
    const steps = tr.drums.replace(/\s/g, '').length;
    return drums(tr.drums, { step: tr.step, repeat: cycles(steps * (tr.step ?? 0.25)) });
  }
  const chords = /** @type {string[]} */ (tr.progression ?? tr.roots);
  const key = tr.progression ? 'progression' : 'roots';
  chords.forEach((c, j) => {
    try { chord(c); } catch (e) { throw new MusicError(`${path}.${key}[${j}]`, /** @type {Error} */ (e).message); }
  });
  const o = { beats: tr.beats, octave: tr.octave, style: tr.style, step: tr.step, vel: tr.vel, repeat: cycles(chords.length * (tr.beats ?? 4)) };
  return tr.progression ? progression(chords, o) : roots(chords, o);
}

function pitches(p, path) {
  try {
    return (Array.isArray(p) ? p : [p]).map(midi);
  } catch (e) {
    throw new MusicError(path, /** @type {Error} */ (e).message);
  }
}
