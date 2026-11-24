// @ts-check
// Stage: draws the frame at global time T onto one 2D canvas.
// It runs each scene's draw function with that scene's local time, crossfades
// scene transitions, and draws captions and the credits card on top.

import { captionAt, scenesAt } from './timeline.js';
import { text, textWarnings } from './text.js';
import { clamp, outCubic, seg } from './ease.js';

/**
 * @typedef {import('./timeline.js').Timeline} Timeline
 * @typedef {import('./timeline.js').TimedScene} TimedScene
 * @typedef {{ id: string, start: number, end: number, active: boolean, p: number, text: string, lang: string, who: string | null }} LocalLine
 * @typedef {{ t: number, d: number, p: number, T: number, w: number, h: number, scene: TimedScene,
 *   lines: LocalLine[], line: (key: string | number) => LocalLine, timeline: Timeline, state: any }} DrawInfo
 * @typedef {{ setup?: (s: SetupInfo) => any, draw: (g: CanvasRenderingContext2D, s: DrawInfo) => void }} SceneDef
 * @typedef {{ scene: TimedScene, timeline: Timeline, w: number, h: number, three: (opts?: object) => Promise<any>,
 *   image: (url: string) => Promise<HTMLImageElement> }} SetupInfo
 * @typedef {{ background?: string, scenes: Record<string, SceneDef>, captionStyle?: object, music?: Function }} MovieDef
 */

/**
 * Declare a movie in movie.js. It returns its argument unchanged; it exists so that editors type-check the definition.
 * @param {MovieDef} def
 * @returns {MovieDef}
 */
export function defineMovie(def) {
  return def;
}

const DEFAULT_CAPTION = { size: 44, weight: 500, color: '#ffffff', box: 'rgba(8, 10, 20, 0.62)', bottom: 72, width: 0.78, maxLines: 2 };

/** Draws any moment of a movie onto its canvas: scenes, transitions, captions and the credits card. */
export class Stage {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Timeline} timeline
   * @param {MovieDef} movie
   * @param {string} movieBase URL of the movie directory, ending in "/"
   */
  constructor(canvas, timeline, movie, movieBase) {
    this.canvas = canvas;
    this.timeline = timeline;
    this.movie = movie;
    this.movieBase = movieBase;
    canvas.width = timeline.width;
    canvas.height = timeline.height;
    this.g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { alpha: false }));
    this.layer = document.createElement('canvas');
    this.layer.width = timeline.width;
    this.layer.height = timeline.height;
    this.lg = /** @type {CanvasRenderingContext2D} */ (this.layer.getContext('2d', { alpha: false }));
    /** @type {Map<string, any>} */
    this.state = new Map();
    this.threeRenderer = null;
    this.warnings = [];
  }

  async init() {
    for (const scene of this.timeline.scenes) {
      const def = this.def(scene);
      if (!def) {
        this.warnings.push(`scene "${scene.id}" has no draw function in movie.js; it shows a placeholder`);
        continue;
      }
      if (def.setup) {
        const info = {
          scene, timeline: this.timeline, w: this.timeline.width, h: this.timeline.height,
          three: (opts) => this.makeThree(opts),
          image: (url) => loadImage(new URL(url, this.movieBase).href),
        };
        this.state.set(scene.id, await def.setup(info));
      }
    }
  }

  /** @returns {SceneDef | undefined} */
  def(scene) {
    const scenes = this.movie.scenes ?? {};
    // Own keys only, so a scene id such as "constructor" is not found on Object.prototype.
    if (Object.hasOwn(scenes, scene.id)) return scenes[scene.id];
    if (scene.id === 'credits') return { draw: (g, s) => drawCredits(g, s, this.timeline.credits, this.movie.background ?? '#0b0f1a') };
    return undefined;
  }

  async makeThree(opts = {}) {
    // Loaded on first use, so movies without 3D never load three.js.
    const { createThreeLayer, makeRenderer } = await import('./three-layer.js');
    this.threeRenderer ??= makeRenderer(this.timeline.width, this.timeline.height);
    return createThreeLayer(this.threeRenderer, this.timeline.width, this.timeline.height, opts);
  }

  /** Draw global time T. */
  draw(T) {
    const { cur, prev, mix } = scenesAt(this.timeline, T);
    if (prev) {
      this.drawScene(this.g, prev, T);
      this.drawScene(this.lg, cur, T);
      this.g.save();
      this.g.globalAlpha = outCubic(clamp(mix));
      this.g.drawImage(this.layer, 0, 0);
      this.g.restore();
    } else {
      this.drawScene(this.g, cur, T);
    }
    if (this.timeline.captions) this.drawCaption(T);
  }

  drawScene(g, scene, T) {
    const { width: w, height: h } = this.timeline;
    g.save();
    g.fillStyle = this.movie.background ?? '#0b0f1a';
    g.fillRect(0, 0, w, h);
    const t = T - scene.start;
    const lines = scene.lines.map((l) => {
      const start = l.start - scene.start;
      const end = l.end - scene.start;
      return { id: l.id, start, end, active: t >= start && t < end, p: seg(t, start, end), text: l.text, lang: l.lang, who: l.who };
    });
    const byId = new Map(scene.lines.map((l, i) => [l.id, lines[i]]));
    /** @type {DrawInfo} */
    const info = {
      t, d: scene.duration, p: clamp(t / scene.duration), T, w, h, scene, lines, timeline: this.timeline,
      line: (key) => {
        const l = typeof key === 'number' ? lines[key] : byId.get(key);
        if (!l) throw new Error(`scene "${scene.id}" has no line "${key}"`);
        return l;
      },
      state: this.state.get(scene.id),
    };
    const def = this.def(scene);
    if (def) {
      def.draw(g, info);
    } else {
      text(g, `[${scene.id}]`, { x: w / 2, y: h / 2, size: 64, align: 'center', baseline: 'middle', color: '#888' });
    }
    g.restore();
  }

  drawCaption(T) {
    const c = captionAt(this.timeline, T);
    if (!c) return;
    const { line, alpha } = c;
    const st = { ...DEFAULT_CAPTION, ...this.movie.captionStyle };
    const { width: w, height: h } = this.timeline;
    const g = this.g;
    const boxW = w * st.width;
    const m = text(g, line.caption, { x: w / 2, y: 0, width: boxW - st.size, size: st.size, weight: st.weight, align: 'center', maxLines: st.maxLines, measureOnly: true });
    const padY = st.size * 0.45;
    const bh = m.height + padY * 2;
    const bw = Math.min(boxW, m.width + st.size * 1.6);
    const y = h - st.bottom - bh;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = st.box;
    g.beginPath();
    g.roundRect(w / 2 - bw / 2, y, bw, bh, st.size * 0.35);
    g.fill();
    text(g, line.caption, { x: w / 2, y: y + padY, width: boxW - st.size, size: st.size, weight: st.weight, color: st.color, align: 'center', maxLines: st.maxLines });
    g.restore();
  }

  allWarnings() {
    return [...this.timeline.warnings, ...this.warnings, ...textWarnings];
  }
}

/** The automatic credits card: the credit lines centred on the movie's background, in a colour that contrasts with it. */
function drawCredits(g, s, credits, background) {
  const a = Math.min(outCubic(seg(s.t, 0, 0.6)), 1 - seg(s.t, s.d - 0.5, s.d));
  g.fillStyle = background;
  g.fillRect(0, 0, s.w, s.h);
  g.globalAlpha = a;
  const size = Math.round(s.h * 0.04);
  const gap = size * 1.8;
  const top = s.h / 2 - ((credits.length - 1) * gap) / 2;
  const color = isLight(background) ? '#2a2a33' : '#e6e8ef';
  credits.forEach((c, i) => text(g, c, { x: s.w / 2, y: top + i * gap, size, weight: 400, align: 'center', baseline: 'middle', color }));
  g.globalAlpha = 1;
}

/** Whether a CSS colour is light, judged by its luminance; colours the canvas cannot parse count as dark. */
function isLight(css) {
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return false;
  c.fillStyle = '#000';
  c.fillStyle = css;
  c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load image ${src}`));
    img.src = src;
  });
}
