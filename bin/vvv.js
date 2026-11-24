#!/usr/bin/env node
// @ts-check
// vvv: the command-line tool. Run "vvv help" for usage.

import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `usage: vvv <command> [options]

commands:
  setup                       download the pinned voice engine, voice model, font and Chrome
  voice   <movie-dir>         speak the narration lines of script.json into voice/
            --force             regenerate every clip, not only the changed lines
  info    <movie-dir>         print the timeline (times from the movie's start) and warnings, as JSON
  check   <movie-dir>         draw every frame without encoding; report errors and warnings
  frames  <movie-dir>         write a contact sheet of frames to <movie-dir>/out/sheet.png
            --at 1,2.5,4        times in seconds (default: evenly spaced)
            --count 12          number of evenly spaced frames (default 12)
            --full              also write each frame at full size
  render  <movie-dir>         render the movie to <movie-dir>/out/<name>.mp4, plus chapters.vtt
                              and chapters.txt in <movie-dir>/out/ when scenes have chapter titles
            -o FILE             output file
            --bitrate BPS       video bitrate in bits per second
  preview <movie-dir>         serve a player page with play/seek controls
            --port N            port (default 8573)
`;

function decodeDataUrl(u) {
  return Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      at: { type: 'string' }, count: { type: 'string' }, full: { type: 'boolean' },
      output: { type: 'string', short: 'o' }, bitrate: { type: 'string' }, port: { type: 'string' },
      force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, dirArg] = positionals;
  if (!cmd || values.help || cmd === 'help') { process.stdout.write(USAGE); return; }
  const log = (s) => process.stderr.write(`${s}\n`);

  if (cmd === 'setup') {
    const { setup } = await import('../lib/assets.js');
    await setup(log);
    log('installing Playwright Chromium');
    execFileSync(join(ROOT, 'node_modules', '.bin', 'playwright'), ['install', 'chromium'], { stdio: 'inherit' });
    return;
  }

  if (!dirArg) throw new Error(`${cmd} needs a movie directory`);
  const movieDir = resolve(dirArg);
  if (!existsSync(join(movieDir, 'script.json'))) throw new Error(`${movieDir} has no script.json`);
  const outDir = join(movieDir, 'out');

  if (cmd === 'voice') {
    const { generateVoice } = await import('../lib/voice.js');
    await generateVoice(movieDir, { force: values.force, log });
    return;
  }

  if (cmd === 'info') {
    // The timeline needs only script.json and the voice manifest, so info works before movie.js exists.
    const { buildTimeline } = await import('../runtime/timeline.js');
    const script = JSON.parse(await readFile(join(movieDir, 'script.json'), 'utf8'));
    const manifest = join(movieDir, 'voice', 'manifest.json');
    const tl = buildTimeline(script, existsSync(manifest) ? JSON.parse(await readFile(manifest, 'utf8')) : null);
    const info = {
      width: tl.width, height: tl.height, fps: tl.fps, duration: tl.duration, frames: tl.frames, credits: tl.credits,
      chapters: tl.chapters,
      scenes: tl.scenes.map((s) => ({
        id: s.id, start: s.start, end: s.end,
        lines: s.lines.map((l) => ({ id: l.id, start: l.start, end: l.end, text: l.text, caption: l.caption })),
      })),
      warnings: tl.warnings,
    };
    process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
    return;
  }

  if (cmd === 'preview') {
    const { startServer } = await import('../lib/server.js');
    const s = await startServer({ movieDir, port: Number(values.port ?? 8573) });
    log(`preview: ${s.url}  (Ctrl-C to stop)`);
    await new Promise(() => {});
  }

  const { withMovie, call } = await import('../lib/browser.js');

  if (cmd === 'check') {
    const started = Date.now();
    const r = await withMovie(movieDir, (page) => call(page, 'check'), { log });
    for (const w of r.warnings) log(`warning: ${w}`);
    for (const e of r.errors) {
      const when = e.from === e.to ? `${e.from.toFixed(2)}s` : `${e.from.toFixed(2)}s–${e.to.toFixed(2)}s`;
      log(`error at ${when} (frame ${e.frame}): ${e.message}\n${e.stack}`);
    }
    log(`checked ${r.frames} frames in ${((Date.now() - started) / 1000).toFixed(1)} s: ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
    if (r.errors.length) process.exitCode = 1;
    return;
  }

  if (cmd === 'frames') {
    await mkdir(outDir, { recursive: true });
    await withMovie(movieDir, async (page) => {
      const info = await call(page, 'info');
      const count = Number(values.count ?? 12);
      const times = values.at
        ? values.at.split(',').map(Number)
        : Array.from({ length: count }, (_, i) => Number((((i + 0.5) * info.duration) / count).toFixed(2)));
      const sheet = await call(page, 'sheet', times, 4, 480);
      await writeFile(join(outDir, 'sheet.png'), decodeDataUrl(sheet));
      log(`wrote ${join(outDir, 'sheet.png')} (${times.join(', ')} s)`);
      if (values.full) {
        for (const t of times) {
          const png = await call(page, 'still', t);
          const f = join(outDir, `frame-${t.toFixed(2)}.png`);
          await writeFile(f, decodeDataUrl(png));
          log(`wrote ${f}`);
        }
      }
      const warnings = await call(page, 'warnings');
      for (const w of warnings) log(`warning: ${w}`);
    }, { log });
    return;
  }

  if (cmd === 'render') {
    const out = resolve(values.output ?? join(outDir, `${basename(movieDir)}.mp4`));
    const started = Date.now();
    const result = await withMovie(movieDir, async (page, server) => {
      server.setOutput(out);
      return call(page, 'render', { bitrate: values.bitrate ? Number(values.bitrate) : undefined });
    }, { log });
    for (const w of result.warnings) log(`warning: ${w}`);
    log(`wrote ${out}: ${result.duration.toFixed(2)} s of video, ${(result.bytes / 1e6).toFixed(1)} MB, rendered in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const { writeChapterFiles } = await import('../lib/chapters.js');
    await writeChapterFiles(outDir, result.chapters, log);
    return;
  }

  throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
}

main().catch((e) => {
  process.stderr.write(`vvv: ${e?.message ?? e}\n`);
  process.exit(1);
});
