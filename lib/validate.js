// @ts-check
// vvv validate: checks script.json and music.json against their schemas and against each other,
// and checks what movie.js defines against script.json. Every message names the file and the
// path of the field, and suggests the closest known name for a misspelt one.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { buildTimeline } from '../runtime/timeline.js';
import { MusicError, expandMusic } from '../runtime/audio/score.js';
import { DEFAULT_CAPTION } from '../runtime/stage.js';

const SCHEMA_DIR = fileURLToPath(new URL('../schema/', import.meta.url));

/** @type {Promise<{ script: import('ajv').ValidateFunction, music: import('ajv').ValidateFunction }> | null} */
let validators = null;

function loadValidators() {
  validators ??= (async () => {
    const ajv = new Ajv2020({ allErrors: true, verbose: true, strictTuples: false });
    const load = async (name) => ajv.compile(JSON.parse(await readFile(join(SCHEMA_DIR, name), 'utf8')));
    return { script: await load('script.schema.json'), music: await load('music.schema.json') };
  })();
  return validators;
}

/** "/scenes/2/transtion" → "scenes[2].transtion" */
function fieldPath(pointer) {
  if (!pointer) return '(top level)';
  return pointer.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((s, i) => (/^\d+$/.test(s) ? `[${s}]` : `${i ? '.' : ''}${s}`)).join('');
}

/** Edit distance between two strings, for "did you mean". */
function distance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return d[b.length];
}

/** '; did you mean "x"?' for the known name closest to `name`, or '' when none is close. */
export function suggest(name, known) {
  const lower = String(name).toLowerCase();
  let best = null;
  let bestD = Infinity;
  for (const k of known) {
    const d = k.toLowerCase() === lower ? 0 : distance(lower, k.toLowerCase());
    if (d < bestD) { best = k; bestD = d; }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(String(name).length / 3)) ? `; did you mean "${best}"?` : '';
}

/**
 * Turn Ajv's errors into one message per problem.
 * @param {string} file
 * @param {import('ajv').ErrorObject[]} errors
 */
function schemaMessages(file, errors) {
  // An anyOf failure also reports every branch's failure, nested anyOf ones included. Keep only the outermost
  // anyOf error, which Ajv reports after its branches, because its description says what was expected.
  const anyOf = errors.filter((e) => e.keyword === 'anyOf');
  const covered = (e) => anyOf.some((a) => a !== e && (e.instancePath.startsWith(`${a.instancePath}/`)
    || (e.instancePath === a.instancePath && (e.keyword !== 'anyOf' || errors.indexOf(e) < errors.indexOf(a)))));
  return errors.filter((e) => !covered(e)).map((e) => {
    const where = `${file}: ${fieldPath(e.instancePath)}`;
    const p = /** @type {any} */ (e.params);
    const known = Object.keys(/** @type {any} */ (e.parentSchema)?.properties ?? {}).filter((k) => k !== '$schema');
    switch (e.keyword) {
      case 'additionalProperties':
        return `${where}: unknown field "${p.additionalProperty}"${suggest(p.additionalProperty, known)}`;
      case 'required':
        return `${where}: missing field "${p.missingProperty}"`;
      case 'enum':
        return `${where}: ${JSON.stringify(e.data)} is not one of ${p.allowedValues.join(', ')}${suggest(e.data, p.allowedValues)}`;
      case 'propertyNames':
      case 'if':
        return null;
      case 'anyOf':
      case 'pattern': {
        const expected = /** @type {any} */ (e.parentSchema)?.description;
        return `${where}: ${JSON.stringify(e.data)} is not valid${expected ? ` (expected: ${expected})` : `: ${e.message}`}`;
      }
      default:
        return `${where}: ${e.message}`;
    }
  }).filter((m) => m !== null).filter((m, i, all) => all.indexOf(m) === i);
}

/**
 * Check script.json and music.json, and build the timeline from them.
 * @param {string} movieDir
 * @param {{ music?: boolean }} [o] music: false skips music.json, for commands that do not use it
 * @returns {Promise<{ errors: string[], warnings: string[], timeline: import('../runtime/timeline.js').Timeline | null }>}
 */
export async function validateFiles(movieDir, o = {}) {
  const v = await loadValidators();
  const errors = [];
  const ABSENT = Symbol('absent');
  const BROKEN = Symbol('broken');
  /** The parsed file, ABSENT when it does not exist, or BROKEN (with an error) when it is not JSON. */
  const readJson = async (name) => {
    const path = join(movieDir, name);
    if (!existsSync(path)) return ABSENT;
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      errors.push(`${name}: ${/** @type {Error} */ (e).message}`);
      return BROKEN;
    }
  };

  const script = await readJson('script.json');
  if (script === ABSENT) errors.push('script.json: the file is missing');
  else if (script !== BROKEN && !v.script(script)) errors.push(...schemaMessages('script.json', v.script.errors ?? []));
  let timeline = null;
  if (!errors.length) {
    const manifest = await readJson('voice/manifest.json');
    if (manifest !== BROKEN) {
      try {
        timeline = buildTimeline(script, manifest === ABSENT ? null : manifest);
      } catch (e) {
        errors.push(`script.json: ${/** @type {Error} */ (e).message}`);
      }
    }
  }

  const warnings = [...(timeline?.warnings ?? [])];
  if (o.music !== false) {
    const music = await readJson('music.json');
    if (music === ABSENT || music === BROKEN) { /* nothing to check, or already reported */ }
    else if (!v.music(music)) errors.push(...schemaMessages('music.json', v.music.errors ?? []));
    else if (timeline) {
      // The score's times name scenes and lines, so it is checked against the timeline built from script.json.
      try {
        warnings.push(...expandMusic(music, timeline).warnings.map((w) => `music.json: ${w}`));
      } catch (e) {
        if (!(e instanceof MusicError)) throw e;
        const ids = [...timeline.scenes.map((s) => s.id), ...timeline.lines.map((l) => l.id)];
        errors.push(`music.json: ${e.message}${e.unknownId === null ? '' : suggest(e.unknownId, ids)}`);
      }
    }
  }
  return { errors, warnings, timeline };
}

const MOVIE_KEYS = ['background', 'scenes', 'captionStyle'];
const SCENE_KEYS = ['setup', 'draw'];
const CAPTION_KEYS = Object.keys(DEFAULT_CAPTION);

/**
 * Check what movie.js defines, as the page's vvv.inspect() reports it, against the timeline.
 * @param {any} r the result of vvv.inspect()
 * @param {import('../runtime/timeline.js').Timeline} timeline
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkMovie(r, timeline) {
  const errors = [];
  const warnings = [...r.warnings];
  for (const k of r.keys) {
    if (k === 'music') errors.push('movie.js: music: the score moved to music.json; see references/music.md');
    else if (!MOVIE_KEYS.includes(k)) errors.push(`movie.js: unknown field "${k}"${suggest(k, MOVIE_KEYS)}`);
  }
  if (r.scenesType !== 'object') errors.push('movie.js: scenes: must be an object that maps scene ids to { setup, draw }');
  const ids = timeline.scenes.map((s) => s.id);
  for (const [id, sc] of Object.entries(r.scenes)) {
    if (id === 'credits' && !ids.includes(id)) warnings.push('movie.js: scenes.credits: the movie has no credits, so this scene never shows');
    else if (!ids.includes(id)) errors.push(`movie.js: scenes.${id}: no scene "${id}" in script.json${suggest(id, ids)}`);
    for (const k of sc.keys) if (!SCENE_KEYS.includes(k)) errors.push(`movie.js: scenes.${id}: unknown field "${k}"${suggest(k, SCENE_KEYS)}`);
    if (sc.draw !== 'function') errors.push(`movie.js: scenes.${id}.draw: must be a function (g, s) => void`);
    if (sc.setup !== 'missing' && sc.setup !== 'function') errors.push(`movie.js: scenes.${id}.setup: must be a function (s) => state`);
  }
  for (const k of r.captionStyle ?? []) {
    if (!CAPTION_KEYS.includes(k)) errors.push(`movie.js: captionStyle: unknown field "${k}"${suggest(k, CAPTION_KEYS)}`);
  }
  for (const e of r.errors) errors.push(`movie.js: scene "${e.scene}" at ${e.time.toFixed(2)} s: ${e.message}`);
  return { errors, warnings };
}
