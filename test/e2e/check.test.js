// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, vvv } from './helpers.js';

test('check reports a failing span of frames once, with its time range, and exits 1', async () => {
  const r = await vvv('check', fixture('broken'));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /error at 1\.50s–1\.57s \(frame 45\): boom/);
  assert.match(r.stderr, /warning: text overflows its box \(80px, 1 lines\): "This sentence/);
  assert.match(r.stderr, /checked 60 frames .*: 1 error\(s\), 1 warning\(s\)/);
});

test('check passes a movie that draws every frame', async () => {
  const r = await vvv('check', fixture('sync'));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /checked 90 frames .*: 0 error\(s\), 0 warning\(s\)/);
});
