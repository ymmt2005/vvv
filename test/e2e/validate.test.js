// @ts-check
// vvv validate on a movie.js that gets names wrong, and the check that runs before vvv voice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, vvv } from './helpers.js';

test('validate reports each wrong name in movie.js with the closest right one, and a draw that fails', async () => {
  const r = await vvv('validate', fixture('misspelt'));
  assert.equal(r.code, 1);
  const errors = r.stderr.split('\n').filter((l) => l.startsWith('error: ')).map((l) => l.slice('error: '.length));
  assert.deepEqual(errors.sort(), [
    'movie.js: captionStyle: unknown field "colour"; did you mean "color"?',
    'movie.js: scene "intro" at 0.00 s: scene "intro" has no line "hello"',
    'movie.js: scenes.titel: no scene "titel" in script.json; did you mean "title"?',
    'movie.js: scenes.title.draw: must be a function (g, s) => void',
    'movie.js: scenes.title: unknown field "drow"; did you mean "draw"?',
    'movie.js: unknown field "musik"',
  ]);
});

test('voice refuses a script with errors before any engine reads it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vvv-preflight-'));
  await writeFile(join(dir, 'script.json'), JSON.stringify({ voice: { engine: 'google' }, scenes: [{ id: 'a', lines: [{ lang: 'en', txt: 'Hi.' }] }] }));
  const r = await vvv('voice', dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /error: script\.json: voice: missing field "google"/);
  assert.match(r.stderr, /error: script\.json: scenes\[0\]\.lines\[0\]: unknown field "txt"; did you mean "text"\?/);
  assert.ok(!existsSync(join(dir, 'voice')), 'no voice directory: the engine never ran');
});

test('check reports the movie.js errors that validate finds, besides the frames that fail', async () => {
  const r = await vvv('check', fixture('misspelt'));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /error: movie\.js: scenes\.titel: no scene "titel" in script\.json; did you mean "title"\?/);
  assert.match(r.stderr, /error at 0\.00s.*: scene "intro" has no line "hello"/);
});
