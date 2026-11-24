// @ts-check
// Line breaking needs real font metrics, so it runs in Chrome with the bundled font.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMovie } from '../../lib/browser.js';
import { fixture } from './helpers.js';

/** Wrap each text at a width given in characters of the font size. */
async function wrapAll(cases) {
  return withMovie(fixture('sync'), (page) => page.evaluate(async (cs) => {
    const { wrap, FONT_FAMILY } = await import('/runtime/text.js');
    const g = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
    g.font = `400 40px ${FONT_FAMILY}`;
    return cs.map(([s, chars]) => wrap(g, s, chars * 40));
  }, cases));
}

test('Japanese breaks between characters but never before closing punctuation or after an opening bracket', async () => {
  const [a, b, c, d] = await wrapAll([
    ['あいうえおかきくけこ', 5],
    ['あいうえ、かきくけこ', 4],
    ['あいう「かきくけ」こ', 4],
    ['あいうえおしゃかき', 6],
  ]);
  assert.deepEqual(a, ['あいうえお', 'かきくけこ']);
  // "、" may not start a line, so it hangs at the end of the line before.
  assert.deepEqual(b, ['あいうえ、', 'かきくけ', 'こ']);
  // "「" may not end a line, so it moves down with the word it opens; "」" may not start one.
  assert.deepEqual(c, ['あいう', '「かきく', 'け」こ']);
  // Small kana such as "ゃ" may not start a line, so it hangs too.
  assert.deepEqual(d, ['あいうえおしゃ', 'かき']);
});

test('Latin text breaks at spaces only, and explicit newlines are kept', async () => {
  const [a, b] = await wrapAll([
    ['Weaving people and AI together', 12],
    ['First line\nSecond', 40],
  ]);
  assert.deepEqual(a, ['Weaving people and AI', 'together']);
  assert.deepEqual(b, ['First line', 'Second']);
});
