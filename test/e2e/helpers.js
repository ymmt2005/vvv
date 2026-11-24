// @ts-check
// Helpers for end-to-end tests: run the vvv CLI, and decode its MP4 inside Chrome.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const run = promisify(execFile);

/** Run bin/vvv.js; resolves with { code, stdout, stderr } and never rejects on a nonzero exit. */
export async function vvv(...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [`${ROOT}bin/vvv.js`, ...args], { timeout: 180_000 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: /** @type {any} */ (e).code ?? 1, stdout: /** @type {any} */ (e).stdout ?? '', stderr: /** @type {any} */ (e).stderr ?? '' };
  }
}

/** Make test/mp4-read.js available in the page as window.readMp4 and window.avcCodecString. */
export async function injectMp4Reader(page) {
  const src = await readFile(new URL('../mp4-read.js', import.meta.url), 'utf8');
  await page.addScriptTag({ type: 'module', content: `${src}\nwindow.readMp4 = readMp4;\nwindow.avcCodecString = avcCodecString;` });
  await page.waitForFunction(() => /** @type {any} */ (window).readMp4);
}
