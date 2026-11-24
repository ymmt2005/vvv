// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chaptersText, chaptersVtt, writeChapterFiles, youTubeAccepts } from '../../lib/chapters.js';

const CHAPTERS = [{ title: 'Intro', start: 0, end: 12.5 }, { title: 'R&D <now>', start: 12.5, end: 83.4 }, { title: 'Long', start: 83.4, end: 3723.25 }];

test('the WebVTT file has one escaped cue per chapter', () => {
  assert.equal(chaptersVtt(CHAPTERS), [
    'WEBVTT', '',
    '1', '00:00:00.000 --> 00:00:12.500', 'Intro', '',
    '2', '00:00:12.500 --> 00:01:23.400', 'R&amp;D &lt;now&gt;', '',
    '3', '00:01:23.400 --> 01:02:03.250', 'Long', '',
  ].join('\n'));
});

test('the YouTube timestamps round down and grow an hour field only when needed', () => {
  assert.equal(chaptersText(CHAPTERS), '0:00 Intro\n0:12 R&D <now>\n1:23 Long\n');
  assert.equal(chaptersText([{ title: 'x', start: 3723.9, end: 4000 }]), '1:02:03 x\n');
});

test('YouTube shows chapters only when there are three or more, each at least 10 s long', () => {
  assert.equal(youTubeAccepts(CHAPTERS), true);
  assert.equal(youTubeAccepts(CHAPTERS.slice(0, 2)), false);
  assert.equal(youTubeAccepts([...CHAPTERS, { title: 'short', start: 3723.25, end: 3730 }]), false);
  // YouTube sees the whole seconds 0:00, 0:10 and 0:20, so the second chapter lasts 10 s for it, though exactly 9.6 s.
  assert.equal(youTubeAccepts([{ title: 'a', start: 0, end: 10.9 }, { title: 'b', start: 10.9, end: 20.5 }, { title: 'c', start: 20.5, end: 40 }]), true);
});

test('the chapter files are written when there are chapters, and removed when there are none', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'vvv-chapters-')), 'out');
  const logged = [];
  await writeChapterFiles(dir, CHAPTERS, (s) => logged.push(s));
  assert.deepEqual((await readdir(dir)).sort(), ['chapters.txt', 'chapters.vtt']);
  assert.equal(await readFile(join(dir, 'chapters.txt'), 'utf8'), chaptersText(CHAPTERS));
  assert.ok(!logged.some((s) => s.startsWith('note:')));
  await writeChapterFiles(dir, CHAPTERS.slice(0, 1), (s) => logged.push(s));
  assert.ok(logged.some((s) => s.startsWith('note: YouTube')));
  await writeFile(join(dir, 'movie.mp4'), '');
  await writeChapterFiles(dir, [], () => {});
  assert.deepEqual(await readdir(dir), ['movie.mp4']);
});
