// @ts-check
// vvv validate on script.json and music.json: what it reports, and that the docs list the schemas' fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMovie, validateFiles } from '../../lib/validate.js';
import { ENGINES } from '../../lib/voice.js';
import { VOICES } from '../../lib/assets.js';
import { instruments } from '../../runtime/audio/instruments.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = { size: [320, 180], scenes: [{ id: 'intro', duration: 2 }, { id: 'title', duration: 3, lines: [{ id: 'hello', lang: 'en', text: 'Hello.' }] }] };

async function movie(script, music) {
  const dir = await mkdtemp(join(tmpdir(), 'vvv-validate-'));
  await writeFile(join(dir, 'script.json'), JSON.stringify(script));
  if (music) await writeFile(join(dir, 'music.json'), JSON.stringify(music));
  return dir;
}

const errorsOf = async (script, music) => (await validateFiles(await movie(script, music))).errors;

test('script.json: misspelt fields and values get the closest known name, and every problem is reported', async () => {
  const errors = await errorsOf({
    size: [321, 180],
    scenes: [{ id: 'a', duration: 1, transtion: 0.5, lines: [{ lang: 'jp', text: 'こんにちは' }, { lang: 'en' }] }],
  });
  assert.deepEqual(errors, [
    'script.json: size[0]: must be multiple of 2',
    'script.json: scenes[0]: unknown field "transtion"; did you mean "transition"?',
    'script.json: scenes[0].lines[0].lang: "jp" is not one of en, ja, zh, es, fr, pt; did you mean "ja"?',
    'script.json: scenes[0].lines[1]: missing field "text"',
  ]);
});

test('script.json: rules beyond the schema come from the timeline', async () => {
  assert.deepEqual(await errorsOf({ scenes: [{ id: 'a', duration: 1 }, { id: 'a', duration: 1 }] }), ['script.json: duplicate scene id "a"']);
  assert.deepEqual(await errorsOf({ scenes: [{ id: 'a' }] }), ['script.json: scene "a" has neither lines nor a duration']);
  assert.deepEqual(await errorsOf({ scenes: [{ id: 'a/b', duration: 1 }] }), [
    'script.json: scenes[0].id: "a/b" is not valid (expected: Letters and digits of any script, "_", "-" and "."; ids become file names.)',
  ]);
});

test('music.json: schema errors name the track and suggest the instrument', async () => {
  const errors = await errorsOf(SCRIPT, { tracks: [{ inst: 'kys', progresion: ['C'] }, { inst: 'bell', notes: [[0, 1, 'H4']] }] });
  assert.deepEqual(errors, [
    'music.json: tracks[0]: unknown field "progresion"; did you mean "progression"?',
    'music.json: tracks[0].inst: "kys" is not one of pad, keys, bell, pluck, bass, lead, kick, snare, hat, bark, boing, swell; did you mean "keys"?',
    'music.json: tracks[1].notes[0][2]: "H4" is not valid (expected: A pitch, or an array of pitches for a chord.)',
  ]);
});

test('music.json is checked against script.json: its times must name real scenes and lines', async () => {
  const check = async (track) => (await validateFiles(await movie(SCRIPT, { tracks: [track] })));
  assert.deepEqual((await check({ inst: 'bell', at: 'titel + 1', notes: [[0, 1, 'C5']] })).errors,
    ['music.json: tracks[0].at: no scene or line "titel" in script.json; did you mean "title"?']);
  assert.deepEqual((await check({ inst: 'bell', at: 'hello', unit: 'seconds', notes: [[0, 1, 'C5']] })).errors, []);
  assert.deepEqual((await check({ inst: 'pad', progression: ['C'], from: 'title', until: 'intro' })).errors,
    ['music.json: tracks[0].until: 0.00 s is not after from, 2.00 s']);
  assert.deepEqual((await check({ inst: 'bass', roots: ['C'], style: 'arp' })).errors,
    ['music.json: tracks[0].style: applies only to a track with progression, not roots']);
  assert.deepEqual((await check({ inst: 'pad', progression: ['C', 'Cmj7'] })).errors,
    ['music.json: tracks[0].progression[1]: unknown chord quality "mj7" in "Cmj7"']);
  assert.deepEqual((await check({ inst: 'pad', progression: ['C'], drums: 'x...' })).errors,
    ['music.json: tracks[0]: a track needs exactly one of notes, progression, roots, drums; it has progression and drums']);
  assert.deepEqual((await check({ inst: 'bell', unit: 'seconds', at: 'title + 2.5', notes: [[0, 1, 'C5'], [1, 1, 'E5']] })).warnings.filter((w) => w.startsWith('music.json')),
    ['music.json: tracks[0]: 1 note(s) start after the movie ends at 5.00 s, and do not play']);
  const twice = await validateFiles(await movie(SCRIPT, { tracks: [{ inst: 'bell', name: 'x', notes: [[0, 1, 'C5']] }, { inst: 'bell', name: 'x', notes: [[0, 1, 'C5']] }] }));
  assert.deepEqual(twice.errors, ['music.json: tracks[1].name: "x" is also the name of tracks[0]']);
});

test('the example movie is valid', async () => {
  const r = await validateFiles(join(ROOT, 'examples', 'wonderful-day'));
  assert.deepEqual(r.errors, []);
});

/** The field names in the first column of the Markdown table under a heading. */
async function docFields(doc, heading) {
  const md = await readFile(join(ROOT, 'skills', 'make-video', 'references', doc), 'utf8');
  const section = md.split(/^## /m).find((s) => s.startsWith(`${heading}\n`));
  assert.ok(section, `${doc} has a "${heading}" section`);
  const rows = section.split('\n').filter((l) => l.startsWith('| `'));
  return rows.flatMap((r) => [...r.split('|')[1].matchAll(/`([^`]+)`/g)].map((m) => m[1])).sort();
}

const fields = (schema) => Object.keys(schema.properties).filter((k) => k !== '$schema').sort();

test('the reference docs list exactly the fields of the schemas', async () => {
  const script = JSON.parse(await readFile(join(ROOT, 'schema', 'script.schema.json'), 'utf8'));
  assert.deepEqual(await docFields('script-json.md', 'Top level'), fields(script));
  assert.deepEqual(await docFields('script-json.md', 'Scenes'), fields(script.$defs.scene));
  assert.deepEqual(await docFields('script-json.md', 'Lines'), fields(script.$defs.line));
  const music = JSON.parse(await readFile(join(ROOT, 'schema', 'music.schema.json'), 'utf8'));
  assert.deepEqual(await docFields('music.md', 'The score'), fields(music));
  assert.deepEqual(await docFields('music.md', 'Tracks'), fields(music.$defs.track));
  assert.deepEqual((await docFields('music.md', 'Instruments')), [...music.$defs.track.properties.inst.enum].sort());
});

test('the music schema lists exactly the instruments that exist', async () => {
  const music = JSON.parse(await readFile(join(ROOT, 'schema', 'music.schema.json'), 'utf8'));
  assert.deepEqual([...music.$defs.track.properties.inst.enum].sort(), Object.keys(instruments).sort());
});

test('a file that holds null, or a broken voice manifest, is an error that names the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vvv-validate-'));
  await writeFile(join(dir, 'script.json'), 'null');
  assert.deepEqual((await validateFiles(dir)).errors, ['script.json: (top level): must be object']);
  const broken = await movie(SCRIPT, null);
  await mkdir(join(broken, 'voice'));
  await writeFile(join(broken, 'voice', 'manifest.json'), '{"lines": ');
  await writeFile(join(broken, 'music.json'), 'false');
  const errors = (await validateFiles(broken)).errors;
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^voice\/manifest\.json: /);
  assert.equal(errors[1], 'music.json: (top level): must be object');
});

test('checkMovie reports music() left in movie.js, unknown fields, and an unused credits scene', () => {
  const timeline = { scenes: [{ id: 'intro' }] };
  const r = checkMovie({
    keys: ['scenes', 'music', 'captionStyle'], scenesType: 'object', captionStyle: ['maxLines', 'colour'], errors: [], warnings: [],
    scenes: { intro: { keys: ['draw'], draw: 'function', setup: 'missing' }, credits: { keys: ['draw'], draw: 'function', setup: 'missing' } },
  }, /** @type {any} */ (timeline));
  assert.deepEqual(r.errors, [
    'movie.js: music: the score moved to music.json; see references/music.md',
    'movie.js: captionStyle: unknown field "colour"; did you mean "color"?',
  ]);
  assert.deepEqual(r.warnings, ['movie.js: scenes.credits: the movie has no credits, so this scene never shows']);
});

test('the script schema lists exactly the languages, engines and voice models that exist', async () => {
  const script = JSON.parse(await readFile(join(ROOT, 'schema', 'script.schema.json'), 'utf8'));
  const sorted = (a) => [...a].sort();
  assert.deepEqual(sorted(script.$defs.lang.enum), sorted(ENGINES.google({ voice: { google: { project: 'p' } } }).languages));
  for (const v of Object.values(VOICES)) for (const l of v.languages) assert.ok(script.$defs.lang.enum.includes(l), l);
  assert.deepEqual(sorted(script.$defs.voice.properties.engine.enum), sorted(Object.keys(ENGINES)));
  assert.deepEqual(sorted(script.$defs.voice.properties.model.enum), sorted(Object.keys(VOICES)));
});
