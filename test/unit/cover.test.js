// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTimeline } from '../../runtime/timeline.js';
import { COVER_LANGUAGES, coverHtml, coverLang, posterTime } from '../../lib/cover.js';

const TL = buildTimeline({ scenes: [
  { id: 'a', duration: 4, lines: [{ lang: 'ja', text: 'こんにちは' }, { lang: 'en', text: 'Hi' }] },
  { id: 'b', duration: 6, lines: [{ lang: 'ja', text: 'さようなら' }] },
] }, null);

test('the cover page is in the language of most lines, unless script.json says otherwise', () => {
  assert.equal(coverLang({}, TL), 'ja');
  assert.equal(coverLang({ lang: 'fr' }, TL), 'fr');
  assert.equal(coverLang({}, buildTimeline({ scenes: [{ id: 'x', duration: 1 }] }, null)), 'en');
});

test('the poster frame is in the middle of the first scene, or where script.json puts it', () => {
  assert.equal(posterTime({}, TL), 2);
  assert.equal(posterTime({ poster: 'b + 1.5' }, TL), 5.5);
  assert.equal(posterTime({ poster: 99 }, TL), 10 - 1 / 30);
});

test('the page escapes the text it shows, and its script data cannot close the script element', () => {
  const html = coverHtml({
    title: 'A <b> & "c"', description: 'd', lang: 'ja', video: 'my%20movie.mp4', poster: 'poster.jpg', width: 1920, height: 1080,
    duration: 75, chapters: [{ title: 'one', start: 0 }, { title: '</script><script>alert(1)</script>', start: 30 }], credits: ['音声: x'],
  });
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /<title>A &lt;b&gt; &amp; &quot;c&quot;<\/title>/);
  assert.match(html, /aria-label="全画面表示"/);
  assert.match(html, /<video id="video" src="my%20movie.mp4" poster="poster.jpg"/);
  assert.equal(html.match(/<\/script>/g)?.length, 2, 'only the data and the page script close a script element');
  assert.match(html, /\\u003c\/script>\\u003cscript>alert/, 'the chapter title is in the data, escaped');
  assert.match(html, /left: 40\.000%/, 'a mark on the seek bar where the second chapter starts');
  assert.match(html, /<span class="at">0:30<\/span>/);
});

test('the cover page has text for every language that script.json allows', async () => {
  const script = JSON.parse(await readFile(new URL('../../schema/script.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual([...script.$defs.lang.enum].sort(), [...COVER_LANGUAGES].sort());
});
