// @ts-check
// Third-party assets that VVV downloads, each pinned by URL and SHA-256.
// They live in the cache directory, never in the repository.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const CACHE = process.env.VVV_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'vvv');

const PIPER_VERSION = '2.1.0';
const TSUKUYOMI = 'https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan/resolve/93c1fb6d67c29accc9ddf52326bb4582b1b52a3d/releases/zs-v1';

const PIPER_DIR = join(CACHE, `piper-plus-${PIPER_VERSION}`);

export const PIPER = {
  version: PIPER_VERSION,
  dir: PIPER_DIR,
  bin: join(PIPER_DIR, 'bin', 'piper-plus'),
  url: `https://github.com/ayutaz/piper-plus/releases/download/v${PIPER_VERSION}/piper-plus-cpp-linux-x64.tar.gz`,
  sha256: '65713616c673b5a19b7f488b75d155e2fdfe21b81ba66c2b3f9fa042a4304599',
};

/** Voice models. Each one's credit must appear in every video that uses it. */
export const VOICES = {
  tsukuyomi: {
    dir: join(CACHE, 'voices', 'tsukuyomi-zs-v1'),
    credit: '音声: Piper Plus:つくよみちゃん',
    languages: ['ja', 'en', 'zh', 'es', 'fr', 'pt'],
    files: {
      'tsukuyomi.onnx': { url: `${TSUKUYOMI}/tsukuyomi.onnx`, sha256: '5fcef335c2bd69a4d2b5512e46d971427a653bf252097e2fb73618e7a584f331' },
      'tsukuyomi.onnx.json': { url: `${TSUKUYOMI}/tsukuyomi.onnx.json`, sha256: '055a837f6b77294789f8600ec0d0d6183b128e99023dca20f20f7f662b881b8b' },
    },
    model: 'tsukuyomi.onnx',
  },
};

export const FONT = {
  dir: join(CACHE, 'fonts'),
  file: 'NotoSansJP-VF.ttf',
  path: join(CACHE, 'fonts', 'NotoSansJP-VF.ttf'),
  url: 'https://raw.githubusercontent.com/google/fonts/66a36c8c94b1a5d992ee4e7f392fccfe4945767c/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf',
  sha256: 'c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f',
};

/** Download url, check its SHA-256, and write it to dest. dest appears only when the whole file is good. */
async function download(url, sha256, dest, log) {
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  const got = createHash('sha256').update(body).digest('hex');
  if (got !== sha256) throw new Error(`SHA-256 mismatch for ${url}: expected ${sha256}, got ${got}`);
  const tmp = `${dest}.part`;
  await writeFile(tmp, body);
  await rename(tmp, dest);
}

/** Download and verify everything that is missing. Safe to run repeatedly. */
export async function setup(log = console.error) {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(`VVV supports only Linux x64 for now (this is ${process.platform}/${process.arch})`);
  }
  await mkdir(CACHE, { recursive: true });

  // Extract into a temporary directory and rename it when tar succeeds, so that an
  // interrupted setup never leaves a directory that looks installed.
  if (!existsSync(PIPER.dir)) {
    const tgz = join(CACHE, `piper-plus-${PIPER.version}.tar.gz`);
    const tmp = `${PIPER.dir}.part`;
    try {
      await download(PIPER.url, PIPER.sha256, tgz, log);
      await rm(tmp, { recursive: true, force: true });
      await mkdir(tmp, { recursive: true });
      execFileSync('tar', ['xzf', tgz, '-C', tmp, '--strip-components=1']);
      await rename(tmp, PIPER.dir);
    } finally {
      await rm(tgz, { force: true });
      await rm(tmp, { recursive: true, force: true });
    }
  }

  for (const v of Object.values(VOICES)) {
    await mkdir(v.dir, { recursive: true });
    for (const [name, f] of Object.entries(v.files)) {
      const dest = join(v.dir, name);
      if (!existsSync(dest)) await download(f.url, f.sha256, dest, log);
    }
  }

  await mkdir(FONT.dir, { recursive: true });
  if (!existsSync(FONT.path)) await download(FONT.url, FONT.sha256, FONT.path, log);
  log(`assets are ready in ${CACHE}`);
}

/** Throw, naming what is missing, unless setup has installed every asset. */
export function assertReady() {
  const missing = [PIPER.bin, FONT.path,
    ...Object.values(VOICES).flatMap((v) => Object.keys(v.files).map((n) => join(v.dir, n)))].filter((p) => !existsSync(p));
  if (missing.length) throw new Error(`missing assets (run "vvv setup"):\n  ${missing.join('\n  ')}`);
}
