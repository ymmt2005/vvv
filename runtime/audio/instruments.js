// @ts-check
// Synth instruments built from Web Audio nodes. Each instrument schedules one
// note on a BaseAudioContext; nothing here reads the wall clock, so an
// OfflineAudioContext renders the same audio every time.

import { rng } from '../ease.js';

/**
 * @typedef {{ time: number, dur: number, freq: number, vel: number }} Note
 * @typedef {(ctx: BaseAudioContext, out: AudioNode, n: Note, kit: Kit) => void} Instrument
 */

/** Shared per-context resources: seeded noise and cached Karplus-Strong buffers. */
export class Kit {
  /** @param {BaseAudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const r = rng(12345);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
    /** @type {Map<string, AudioBuffer>} */
    this.plucks = new Map();
  }

  noiseSource(time, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(time, (time * 7.31) % 1.5);
    src.stop(time + dur);
    return src;
  }

  /** A plucked-string tone by the Karplus-Strong algorithm, computed in JS once per pitch and length. */
  pluckBuffer(freq, dur, brightness) {
    const key = `${freq.toFixed(2)}:${dur.toFixed(2)}:${brightness}`;
    const cached = this.plucks.get(key);
    if (cached) return cached;
    const sr = this.ctx.sampleRate;
    const n = Math.ceil(sr * dur);
    const buf = this.ctx.createBuffer(1, n, sr);
    const out = buf.getChannelData(0);
    const period = sr / freq;
    const p = Math.floor(period);
    const frac = period - p;
    const ring = new Float32Array(p + 2);
    const r = rng(Math.round(freq * 100));
    for (let i = 0; i < ring.length; i++) ring[i] = r() * 2 - 1;
    // Soften the initial burst so higher notes are not harsh.
    for (let k = 0; k < 2; k++) for (let i = 1; i < ring.length; i++) ring[i] = ring[i] * brightness + ring[i - 1] * (1 - brightness);
    const decay = 0.996 + Math.min(0.0035, 0.5 / freq);
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const a = ring[idx];
      const b = ring[(idx + 1) % (p + 1)];
      const v = a * (1 - frac) + b * frac;
      out[i] = v;
      ring[idx] = ((a + b) / 2) * decay;
      idx = (idx + 1) % (p + 1);
    }
    this.plucks.set(key, buf);
    return buf;
  }
}

/** A gain node with an ADSR envelope, connected to out. Returns { node, end }: connect sources into node and stop them at end. */
function envelope(ctx, out, time, dur, { a = 0.01, d = 0.2, s = 0.6, r = 0.3, peak = 1 }) {
  const g = ctx.createGain();
  const p = g.gain;
  p.setValueAtTime(0, time);
  p.linearRampToValueAtTime(peak, time + a);
  p.setTargetAtTime(peak * s, time + a, d / 3);
  const off = Math.max(time + a, time + dur);
  p.setTargetAtTime(0, off, r / 4);
  g.connect(out);
  return { node: g, end: off + r * 1.5 };
}

function osc(ctx, type, freq, detune, dest, time, end) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.connect(dest);
  o.start(time);
  o.stop(end);
  return o;
}

/** @type {Record<string, Instrument>} */
export const instruments = {
  /** Warm detuned-saw pad with a slow attack. */
  pad(ctx, out, n) {
    const env = envelope(ctx, out, n.time, n.dur, { a: 0.8, d: 1.0, s: 0.8, r: 1.6, peak: 0.16 * n.vel });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, n.time);
    lp.frequency.linearRampToValueAtTime(1800, n.time + Math.min(2, n.dur));
    lp.Q.value = 0.6;
    lp.connect(env.node);
    for (const dt of [-9, 0, 9]) osc(ctx, 'sawtooth', n.freq, dt, lp, n.time, env.end);
    osc(ctx, 'sine', n.freq / 2, 0, env.node, n.time, env.end);
  },

  /** FM electric piano: a sine carrier with a decaying modulator. */
  keys(ctx, out, n) {
    const env = envelope(ctx, out, n.time, n.dur, { a: 0.004, d: 1.4, s: 0.25, r: 0.5, peak: 0.35 * n.vel });
    const car = ctx.createOscillator();
    car.frequency.value = n.freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = n.freq;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(n.freq * (1.2 + n.vel), n.time);
    idx.gain.setTargetAtTime(n.freq * 0.25, n.time, 0.25);
    mod.connect(idx).connect(car.frequency);
    // A short metallic "tine" at the attack.
    const tine = ctx.createOscillator();
    tine.frequency.value = n.freq * 14;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.04 * n.vel, n.time);
    tg.gain.setTargetAtTime(0, n.time, 0.03);
    tine.connect(tg).connect(env.node);
    car.connect(env.node);
    for (const o of [car, mod, tine]) { o.start(n.time); o.stop(env.end); }
  },

  /** Bell: inharmonic FM with a long decay. */
  bell(ctx, out, n) {
    const env = envelope(ctx, out, n.time, 0.01, { a: 0.002, d: 0.1, s: 1, r: 3.5, peak: 0.22 * n.vel });
    const car = ctx.createOscillator();
    car.frequency.value = n.freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = n.freq * 3.5;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(n.freq * 2.5, n.time);
    idx.gain.setTargetAtTime(n.freq * 0.2, n.time, 0.6);
    mod.connect(idx).connect(car.frequency);
    car.connect(env.node);
    for (const o of [car, mod]) { o.start(n.time); o.stop(env.end); }
  },

  /** Plucked string (Karplus-Strong). */
  pluck(ctx, out, n, kit) {
    const len = Math.min(4, n.dur + 1.2);
    const src = ctx.createBufferSource();
    src.buffer = kit.pluckBuffer(n.freq, len, 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * n.vel, n.time);
    g.gain.setTargetAtTime(0, n.time + n.dur, 0.15);
    src.connect(g).connect(out);
    src.start(n.time);
    src.stop(n.time + len);
  },

  /** Round bass: sine plus filtered saw. */
  bass(ctx, out, n) {
    const env = envelope(ctx, out, n.time, n.dur, { a: 0.008, d: 0.4, s: 0.7, r: 0.15, peak: 0.42 * n.vel });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, n.time);
    lp.frequency.setTargetAtTime(380, n.time, 0.12);
    lp.connect(env.node);
    osc(ctx, 'sine', n.freq, 0, env.node, n.time, env.end);
    const s = ctx.createGain();
    s.gain.value = 0.35;
    s.connect(lp);
    osc(ctx, 'sawtooth', n.freq, 0, s, n.time, env.end);
  },

  /** Soft lead: triangle plus a quiet square, with slight vibrato-free detune. */
  lead(ctx, out, n) {
    const env = envelope(ctx, out, n.time, n.dur, { a: 0.03, d: 0.3, s: 0.7, r: 0.3, peak: 0.2 * n.vel });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    lp.connect(env.node);
    osc(ctx, 'triangle', n.freq, 0, lp, n.time, env.end);
    const s = ctx.createGain();
    s.gain.value = 0.25;
    s.connect(lp);
    osc(ctx, 'square', n.freq, 6, s, n.time, env.end);
  },

  kick(ctx, out, n) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * n.vel, n.time);
    g.gain.exponentialRampToValueAtTime(0.001, n.time + 0.45);
    g.connect(out);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, n.time);
    o.frequency.exponentialRampToValueAtTime(45, n.time + 0.12);
    o.connect(g);
    o.start(n.time);
    o.stop(n.time + 0.5);
  },

  snare(ctx, out, n, kit) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35 * n.vel, n.time);
    g.gain.exponentialRampToValueAtTime(0.001, n.time + 0.22);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.7;
    kit.noiseSource(n.time, 0.25).connect(bp).connect(g).connect(out);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.25 * n.vel, n.time);
    tg.gain.exponentialRampToValueAtTime(0.001, n.time + 0.1);
    tg.connect(out);
    osc(ctx, 'triangle', 190, 0, tg, n.time, n.time + 0.12);
  },

  hat(ctx, out, n, kit) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12 * n.vel, n.time);
    g.gain.exponentialRampToValueAtTime(0.001, n.time + Math.max(0.04, Math.min(0.4, n.dur)));
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    kit.noiseSource(n.time, 0.45).connect(hp).connect(g).connect(out);
  },

  /** A dog's bark: a pitched, nasal burst with a noisy edge. freq sets the dog's size (≈ 300 small, 180 big). */
  bark(ctx, out, n, kit) {
    const len = Math.min(0.32, Math.max(0.12, n.dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, n.time);
    g.gain.exponentialRampToValueAtTime(Math.max(1e-4, 0.9 * n.vel), n.time + 0.012);
    g.gain.setTargetAtTime(0.0001, n.time + len * 0.45, len * 0.22);
    g.connect(out);
    // Formant filters give the "wuf" vowel.
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.setValueAtTime(700, n.time);
    f1.frequency.linearRampToValueAtTime(1100, n.time + len * 0.3);
    f1.frequency.linearRampToValueAtTime(600, n.time + len);
    f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1900;
    f2.Q.value = 5;
    const mix = ctx.createGain();
    mix.gain.value = 2.2;
    f1.connect(mix);
    f2.connect(mix);
    mix.connect(g);
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(n.freq * 0.9, n.time);
    src.frequency.linearRampToValueAtTime(n.freq * 1.35, n.time + len * 0.25);
    src.frequency.exponentialRampToValueAtTime(n.freq * 0.7, n.time + len);
    src.connect(f1);
    src.connect(f2);
    src.start(n.time);
    src.stop(n.time + len + 0.3);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, n.time);
    ng.gain.setTargetAtTime(0, n.time, 0.03);
    kit.noiseSource(n.time, len).connect(ng).connect(f1);
  },

  /** Cartoon "boing": a sine that bends up and wobbles. */
  boing(ctx, out, n) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35 * n.vel, n.time);
    g.gain.setTargetAtTime(0, n.time + 0.15, 0.12);
    g.connect(out);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(n.freq * 0.5, n.time);
    o.frequency.exponentialRampToValueAtTime(n.freq * 1.5, n.time + 0.25);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 18;
    const lg = ctx.createGain();
    lg.gain.value = n.freq * 0.08;
    lfo.connect(lg).connect(o.frequency);
    o.connect(g);
    for (const x of [o, lfo]) { x.start(n.time); x.stop(n.time + 0.7); }
  },

  /** A soft rising noise sweep, for transitions. */
  swell(ctx, out, n, kit) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, n.time);
    g.gain.exponentialRampToValueAtTime(Math.max(1e-4, 0.18 * n.vel), n.time + n.dur);
    g.gain.exponentialRampToValueAtTime(0.0001, n.time + n.dur + 0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, n.time);
    bp.frequency.exponentialRampToValueAtTime(6000, n.time + n.dur);
    kit.noiseSource(n.time, n.dur + 0.1).connect(bp).connect(g).connect(out);
  },
};

/** A stereo reverb impulse response: decaying seeded noise, darkened over time. */
export function reverbImpulse(ctx, seconds = 2.8, seed = 7) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(seed + ch * 101);
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const k = 0.2 + 0.75 * (t / seconds); // more low-pass as the tail goes on
      lp = lp * k + (r() * 2 - 1) * (1 - k);
      d[i] = lp * Math.exp((-6.9 * t) / seconds) * (t < 0.012 ? t / 0.012 : 1);
    }
  }
  return buf;
}
