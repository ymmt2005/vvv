// @ts-check
// Renders the sync fixture and checks the MP4 by decoding it in Chrome:
// every frame is present, in order, at the right time, and the audio lines up.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { withMovie } from '../../lib/browser.js';
import { fixture, injectMp4Reader, vvv } from './helpers.js';

const DIR = fixture('sync');
const FPS = 30;
const FRAMES = 90;

before(async () => {
  const r = await vvv('render', DIR);
  assert.equal(r.code, 0, r.stderr);
});

test('every frame decodes, in order, at its own time', async () => {
  const got = await withMovie(DIR, async (page) => {
    await injectMp4Reader(page);
    return page.evaluate(async () => {
      const w = /** @type {any} */ (window);
      const buf = await (await fetch('/movie/out/sync.mp4')).arrayBuffer();
      const { tracks } = w.readMp4(buf);
      const v = tracks.find((t) => t.handler === 'vide');
      const out = [];
      const canvas = new OffscreenCanvas(320, 180);
      const g = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true }));
      const dec = new VideoDecoder({
        output: (f) => {
          g.drawImage(f, 0, 0);
          let idx = 0;
          for (let b = 0; b < 8; b++) idx = (idx << 1) | (g.getImageData(b * 40 + 20, 90, 1, 1).data[0] > 128 ? 1 : 0);
          out.push({ ts: f.timestamp, idx });
          f.close();
        },
        error: (e) => { throw e; },
      });
      dec.configure({ codec: w.avcCodecString(v.config), description: v.config });
      for (const s of v.samples) {
        dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.time * 1e6), data: new Uint8Array(buf, s.offset, s.size) }));
      }
      await dec.flush();
      return { frames: out, samples: v.samples.length, firstKey: v.samples[0].key };
    });
  });
  assert.equal(got.samples, FRAMES);
  assert.ok(got.firstKey, 'the first sample must be a key frame');
  assert.deepEqual(got.frames.map((f) => f.idx), Array.from({ length: FRAMES }, (_, i) => i));
  for (const f of got.frames) assert.ok(Math.abs(f.ts - (f.idx * 1e6) / FPS) <= 1, `frame ${f.idx} at ${f.ts} µs`);
});

test('the soundtrack and the MP4 audio start the kick at 1.000 s', async () => {
  const r = await withMovie(DIR, (page) => page.evaluate(async () => {
    const w = /** @type {any} */ (window);
    const onset = (buf) => {
      const d = buf.getChannelData(0);
      for (let i = Math.floor(buf.sampleRate * 0.8); i < d.length; i++) if (Math.abs(d[i]) > 0.02) return i / buf.sampleRate;
      return -1;
    };
    const rendered = await w.vvv.soundtrack();
    const bytes = await (await fetch('/movie/out/sync.mp4')).arrayBuffer();
    const decoded = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(bytes);
    return { rendered: onset(rendered), decoded: onset(decoded), duration: decoded.duration };
  }));
  assert.ok(Math.abs(r.rendered - 1.0) < 0.001, `the rendered kick starts at ${r.rendered} s`);
  assert.ok(Math.abs(r.decoded - r.rendered) < 0.001, `the MP4 kick starts at ${r.decoded} s, the rendered one at ${r.rendered} s`);
  assert.ok(Math.abs(r.duration - 3) < 0.03, `audio lasts ${r.duration} s`);
});
