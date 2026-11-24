// @ts-check
// Easing curves and small animation helpers. Every function here is pure,
// so a frame depends only on the time passed in.

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, p) => a + (b - a) * p;

/** Progress of t through [a, b], clamped to 0..1. */
export const seg = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));

export const linear = (p) => p;
export const inQuad = (p) => p * p;
export const outQuad = (p) => 1 - (1 - p) * (1 - p);
export const inOutQuad = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
export const inCubic = (p) => p ** 3;
export const outCubic = (p) => 1 - (1 - p) ** 3;
export const inOutCubic = (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2);
export const outQuart = (p) => 1 - (1 - p) ** 4;
export const outExpo = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
export const inOutExpo = (p) =>
  p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2;
export const outBack = (p, s = 1.70158) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2;
export const outElastic = (p) =>
  p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
export const sine = (p) => -(Math.cos(Math.PI * p) - 1) / 2;

/** Damped spring from 0 to 1; t in seconds. */
export const spring = (t, { freq = 2.2, damping = 0.55 } = {}) => {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * freq;
  return 1 - Math.exp(-damping * w * t) * Math.cos(w * Math.sqrt(1 - damping * damping) * t);
};

/**
 * Animate between a and b while t moves through [t0, t1].
 * @param {number} t @param {number} t0 @param {number} t1
 * @param {number} a @param {number} b @param {(p: number) => number} [curve]
 */
export const tween = (t, t0, t1, a, b, curve = inOutCubic) => lerp(a, b, curve(seg(t, t0, t1)));

/** Opacity that fades in over [t0, t0+fin] and out over [t1-fout, t1]. */
export const fadeInOut = (t, t0, t1, fin = 0.4, fout = 0.4) =>
  Math.min(outCubic(seg(t, t0, t0 + fin)), 1 - inCubic(seg(t, t1 - fout, t1)));

/** Deterministic random numbers (mulberry32). Use this, never Math.random. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
