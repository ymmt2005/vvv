// @ts-check
// The voice step with a fake engine: what it regenerates, what it keeps, and what it leaves after a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINES, generateVoice } from '../../lib/voice.js';

/** A WAV of `seconds` of silence at 1 kHz, mono 16-bit. */
function wav(seconds) {
  const n = Math.round(seconds * 1000);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(1000, 24);
  b.writeUInt32LE(2000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}

/** An engine whose clips last 0.1 s per character, and which can fail on a chosen line. */
function fakeEngine({ failOn = null } = {}) {
  const spoken = [];
  return {
    spoken,
    credit: 'fake credit',
    languages: ['en', 'ja'],
    settings: (line) => ({ text: line.speech ?? line.text, rate: 1 }),
    async speak(line, st, path) {
      if (line.id === failOn) throw new Error(`engine failed on ${line.id}`);
      spoken.push(line.id);
      await writeFile(path, wav(st.text.length / 10));
    },
  };
}

async function movie(lines) {
  const dir = await mkdtemp(join(tmpdir(), 'vvv-voice-'));
  await writeFile(join(dir, 'script.json'), JSON.stringify({ scenes: [{ id: 'a', lines }] }));
  return dir;
}

const manifest = async (dir) => JSON.parse(await readFile(join(dir, 'voice', 'manifest.json'), 'utf8'));
const quiet = () => {};

test('only changed lines are spoken again, and clips of removed lines are deleted', async () => {
  const dir = await movie([{ lang: 'en', text: 'hello' }, { lang: 'en', text: 'world!' }]);
  const e1 = fakeEngine();
  await generateVoice(dir, { engine: e1, log: quiet });
  assert.deepEqual(e1.spoken, ['a-1', 'a-2']);
  assert.deepEqual((await manifest(dir)).credits, ['fake credit']);
  assert.ok(Math.abs((await manifest(dir)).lines['a-2'].duration - 0.6) < 1e-9);

  await writeFile(join(dir, 'script.json'), JSON.stringify({ scenes: [{ id: 'a', lines: [{ lang: 'en', text: 'hello there' }] }] }));
  const e2 = fakeEngine();
  await generateVoice(dir, { engine: e2, log: quiet });
  assert.deepEqual(e2.spoken, ['a-1']);
  assert.deepEqual(Object.keys((await manifest(dir)).lines), ['a-1']);
  assert.deepEqual(await readdir(join(dir, 'voice')), ['a-1.wav', 'manifest.json']);

  const e3 = fakeEngine();
  await generateVoice(dir, { engine: e3, log: quiet });
  assert.deepEqual(e3.spoken, []);
});

test('a failed run leaves every clip matching its manifest entry, and the next run resumes', async () => {
  const dir = await movie([{ lang: 'en', text: 'one' }, { lang: 'en', text: 'two' }]);
  await generateVoice(dir, { engine: fakeEngine(), log: quiet });
  await writeFile(join(dir, 'script.json'), JSON.stringify({ scenes: [{ id: 'a', lines: [{ lang: 'en', text: 'one, much longer now' }, { lang: 'en', text: 'two, changed' }] }] }));
  await assert.rejects(generateVoice(dir, { engine: fakeEngine({ failOn: 'a-2' }), log: quiet }), /engine failed on a-2/);
  const m = await manifest(dir);
  assert.ok(Math.abs(m.lines['a-1'].duration - 2.0) < 1e-9, 'the new clip of a-1 is recorded');
  const again = fakeEngine();
  await generateVoice(dir, { engine: again, log: quiet });
  assert.deepEqual(again.spoken, ['a-2']);
});

test('ids may be Japanese, and ids named after Object.prototype members are ordinary keys', async () => {
  const dir = await movie([{ id: 'はじめ-1', lang: 'ja', text: 'こんにちは' }, { id: 'constructor', lang: 'en', text: 'hi' }, { id: '__proto__', lang: 'en', text: 'hey' }]);
  await generateVoice(dir, { engine: fakeEngine(), log: quiet });
  assert.deepEqual(Object.keys((await manifest(dir)).lines).sort(), ['__proto__', 'constructor', 'はじめ-1']);
  assert.deepEqual((await readdir(join(dir, 'voice'))).sort(), ['__proto__.wav', 'constructor.wav', 'manifest.json', 'はじめ-1.wav']);
  await assert.rejects(generateVoice(await movie([{ id: 'a/b', lang: 'en', text: 'x' }]), { engine: fakeEngine(), log: quiet }), /may contain only/);
});

test('the google engine applies the dictionary to speech text too, and sends IPA only for phrases it says', () => {
  const engine = ENGINES.google({
    voice: { google: { project: 'p' }, pronounce: { en: { Orito: '[[ ˈ o ʊ ɾ i t o ʊ ]]', ID: 'eye dee' } } },
  });
  const st = engine.settings({ id: 'x', lang: 'en', text: 'shown', speech: 'Orito gives you one ID.' });
  assert.equal(st.text, 'Orito gives you one eye dee.');
  assert.deepEqual(st.ipa, [{ phrase: 'Orito', ipa: 'ˈoʊɾitoʊ' }]);
  assert.deepEqual(engine.settings({ id: 'y', lang: 'en', text: 'No names here.' }).ipa, []);
});
