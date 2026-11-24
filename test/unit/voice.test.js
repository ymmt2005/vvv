// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pronounce, wavDuration } from '../../lib/voice.js';

test('pronounce replaces whole words only, longest first, and is case-sensitive', () => {
  const dict = { AI: 'ay eye', ID: 'eye dee', 'AI Coworker': 'ay eye coworker', Orito: '[[ o ɾ i t o ]]' };
  assert.equal(pronounce('Orito gives each AI Coworker an ID.', dict), '[[ o ɾ i t o ]] gives each ay eye coworker an eye dee.');
  assert.equal(pronounce('AIDS, said, IDs, ai', dict), 'AIDS, said, IDs, ai');
  assert.equal(pronounce('オリトのAI', dict), 'オリトのay eye');
  assert.equal(pronounce('no dictionary', undefined), 'no dictionary');
});

function wav(rate, channels, frames, extraChunk = false) {
  const data = frames * channels * 2;
  const extra = extraChunk ? 8 + 5 + 1 : 0; // an odd-sized LIST chunk plus its pad byte
  const b = Buffer.alloc(44 + extra + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + extra + data, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  let o = 36;
  if (extraChunk) { b.write('LIST', o); b.writeUInt32LE(5, o + 4); o += 14; }
  b.write('data', o); b.writeUInt32LE(data, o + 4);
  return new Uint8Array(b);
}

test('wavDuration reads the data chunk, skipping other chunks and their pad byte', () => {
  assert.equal(wavDuration(wav(22050, 1, 22050)), 1);
  assert.equal(wavDuration(wav(24000, 2, 12000, true)), 0.5);
  assert.throws(() => wavDuration(new Uint8Array(44)), /not a PCM WAV/);
});
