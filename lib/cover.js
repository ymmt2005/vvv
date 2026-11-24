// @ts-check
// The cover page: out/index.html, a self-contained page that plays the rendered movie from disk.
// It shows the title, the player with its controls, the chapters and the credits, in the movie's language.
// Its style and script are cover-page.css and cover-page.js, which it inlines.

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { timeOf } from '../runtime/timeline.js';
import { clock } from './chapters.js';

/**
 * @typedef {import('../runtime/timeline.js').Timeline} Timeline
 * @typedef {import('../runtime/timeline.js').Script} Script
 */

const STYLE = readFileSync(new URL('./cover-page.css', import.meta.url), 'utf8');
const SCRIPT = readFileSync(new URL('./cover-page.js', import.meta.url), 'utf8');
const POSTER = 'poster.jpg';

/** The interface text in each language that a movie can be in. */
const TEXT = {
  en: {
    htmlLang: 'en', play: 'Play', pause: 'Pause', mute: 'Mute', unmute: 'Unmute', volume: 'Volume', speed: 'Speed', seek: 'Position',
    fullPage: 'Full page', exitFullPage: 'Exit full page', fullScreen: 'Full screen', exitFullScreen: 'Exit full screen',
    chapters: 'Chapters', credits: 'Credits',
  },
  ja: {
    htmlLang: 'ja', play: '再生', pause: '一時停止', mute: 'ミュート', unmute: 'ミュート解除', volume: '音量', speed: '再生速度', seek: '再生位置',
    fullPage: 'ページ全体に表示', exitFullPage: 'ページ全体表示を終了', fullScreen: '全画面表示', exitFullScreen: '全画面表示を終了',
    chapters: 'チャプター', credits: 'クレジット',
  },
  zh: {
    htmlLang: 'zh-CN', play: '播放', pause: '暂停', mute: '静音', unmute: '取消静音', volume: '音量', speed: '播放速度', seek: '播放进度',
    fullPage: '网页全屏', exitFullPage: '退出网页全屏', fullScreen: '全屏', exitFullScreen: '退出全屏',
    chapters: '章节', credits: '制作人员',
  },
  es: {
    htmlLang: 'es', play: 'Reproducir', pause: 'Pausa', mute: 'Silenciar', unmute: 'Activar sonido', volume: 'Volumen', speed: 'Velocidad', seek: 'Posición',
    fullPage: 'Página completa', exitFullPage: 'Salir de página completa', fullScreen: 'Pantalla completa', exitFullScreen: 'Salir de pantalla completa',
    chapters: 'Capítulos', credits: 'Créditos',
  },
  fr: {
    htmlLang: 'fr', play: 'Lecture', pause: 'Pause', mute: 'Couper le son', unmute: 'Activer le son', volume: 'Volume', speed: 'Vitesse', seek: 'Position',
    fullPage: 'Pleine page', exitFullPage: 'Quitter la pleine page', fullScreen: 'Plein écran', exitFullScreen: 'Quitter le plein écran',
    chapters: 'Chapitres', credits: 'Crédits',
  },
  pt: {
    htmlLang: 'pt-BR', play: 'Reproduzir', pause: 'Pausar', mute: 'Silenciar', unmute: 'Ativar som', volume: 'Volume', speed: 'Velocidade', seek: 'Posição',
    fullPage: 'Página inteira', exitFullPage: 'Sair da página inteira', fullScreen: 'Tela cheia', exitFullScreen: 'Sair da tela cheia',
    chapters: 'Capítulos', credits: 'Créditos',
  },
};

/** The languages the cover page has text for; the schema's languages must all be here. */
export const COVER_LANGUAGES = Object.keys(TEXT);

/**
 * The cover page's language: script.json's lang, or else the language of most narration lines, or else English.
 * @param {Script} script
 * @param {Timeline} timeline
 */
export function coverLang(script, timeline) {
  if (script.lang) return script.lang;
  const counts = new Map();
  for (const l of timeline.lines) counts.set(l.lang, (counts.get(l.lang) ?? 0) + 1);
  let best = 'en';
  let most = 0;
  for (const [lang, n] of counts) if (n > most) { best = lang; most = n; }
  return best;
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The cover page's HTML.
 * @param {{ title: string, description?: string, lang: string, video: string, poster: string,
 *   width: number, height: number, duration: number, chapters: { title: string, start: number }[], credits: string[] }} o
 *   video and poster are URLs relative to the page.
 */
export function coverHtml(o) {
  const t = TEXT[/** @type {keyof typeof TEXT} */ (o.lang)] ?? TEXT.en;
  const e = (key) => escapeHtml(t[key]);
  // JSON inside a script element must not contain "</script" or "<!--".
  const data = JSON.stringify({ duration: o.duration, chapters: o.chapters.map((c) => ({ title: c.title, start: c.start })), text: t }).replace(/</g, '\\u003c');
  const chapters = o.chapters.length ? `
  <section class="chapters" aria-labelledby="chapters-title">
    <h2 id="chapters-title">${e('chapters')}</h2>
    <ol id="chapters">${o.chapters.map((c) => `
      <li><button type="button"><span class="at">${clock(c.start)}</span><span class="name">${escapeHtml(c.title)}</span></button></li>`).join('')}
    </ol>
  </section>
` : '';
  const credits = o.credits.length ? `
  <footer>
    <p class="credits"><span class="label">${e('credits')}</span>${o.credits.map((c) => `<span class="item">${escapeHtml(c)}</span>`).join('')}</p>
  </footer>
` : '';
  const marks = o.chapters.slice(1).map((c) => `<i style="left: ${((c.start / o.duration) * 100).toFixed(3)}%"></i>`).join('');
  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)}</title>
${o.description ? `<meta name="description" content="${escapeHtml(o.description)}">\n` : ''}<style>
${STYLE}</style>
</head>
<body>
<main>
  <header>
    <h1>${escapeHtml(o.title)}</h1>
    ${o.description ? `<p class="description">${escapeHtml(o.description)}</p>\n    ` : ''}<p class="meta">${clock(o.duration)}</p>
  </header>

  <div class="player" id="player" style="--w: ${o.width}; --h: ${o.height}">
    <video id="video" src="${escapeHtml(o.video)}" poster="${escapeHtml(o.poster)}" preload="metadata" playsinline></video>
    <button type="button" class="big-play" id="big-play" aria-label="${e('play')}">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>
    </button>
    <div class="controls">
      <button type="button" id="play" title="${e('play')} (k)" aria-label="${e('play')}">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path class="i-play" d="M7 4.5v15l13-7.5z"/><path class="i-pause" d="M6 4h4v16H6zM14 4h4v16h-4z" hidden/></svg>
      </button>
      <span class="time"><span id="now">0:00</span> / ${clock(o.duration)}</span>
      <div class="seek">
        <input type="range" id="seek" min="0" max="${o.duration}" step="any" value="0" aria-label="${e('seek')}">
        <div class="marks" aria-hidden="true">${marks}</div>
      </div>
      <span class="now-chapter" id="now-chapter"></span>
      <button type="button" id="mute" title="${e('mute')} (m)" aria-label="${e('mute')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path class="i-sound" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/><path class="i-muted" d="m16 9 6 6m0-6-6 6" hidden/>
        </svg>
      </button>
      <input type="range" id="volume" min="0" max="1" step="0.05" value="1" aria-label="${e('volume')}">
      <select id="speed" aria-label="${e('speed')}" title="${e('speed')}">
        ${[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => `<option value="${r}"${r === 1 ? ' selected' : ''}>${r}×</option>`).join('')}
      </select>
      <button type="button" id="full-page" title="${e('fullPage')} (p)" aria-label="${e('fullPage')}" aria-pressed="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10v6H7z" fill="currentColor" stroke="none"/></svg>
      </button>
      <button type="button" id="full-screen" title="${e('fullScreen')} (f)" aria-label="${e('fullScreen')}" aria-pressed="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path class="i-enter" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path class="i-exit" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" hidden/>
        </svg>
      </button>
    </div>
  </div>
${chapters}${credits}</main>
<script type="application/json" id="cover-data">${data}</script>
<script>
(() => {
const clock = ${clock.toString()};
${SCRIPT}})();
</script>
</body>
</html>
`;
}

/**
 * The time of the poster frame: script.json's poster, or else the middle of the first scene, kept inside the movie.
 * vvv validate warns about a poster outside the movie, and reports one that names no scene or line.
 * @param {Script} script
 * @param {Timeline} timeline
 */
export function posterTime(script, timeline) {
  const r = script.poster === undefined ? null : timeOf(timeline, script.poster);
  const first = timeline.scenes[0];
  const t = r && 'time' in r ? r.time : (first.start + first.end) / 2;
  return Math.min(Math.max(0, t), timeline.duration - 1 / timeline.fps);
}

/**
 * Write out/index.html and out/poster.jpg, the cover page that plays the movie from disk.
 * @param {{ outDir: string, mp4: string, movieDir: string, script: Script, timeline: Timeline, duration: number,
 *   poster: Buffer, log: (s: string) => void }} o
 */
export async function writeCover(o) {
  await mkdir(o.outDir, { recursive: true });
  await writeFile(join(o.outDir, POSTER), o.poster);
  const video = relative(o.outDir, o.mp4).split(sep).map(encodeURIComponent).join('/');
  const html = coverHtml({
    title: o.script.title ?? basename(o.movieDir), description: o.script.description, lang: coverLang(o.script, o.timeline),
    video, poster: POSTER, width: o.timeline.width, height: o.timeline.height, duration: o.duration,
    chapters: o.timeline.chapters, credits: o.timeline.credits,
  });
  const page = join(o.outDir, 'index.html');
  await writeFile(page, html);
  o.log(`wrote ${page}: open it in a browser to watch the movie`);
}
