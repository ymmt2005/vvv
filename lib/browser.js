// @ts-check
// Opens a movie in headless Chrome (Playwright) and hands back its window.vvv API.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './server.js';

/**
 * Open a movie directory in headless Chrome, wait until the page has loaded it, and run fn.
 * The server and the browser are closed afterwards, also when anything fails.
 * @template T
 * @param {string} movieDir
 * @param {(page: import('playwright').Page, server: Awaited<ReturnType<typeof startServer>>) => Promise<T>} fn
 * @param {{ log?: (s: string) => void }} [o]
 * @returns {Promise<T>}
 */
export async function withMovie(movieDir, fn, o = {}) {
  const log = o.log ?? console.error;
  if (!existsSync(join(movieDir, 'movie.js'))) throw new Error(`${movieDir} has no movie.js`);
  /** @type {Awaited<ReturnType<typeof startServer>> | null} */
  let server = null;
  /** @type {import('playwright').Browser | null} */
  let browser = null;
  try {
    server = await startServer({ movieDir });
    browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    page.on('console', (m) => {
      const t = m.text();
      if (t.startsWith('vvv:progress ')) log(t.slice(4));
      // Skip WebGL driver performance notes, which software rendering prints on every readback.
      else if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('GL Driver Message')) log(`[page ${m.type()}] ${t}`);
    });
    page.on('pageerror', (e) => log(`[page error] ${e.message}`));
    await page.goto(`${server.url}?headless=1`);
    await page.waitForFunction(() => /** @type {any} */ (window).vvvReady || /** @type {any} */ (window).vvvError, null, { timeout: 120_000 });
    const err = await page.evaluate(() => /** @type {any} */ (window).vvvError);
    if (err) throw new Error(`the movie failed to load:\n${err}`);
    return await fn(page, server);
  } finally {
    await browser?.close();
    await server?.close();
  }
}

/**
 * Call a method of the page's window.vvv API.
 * @param {import('playwright').Page} page
 * @param {string} name
 * @param {...any} args
 */
export function call(page, name, ...args) {
  return page.evaluate(([n, a]) => /** @type {any} */ (window).vvv[n](...a), /** @type {const} */ ([name, args]));
}
