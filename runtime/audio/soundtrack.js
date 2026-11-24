// @ts-check
// Soundtrack: renders music, sound effects and narration into one AudioBuffer
// with an OfflineAudioContext. Preview and the final video both play this
// buffer, so what you hear in preview is what gets encoded.

import { Kit, instruments, reverbImpulse } from './instruments.js';
import { beatsToSeconds, freq } from './music.js';

export const SAMPLE_RATE = 48000;

/**
 * Render the whole soundtrack (narration clips, music and effects, mixed and limited) at 48 kHz stereo.
 * @param {{ timeline: import('../timeline.js').Timeline, music: import('./score.js').Music | null, voiceBase: string }} o
 * @returns {Promise<AudioBuffer>}
 */
export async function renderSoundtrack({ timeline, music, voiceBase }) {
  const length = Math.max(1, Math.ceil(timeline.duration * SAMPLE_RATE));
  // The compressor delays its output by a look-ahead; render that much more and trim it from the start.
  const latency = await compressorLatency();
  const ctx = new OfflineAudioContext(2, length + latency, SAMPLE_RATE);

  const master = ctx.createGain();
  const comp = masterCompressor(ctx);
  master.connect(comp).connect(ctx.destination);

  // Narration.
  const voiceBus = ctx.createGain();
  voiceBus.connect(master);
  const spoken = timeline.lines.filter((l) => l.file);
  await Promise.all(spoken.map(async (l) => {
    const res = await fetch(new URL(/** @type {string} */ (l.file), voiceBase));
    if (!res.ok) throw new Error(`cannot load voice clip ${l.file}: ${res.status}`);
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // The voice step generated this clip faster or slower by the same factor, so its length is unchanged.
    src.playbackRate.value = l.rate;
    src.connect(voiceBus);
    src.start(l.start);
  }));

  if (music && music.tracks.length) {
    const musicBus = ctx.createGain();
    musicBus.gain.value = music.gain;
    const duck = ctx.createGain();
    musicBus.connect(duck).connect(master);
    automateDuck(duck.gain, timeline.lines.map((l) => [l.start, l.end]), music.duck);
    musicBus.gain.setValueAtTime(music.gain, Math.max(0, timeline.duration - music.fadeOut));
    musicBus.gain.linearRampToValueAtTime(0, timeline.duration);

    const reverb = ctx.createConvolver();
    reverb.buffer = reverbImpulse(ctx);
    reverb.connect(musicBus);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = beatsToSeconds(0.75, music.bpm);
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter();
    dlp.frequency.value = 3000;
    delay.connect(dlp).connect(fb).connect(delay);
    delay.connect(musicBus);

    const kit = new Kit(ctx);
    for (const tr of music.tracks) {
      if (!Object.hasOwn(instruments, tr.inst)) throw new Error(`unknown instrument "${tr.inst}"; known: ${Object.keys(instruments).join(', ')}`);
      const inst = instruments[tr.inst];
      const g = ctx.createGain();
      g.gain.value = tr.gain;
      const pan = ctx.createStereoPanner();
      pan.pan.value = tr.pan;
      g.connect(pan).connect(musicBus);
      if (tr.reverb) { const s = ctx.createGain(); s.gain.value = tr.reverb; pan.connect(s).connect(reverb); }
      if (tr.delay) { const s = ctx.createGain(); s.gain.value = tr.delay; pan.connect(s).connect(delay); }
      for (const n of tr.notes) {
        // A silent note would only make exponential ramps aim at zero, which Web Audio refuses.
        if (n.time >= timeline.duration || !(n.vel > 0)) continue;
        for (const p of n.pitch) inst(ctx, g, { time: n.time, dur: n.len, freq: freq(p), vel: n.vel }, kit);
      }
    }
  }

  const rendered = await ctx.startRendering();
  const out = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: SAMPLE_RATE });
  for (let c = 0; c < 2; c++) out.copyToChannel(rendered.getChannelData(c).subarray(latency, latency + length), c);
  limitPeak(out, 0.95);
  return out;
}

function masterCompressor(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  return comp;
}

/** @type {Promise<number> | null} */
let latencyPromise = null;

/** The compressor's look-ahead in samples, measured once by passing a quiet impulse through it. */
function compressorLatency() {
  latencyPromise ??= (async () => {
    const ctx = new OfflineAudioContext(1, 4096, SAMPLE_RATE);
    const imp = ctx.createBuffer(1, 1, SAMPLE_RATE);
    imp.getChannelData(0)[0] = 0.01;
    const src = ctx.createBufferSource();
    src.buffer = imp;
    src.connect(masterCompressor(ctx)).connect(ctx.destination);
    src.start(0);
    const d = (await ctx.startRendering()).getChannelData(0);
    const i = d.findIndex((x) => Math.abs(x) > 1e-4);
    return i < 0 ? 0 : i;
  })();
  return latencyPromise;
}

// A dip starts DUCK_BEFORE seconds before speech and recovers by DUCK_AFTER seconds after it.
const DUCK_BEFORE = 0.3;
const DUCK_AFTER = 0.7;

/**
 * Lower the music while anyone speaks. Intervals too close for the music to recover in
 * between merge into one dip, so one dip's events never land inside the previous one's ramp.
 * @param {{ setValueAtTime: Function, linearRampToValueAtTime: Function }} param
 * @param {[number, number][]} intervals
 * @param {number} level
 */
export function automateDuck(param, intervals, level) {
  const merged = [];
  for (const [s, e] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && s - last[1] < DUCK_BEFORE + DUCK_AFTER) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  param.setValueAtTime(1, 0);
  for (const [s, e] of merged) {
    param.setValueAtTime(1, Math.max(0, s - DUCK_BEFORE));
    param.linearRampToValueAtTime(level, Math.max(0, s - 0.05));
    param.setValueAtTime(level, e + 0.1);
    param.linearRampToValueAtTime(1, e + DUCK_AFTER);
  }
}

function limitPeak(buf, ceiling) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak <= ceiling) return;
  const k = ceiling / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}
