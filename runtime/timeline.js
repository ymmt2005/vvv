// @ts-check
// Timeline: turns a storyboard (script.json) and the voice manifest into
// absolute start and end times for every scene and narration line.
// Pure code with no browser or Node APIs, so both sides import it.

/**
 * @typedef {{ id: string, lang: string, text: string, speech?: string, caption?: string | false, who?: string,
 *             voice?: { pitch?: number, speed?: number } }} ScriptLine
 * @typedef {{ id: string, duration?: number, transition?: number, lead?: number, gap?: number, tail?: number, lines?: ScriptLine[] }} ScriptScene
 * @typedef {{ lead: number, gap: number, tail: number }} Timing
 * @typedef {{ size?: [number, number], fps?: number, captions?: boolean, timing?: Partial<Timing>,
 *             credits?: string[], creditsDuration?: number, voice?: object, scenes: ScriptScene[] }} Script
 * @typedef {{ duration: number, file: string, rate?: number }} VoiceClip
 * @typedef {{ credits?: string[], lines: Record<string, VoiceClip> }} VoiceManifest
 * @typedef {{ id: string, lang: string, text: string, who: string | null, caption: string | false, start: number, end: number,
 *             file: string | null, rate: number, estimated: boolean }} TimedLine
 * @typedef {{ id: string, index: number, start: number, end: number, duration: number, transition: number, lines: TimedLine[] }} TimedScene
 * @typedef {{ width: number, height: number, fps: number, duration: number, frames: number, captions: boolean,
 *             credits: string[], scenes: TimedScene[], lines: TimedLine[], warnings: string[] }} Timeline
 */

export const DEFAULT_TIMING = Object.freeze({ lead: 0.5, gap: 0.35, tail: 0.8 });

/** Rough speaking time when a line has no voice clip yet, so a preview still works. */
export function estimateSpeech(text, lang) {
  const chars = [...text].length;
  return lang === 'ja' ? 0.6 + chars * 0.14 : 0.6 + text.split(/\s+/).length * 0.36;
}

/** The id of the i-th line (0-based) of a scene when the line has no id. */
export function lineId(sceneId, i) {
  return `${sceneId}-${i + 1}`;
}

/**
 * Place every scene and line on the timeline. Line lengths come from the voice clips,
 * or from an estimate (with a warning) for lines that have none yet.
 * @param {Script} script
 * @param {VoiceManifest | null} voice
 * @returns {Timeline}
 */
export function buildTimeline(script, voice) {
  const warnings = [];
  const [width, height] = script.size ?? [1920, 1080];
  const fps = script.fps ?? 30;
  const base = { ...DEFAULT_TIMING, ...script.timing };
  // Look clips up only among the manifest's own keys, so an id such as "constructor" is not found on Object.prototype.
  const clips = voice?.lines ?? {};
  const clipOf = (id) => (Object.hasOwn(clips, id) ? clips[id] : null);

  const ids = new Set();
  /** @type {TimedScene[]} */
  const scenes = [];
  /** @type {TimedLine[]} */
  const lines = [];
  let cursor = 0;

  /** @param {ScriptScene} s */
  const place = (s) => {
    const index = scenes.length;
    if (!s.id) throw new Error(`scene ${index} has no id`);
    if (ids.has(s.id)) throw new Error(`duplicate scene id "${s.id}"`);
    ids.add(s.id);
    const timing = { lead: s.lead ?? base.lead, gap: s.gap ?? base.gap, tail: s.tail ?? base.tail };
    const start = cursor;
    let t = start + timing.lead;
    /** @type {TimedLine[]} */
    const sceneLines = (s.lines ?? []).map((l, i) => {
      const id = l.id ?? lineId(s.id, i);
      if (ids.has(id)) throw new Error(`duplicate id "${id}"`);
      ids.add(id);
      if (i > 0) t += timing.gap;
      const clip = clipOf(id);
      let len;
      if (clip) {
        len = clip.duration;
      } else {
        len = estimateSpeech(l.speech ?? l.text, l.lang) / (l.voice?.speed ?? 1);
        warnings.push(`line "${id}" has no voice clip; using an estimated ${len.toFixed(1)}s. Run "vvv voice".`);
      }
      const line = {
        id, lang: l.lang, text: l.text, who: l.who ?? null,
        caption: l.caption === false ? false : (l.caption ?? l.text),
        start: t, end: t + len, file: clip ? clip.file : null, rate: clip?.rate ?? 1, estimated: !clip,
      };
      t += len;
      return line;
    });
    const spoken = sceneLines.length ? t + timing.tail - start : 0;
    const duration = Math.max(s.duration ?? 0, spoken);
    if (!(duration > 0)) throw new Error(`scene "${s.id}" has neither lines nor a duration`);
    const scene = {
      id: s.id, index, start, end: start + duration, duration,
      transition: index === 0 ? 0 : Math.min(s.transition ?? 0, duration / 2),
      lines: sceneLines,
    };
    scenes.push(scene);
    lines.push(...sceneLines);
    cursor = scene.end;
  };

  script.scenes.forEach(place);
  // A voice model's credit is required only when the movie plays at least one of its clips.
  const voiced = lines.some((l) => l.file);
  const credits = [...(script.credits ?? []), ...(voiced ? voice?.credits ?? [] : [])].filter((c, i, a) => a.indexOf(c) === i);
  if (credits.length > 0 && !ids.has('credits')) place({ id: 'credits', duration: script.creditsDuration ?? 3, transition: 0.5 });

  const duration = cursor;
  return {
    width, height, fps, duration, frames: Math.round(duration * fps),
    captions: script.captions ?? true, credits, scenes, lines, warnings,
  };
}

/** The scene shown at global time T, and the previous scene while a transition runs. */
export function scenesAt(timeline, T) {
  const { scenes } = timeline;
  let i = scenes.findIndex((s) => T < s.end);
  if (i < 0) i = scenes.length - 1;
  const cur = scenes[i];
  const prev = i > 0 && cur.transition > 0 && T < cur.start + cur.transition ? scenes[i - 1] : null;
  const mix = prev ? (T - cur.start) / cur.transition : 1;
  return { cur, prev, mix };
}

const CAPTION_IN = 0.05;
const CAPTION_OUT = 0.25;

/**
 * The caption to show at global time T, and its opacity. A caption fades in just before its
 * line and lingers briefly after it, but a line that is being spoken always wins over one
 * that is fading out, so captions never lag the voice.
 * @returns {{ line: TimedLine, alpha: number } | null}
 */
export function captionAt(timeline, T) {
  const shown = timeline.lines.filter((l) => l.caption !== false);
  const line = shown.find((l) => T >= l.start - CAPTION_IN && T < l.end)
    ?? shown.find((l) => T >= l.end && T < l.end + CAPTION_OUT);
  if (!line) return null;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const fadeIn = clamp01((T - (line.start - CAPTION_IN)) / 0.2);
  const fadeOut = 1 - clamp01((T - (line.end + 0.05)) / 0.2);
  return { line, alpha: Math.min(fadeIn, fadeOut) };
}
