// @ts-check
// Voice step: speaks every narration line of script.json and writes
// voice/<line id>.wav plus voice/manifest.json, which the timeline reads.
// A line is regenerated only when its text, language or voice settings change.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PIPER, VOICES, assertReady } from './assets.js';
import { lineId } from '../runtime/timeline.js';

const run = promisify(execFile);

/** Duration in seconds of a PCM WAV file, read from its header. */
export function wavDuration(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 12;
  let rate = 0;
  let blockAlign = 0;
  while (off + 8 <= buf.length) {
    const id = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') { rate = dv.getUint32(off + 12, true); blockAlign = dv.getUint16(off + 20, true); }
    if (id === 'data') {
      if (!rate) break;
      return Math.min(size, buf.length - off - 8) / blockAlign / rate;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('not a PCM WAV file');
}

/**
 * Replace whole words with how they should be spoken, from script.json's
 * voice.pronounce.<lang> map, e.g. { "AI": "ay eye", "Orito": "[[ o ɾ i t o ]]" }.
 * A value may be a respelling or piper-plus phonemes in [[ ]]. Matching is case-sensitive.
 * @param {string} text
 * @param {Record<string, string> | undefined} dict
 */
export function pronounce(text, dict) {
  if (!dict) return text;
  const words = Object.keys(dict).sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // \b does not work for Japanese, so a word boundary here is "not a Latin letter or digit".
  const re = new RegExp(`(?<![A-Za-z0-9])(${esc.join('|')})(?![A-Za-z0-9])`, 'g');
  return text.replace(re, (w) => dict[w]);
}

/** Split a pronunciation value into a respelling or IPA. "[[ o ɾ i t o ]]" is IPA (piper-plus phoneme syntax). */
function parsePronounce(value) {
  const m = /^\[\[(.*)\]\]$/.exec(value.trim());
  return m ? { ipa: m[1].replace(/\s+/g, '') } : { say: value };
}

const GOOGLE_LANG = { en: 'en-US', ja: 'ja-JP', zh: 'cmn-CN', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR' };

/**
 * A voice engine turns one line into a WAV file.
 * settings(line) returns everything that changes the audio, so a change regenerates the clip,
 * plus rate: the playback rate the mix applies to the clip (1 unless the engine shifts pitch that way).
 * @typedef {{ id: string, lang: string, text: string, speech?: string, voice?: any }} Line
 * @typedef {{ credit: string | null, languages: string[], settings: (line: Line) => { rate: number } & Record<string, any>,
 *   speak: (line: Line, settings: any, path: string) => Promise<void> }} Engine
 */

/** @returns {Engine} */
function piperEngine(script) {
  assertReady();
  const name = script.voice?.model ?? 'tsukuyomi';
  if (!Object.hasOwn(VOICES, name)) throw new Error(`unknown piper-plus voice model "${name}"; known: ${Object.keys(VOICES).join(', ')}`);
  const voice = VOICES[name];
  const baseLength = script.voice?.lengthScale ?? 1;
  return {
    credit: voice.credit,
    languages: voice.languages,
    settings(line) {
      // pitch > 1 raises the voice: generate it slower by that factor, then play it faster by the same factor.
      const pitch = line.voice?.pitch ?? 1;
      const speed = line.voice?.speed ?? 1;
      const speech = pronounce(line.speech ?? line.text, script.voice?.pronounce?.[line.lang]);
      return { engine: 'piper-plus', piper: PIPER.version, model: name, lang: line.lang, speech, lengthScale: (baseLength * pitch) / speed, rate: pitch, noise: script.voice?.noise ?? 0.4 };
    },
    async speak(line, st, path) {
      await run(PIPER.bin, [
        '-q', '-m', join(voice.dir, voice.model), '-l', line.lang, '-t', st.speech, '-f', path,
        '--length_scale', String(st.lengthScale), '--noise_scale', String(st.noise), '--sentence_silence', '0.15',
      ], {
        env: {
          ...process.env,
          LD_LIBRARY_PATH: join(PIPER.dir, 'lib'),
          LC_ALL: 'C.UTF-8',
          OPENJTALK_DICTIONARY_PATH: join(PIPER.dir, 'share', 'open_jtalk', 'dic'),
          PIPER_PLUS_OFFLINE_MODE: '1',
          PIPER_PLUS_DISABLE_MODEL_NOTICE: '1',
        },
      });
    },
  };
}

/**
 * Google Cloud Text-to-Speech with Chirp 3 HD voices.
 * script.voice.google: { project, voice: "Charon", speakingRate? }. A line may override voice and
 * speakingRate in line.voice. Credentials come from Application Default Credentials
 * (gcloud auth application-default login), billed to the project.
 * @returns {Engine}
 */
function googleEngine(script) {
  const g = script.voice?.google ?? {};
  if (!g.project) throw new Error('voice.google.project is required for the google engine');
  let token = null;
  const accessToken = async () => {
    if (!token) {
      const { stdout } = await run('gcloud', ['auth', 'application-default', 'print-access-token']);
      token = stdout.trim();
    }
    return token;
  };
  return {
    credit: null,
    languages: Object.keys(GOOGLE_LANG),
    settings(line) {
      const dict = script.voice?.pronounce?.[line.lang] ?? {};
      const say = Object.fromEntries(Object.entries(dict).filter(([, v]) => parsePronounce(v).say !== undefined));
      const text = pronounce(line.speech ?? line.text, say);
      const ipa = Object.entries(dict)
        .map(([phrase, v]) => ({ phrase, ipa: parsePronounce(v).ipa }))
        .filter((x) => x.ipa && text.includes(x.phrase));
      return {
        engine: 'google', model: 'chirp3-hd', lang: GOOGLE_LANG[line.lang], text, ipa,
        voice: line.voice?.name ?? g.voice ?? 'Charon',
        speakingRate: line.voice?.speakingRate ?? g.speakingRate ?? 1,
        rate: 1,
      };
    },
    async speak(line, st, path) {
      const body = {
        input: { text: st.text },
        voice: { languageCode: st.lang, name: `${st.lang}-Chirp3-HD-${st.voice}` },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate: st.speakingRate },
      };
      if (st.ipa.length) {
        body.input.customPronunciations = {
          pronunciations: st.ipa.map((x) => ({ phrase: x.phrase, phoneticEncoding: 'PHONETIC_ENCODING_IPA', pronunciation: x.ipa })),
        };
      }
      const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken()}`, 'x-goog-user-project': g.project, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Google TTS failed for line "${line.id}": ${res.status} ${await res.text()}`);
      const { audioContent } = await res.json();
      await writeFile(path, Buffer.from(audioContent, 'base64'));
    },
  };
}

export const ENGINES = { 'piper-plus': piperEngine, google: googleEngine };

// Ids become file names, so allow letters and digits of any script, "_", "-" and ".".
const ID = /^[\p{L}\p{N}_.-]+$/u;

/**
 * Speak every line of <movieDir>/script.json into <movieDir>/voice/.
 * The manifest is saved after each clip, so a failed or interrupted run leaves every clip
 * matching its manifest entry, and the next run resumes where this one stopped.
 * @param {string} movieDir
 * @param {{ force?: boolean, log?: (s: string) => void, engine?: Engine }} [o] engine replaces the script's engine (for tests).
 */
export async function generateVoice(movieDir, o = {}) {
  const log = o.log ?? console.error;
  const script = JSON.parse(await readFile(join(movieDir, 'script.json'), 'utf8'));
  const engineName = script.voice?.engine ?? 'piper-plus';
  let engine = o.engine;
  if (!engine) {
    if (!Object.hasOwn(ENGINES, engineName)) throw new Error(`unknown voice engine "${engineName}"; known: ${Object.keys(ENGINES).join(', ')}`);
    engine = ENGINES[engineName](script);
  }
  const outDir = join(movieDir, 'voice');
  await mkdir(outDir, { recursive: true });
  const manifestPath = join(outDir, 'manifest.json');
  const old = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { lines: {} };

  // Keep the old entries until this run replaces or drops them; null prototypes make every id an ordinary key.
  const entries = Object.assign(Object.create(null), old.lines ?? {});
  const save = (lines) => writeFile(manifestPath, `${JSON.stringify({
    engine: engineName,
    credits: Object.keys(lines).length && engine.credit ? [engine.credit] : [],
    lines,
  }, null, 2)}\n`);

  const keep = Object.create(null);
  let made = 0;
  for (const scene of script.scenes) {
    for (const [i, raw] of (scene.lines ?? []).entries()) {
      const line = { ...raw, id: raw.id ?? lineId(scene.id, i) };
      if (!ID.test(line.id)) throw new Error(`line id "${line.id}" may contain only letters, digits, "_", "-" and "."`);
      if (!engine.languages.includes(line.lang)) throw new Error(`line "${line.id}": lang must be one of ${engine.languages.join(', ')}`);
      const st = engine.settings(line);
      const hash = createHash('sha256').update(JSON.stringify(st)).digest('hex').slice(0, 16);
      const file = `${line.id}.wav`;
      const path = join(outDir, file);
      const prev = entries[line.id];
      if (o.force || prev?.hash !== hash || !existsSync(path)) {
        const part = `${path}.part`;
        await engine.speak(line, st, part);
        const duration = wavDuration(await readFile(part)) / st.rate;
        await rename(part, path);
        entries[line.id] = { file, duration, rate: st.rate, hash };
        await save(entries);
        made++;
        log(`spoke ${line.id} (${engineName}, ${line.lang}): ${st.speech ?? st.text}`);
      }
      keep[line.id] = entries[line.id];
    }
  }

  await save(keep);
  // Remove clips of lines that no longer exist.
  const files = new Set(Object.values(keep).map((l) => l.file));
  for (const f of await readdir(outDir)) {
    if ((f.endsWith('.wav') || f.endsWith('.part')) && !files.has(f)) await rm(join(outDir, f));
  }
  log(`voice: ${made} line(s) generated, ${Object.keys(keep).length - made} reused`);
}
