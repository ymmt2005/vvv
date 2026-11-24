// @ts-check
// vvv frames writes into out/frames/, and each run replaces the images of the last one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, vvv } from './helpers.js';

test('frames writes a contact sheet and full frames into out/frames/, replacing the last run', async () => {
  const dir = join(fixture('sync'), 'out', 'frames');
  const first = await vvv('frames', fixture('sync'), '--at', '0.5,2', '--full');
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual((await readdir(dir)).sort(), ['frame-0.50.png', 'frame-2.00.png', 'sheet.png']);
  const second = await vvv('frames', fixture('sync'), '--at', '1');
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(await readdir(dir), ['sheet.png']);
});
