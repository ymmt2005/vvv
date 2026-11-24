// @ts-check
// Chapter files in a movie's out/ directory: WebVTT for web players, and timestamps in the
// form a YouTube description takes. The MP4 itself carries the chapters too.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @typedef {import('../runtime/timeline.js').Chapter} Chapter */

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 83.4 → "00:01:23.400" */
function vttTime(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

/**
 * A WebVTT file with one cue per chapter, for a <track kind="chapters"> element.
 * @param {Chapter[]} chapters
 */
export function chaptersVtt(chapters) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cues = chapters.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${esc(c.title)}\n`);
  return `WEBVTT\n\n${cues.join('\n')}`;
}

/** 83.4 → "1:23", 3723 → "1:02:03". Rounded down, so a chapter never starts after its scene. */
function youTubeTime(seconds) {
  const s = Math.floor(seconds + 1e-6);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/**
 * One "0:00 Title" line per chapter, to paste into a YouTube description.
 * @param {Chapter[]} chapters
 */
export function chaptersText(chapters) {
  return chapters.map((c) => `${youTubeTime(c.start)} ${c.title}\n`).join('');
}

/**
 * Whether YouTube would show these chapters: it needs at least three, each at least 10 seconds long.
 * YouTube sees the whole-second starts that chaptersText writes, so the lengths are measured between those.
 * @param {Chapter[]} chapters
 */
export function youTubeAccepts(chapters) {
  const starts = chapters.map((c) => Math.floor(c.start + 1e-6));
  return chapters.length >= 3 && chapters.every((c, i) => (starts[i + 1] ?? c.end) - starts[i] >= 10);
}

/**
 * Write chapters.vtt and chapters.txt into dir, or remove them when the movie has no chapters.
 * The names do not contain the movie's name on purpose: players such as VLC load a .vtt or .txt
 * file whose name contains the video's name as subtitles. So dir must be the movie's own out/ directory.
 * @param {string} dir
 * @param {Chapter[]} chapters
 * @param {(s: string) => void} log
 */
export async function writeChapterFiles(dir, chapters, log) {
  const vtt = join(dir, 'chapters.vtt');
  const txt = join(dir, 'chapters.txt');
  if (!chapters.length) {
    await Promise.all([rm(vtt, { force: true }), rm(txt, { force: true })]);
    return;
  }
  await mkdir(dir, { recursive: true });
  await writeFile(vtt, chaptersVtt(chapters));
  await writeFile(txt, chaptersText(chapters));
  log(`wrote ${chapters.length} chapter(s) into the MP4, ${vtt} and ${txt}`);
  if (!youTubeAccepts(chapters)) log('note: YouTube shows chapters only when there are at least 3, each 10 s or longer');
}
