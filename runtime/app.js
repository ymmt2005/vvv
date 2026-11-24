// @ts-check
// Player page logic. People get preview controls; the vvv CLI drives the
// same page headless through window.vvv.

import { buildTimeline, scenesAt } from './timeline.js';
import { Stage } from './stage.js';
import { loadFonts, text } from './text.js';
import { renderSoundtrack } from './audio/soundtrack.js';
import { expandMusic } from './audio/score.js';
import { encodeMovie } from './encode/encoder.js';

const headless = new URLSearchParams(location.search).has('headless');
if (headless) document.body.classList.add('headless');

const MOVIE = new URL('/movie/', location.href).href;

/** Fetch JSON. An optional file that the server reports as absent (204) gives null. */
async function fetchJson(url, optional = false) {
  const res = await fetch(url, { cache: 'no-store' });
  if (optional && res.status === 204) return null;
  if (!res.ok) throw new Error(`cannot load ${url}: ${res.status}`);
  return res.json();
}

async function load() {
  await loadFonts('/fonts/NotoSansJP-VF.ttf');
  const script = await fetchJson(`${MOVIE}script.json`);
  const voice = await fetchJson(`${MOVIE}voice/manifest.json`, true);
  const timeline = buildTimeline(script, voice);
  const musicSpec = await fetchJson(`${MOVIE}music.json`, true);
  const music = musicSpec ? expandMusic(musicSpec, timeline) : null;
  const movie = (await import(`${MOVIE}movie.js`)).default;
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('screen'));
  const stage = new Stage(canvas, timeline, movie, music, MOVIE);
  await stage.init();
  /** @type {Promise<AudioBuffer> | null} */
  let soundtrack = null;
  // Rendered once and shared; a failed render is forgotten so that the next call tries again.
  const getSoundtrack = () => (soundtrack ??= renderSoundtrack({ timeline, music, voiceBase: `${MOVIE}voice/` })
    .catch((e) => { soundtrack = null; throw e; }));
  return { script, timeline, movie, stage, canvas, getSoundtrack };
}

/** A grid of thumbnails at the given times, each labelled with its time and scene. */
function contactSheet(m, times, maxCols = 4, thumbW = 480) {
  const { stage, timeline, canvas } = m;
  const cols = Math.min(maxCols, times.length);
  const thumbH = Math.round((thumbW * timeline.height) / timeline.width);
  const labelH = 28;
  const rows = Math.ceil(times.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * thumbW;
  sheet.height = rows * (thumbH + labelH);
  const g = /** @type {CanvasRenderingContext2D} */ (sheet.getContext('2d'));
  g.fillStyle = '#222';
  g.fillRect(0, 0, sheet.width, sheet.height);
  times.forEach((t, i) => {
    stage.draw(t);
    const x = (i % cols) * thumbW;
    const y = Math.floor(i / cols) * (thumbH + labelH);
    g.drawImage(canvas, x, y + labelH, thumbW, thumbH);
    text(g, `${t.toFixed(2)}s  ${scenesAt(timeline, t).cur.id}`, { x: x + 8, y: y + 4, size: 18, color: '#ddd' });
  });
  return sheet.toDataURL('image/png');
}

async function postOutput(bytes) {
  const res = await fetch('/__output', { method: 'POST', body: bytes });
  if (!res.ok) throw new Error(`saving the output failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const m = await load();
  const { timeline, stage } = m;
  // A draw error must not stop the page from loading: vvv validate and check report it, and the preview shows it.
  try { stage.draw(0); } catch { /* reported later */ }

  // @ts-ignore
  window.vvv = {
    info: () => ({
      width: timeline.width, height: timeline.height, fps: timeline.fps, duration: timeline.duration, frames: timeline.frames,
      scenes: timeline.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end, lines: s.lines.map((l) => ({ id: l.id, start: l.start, end: l.end, text: l.text })) })),
      warnings: stage.allWarnings(),
    }),
    still: (t) => { stage.draw(t); return m.canvas.toDataURL('image/png'); },
    sheet: (times, cols, thumbW) => contactSheet(m, times, cols, thumbW),
    warnings: () => stage.allWarnings(),
    /**
     * What movie.js defines, for vvv validate, plus the errors from drawing a few frames of each scene:
     * its first frame, its middle and its last frame. draw: false skips the drawing, for check, which draws every frame.
     */
    inspect: ({ draw = true } = {}) => {
      const def = m.movie ?? {};
      const kind = (v) => (v === undefined ? 'missing' : typeof v);
      const scenes = Object.fromEntries(Object.entries(def.scenes ?? {}).map(([id, sc]) => [id, {
        keys: Object.keys(sc ?? {}), draw: kind(sc?.draw), setup: kind(sc?.setup),
      }]));
      const errors = [];
      // A scene whose draw is not a function is reported from its definition above.
      const drawable = (sc) => { const d = stage.def(sc); return !d || typeof d.draw === 'function'; };
      for (const sc of draw ? timeline.scenes.filter(drawable) : []) {
        const last = Math.max(sc.start, sc.end - 1 / timeline.fps);
        for (const T of [sc.start, (sc.start + sc.end) / 2, last]) {
          // Draw this scene alone, not through a transition, so an error is blamed on the scene that threw.
          try {
            stage.drawScene(stage.g, sc, T);
          } catch (e) {
            errors.push({ scene: sc.id, time: T, message: String(e?.message ?? e) });
            break;
          }
        }
      }
      return {
        keys: Object.keys(def), scenesType: kind(def.scenes), scenes,
        captionStyle: def.captionStyle && typeof def.captionStyle === 'object' ? Object.keys(def.captionStyle) : null,
        errors, warnings: stage.allWarnings(),
      };
    },
    /** Draw every frame without encoding; report the frames that throw. */
    check: () => {
      const errors = [];
      let lastFailed = -2;
      for (let i = 0; i < timeline.frames; i++) {
        const t = i / timeline.fps;
        try {
          stage.draw(t);
        } catch (e) {
          const message = String(e?.message ?? e);
          const last = errors[errors.length - 1];
          // Report a run of frames that fail the same way once, with its first and last time.
          if (last && last.message === message && lastFailed === i - 1) last.to = t;
          else errors.push({ from: t, to: t, frame: i, message, stack: String(e?.stack ?? '') });
          lastFailed = i;
        }
      }
      return { frames: timeline.frames, errors, warnings: stage.allWarnings() };
    },
    render: async (opts = {}) => {
      const audio = await m.getSoundtrack();
      let lastPct = -1;
      const mp4 = await encodeMovie({
        canvas: m.canvas, draw: (t) => stage.draw(t), width: timeline.width, height: timeline.height, fps: timeline.fps,
        frames: timeline.frames, audio, chapters: timeline.chapters, bitrate: opts.bitrate,
        onProgress: (done, total) => {
          const pct = Math.floor((done / total) * 100);
          if (pct % 10 === 0 && pct !== lastPct) { lastPct = pct; console.log(`vvv:progress ${pct}% (${done}/${total} frames)`); }
        },
      });
      await postOutput(mp4);
      return { bytes: mp4.length, duration: timeline.frames / timeline.fps, chapters: timeline.chapters, warnings: stage.allWarnings() };
    },
    /** The rendered soundtrack as an AudioBuffer, for tests that run in the page. */
    soundtrack: () => m.getSoundtrack(),
  };
  // @ts-ignore
  window.vvvReady = true;
  if (!headless) setupControls(m);
}

function setupControls(m) {
  const { timeline, stage } = m;
  const play = /** @type {HTMLButtonElement} */ (document.getElementById('play'));
  const seek = /** @type {HTMLInputElement} */ (document.getElementById('seek'));
  const time = /** @type {HTMLElement} */ (document.getElementById('time'));
  const warn = /** @type {HTMLElement} */ (document.getElementById('warnings'));
  const scenes = /** @type {HTMLElement} */ (document.getElementById('scenes'));
  const chapters = /** @type {HTMLElement} */ (document.getElementById('chapters'));
  /** @type {HTMLButtonElement[]} */
  const chapterButtons = [];
  let pos = 0;
  /** @type {{ ctx: AudioContext, src: AudioBufferSourceNode, t0: number } | null} */
  let playing = null;
  // True while the first Play waits for the soundtrack, so a second click does not start a second copy.
  let starting = false;
  const show = (t) => {
    pos = Math.max(0, Math.min(timeline.duration, t));
    let drawError = '';
    try {
      stage.draw(pos);
    } catch (e) {
      drawError = `Error drawing ${pos.toFixed(2)} s: ${e?.message ?? e}`;
    }
    seek.value = String(Math.round((pos / timeline.duration) * 1000));
    time.textContent = `${pos.toFixed(2)} / ${timeline.duration.toFixed(2)}`;
    warn.textContent = [drawError, ...stage.allWarnings()].filter(Boolean).join('\n');
    const current = timeline.chapters.findLastIndex((c) => pos >= c.start);
    chapterButtons.forEach((btn, i) => btn.classList.toggle('current', i === current));
  };
  const stop = () => {
    if (!playing) return;
    playing.src.stop();
    playing.ctx.close();
    playing = null;
    play.textContent = '▶ Play';
  };
  const start = async () => {
    if (starting || playing) return;
    starting = true;
    play.textContent = '… rendering audio';
    let buf;
    try {
      buf = await m.getSoundtrack();
    } catch (e) {
      play.textContent = '▶ Play';
      warn.textContent = `The soundtrack failed to render: ${e?.message ?? e}`;
      return;
    } finally {
      starting = false;
    }
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const from = pos >= timeline.duration - 0.05 ? 0 : pos;
    src.start(0, from);
    playing = { ctx, src, t0: ctx.currentTime - from };
    play.textContent = '❚❚ Pause';
    const tick = () => {
      if (!playing) return;
      const t = playing.ctx.currentTime - playing.t0;
      if (t >= timeline.duration) { stop(); show(timeline.duration); return; }
      show(t);
      requestAnimationFrame(tick);
    };
    tick();
  };
  play.onclick = () => (playing ? stop() : start());
  const jumpTo = (t) => { const was = !!playing; stop(); show(t); if (was) start(); };
  // Seeking during the first soundtrack render just moves the start position.
  seek.oninput = () => jumpTo((Number(seek.value) / 1000) * timeline.duration);
  for (const c of timeline.chapters) {
    const b = document.createElement('button');
    b.textContent = `${c.title} (${c.start.toFixed(1)}s)`;
    b.onclick = () => jumpTo(c.start);
    chapters.append(b);
    chapterButtons.push(b);
  }
  for (const s of timeline.scenes) {
    const b = document.createElement('button');
    b.textContent = `${s.id} (${s.start.toFixed(1)}s)`;
    b.onclick = () => jumpTo(s.start);
    scenes.append(b);
  }
  show(0);
}

main().catch((e) => {
  console.error(`vvv:error ${e?.stack ?? e}`);
  // @ts-ignore
  window.vvvError = String(e?.stack ?? e);
  const w = document.getElementById('warnings');
  if (w) { w.style.color = '#ff7b7b'; w.textContent = String(e?.stack ?? e); }
});
