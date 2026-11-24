// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inside, startServer } from '../../lib/server.js';

/** A raw HTTP request, so that tests control the path bytes and the Host header exactly. */
function raw(port, path, { method = 'GET', host = `localhost:${port}`, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host } }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('inside keeps paths in the root and rejects bad percent-encoding', () => {
  assert.equal(inside('/r', 'a/b.png'), '/r/a/b.png');
  assert.equal(inside('/r', '%E3%81%82.png'), '/r/あ.png');
  assert.equal(inside('/r', '../etc/passwd'), null);
  assert.equal(inside('/r', '%2e%2e/etc/passwd'), null);
  assert.equal(inside('/r', '100%.png'), undefined);
});

test('the server answers bad paths without crashing, and refuses other hosts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vvv-server-'));
  await writeFile(join(dir, 'a.txt'), 'hello');
  const s = await startServer({ movieDir: dir });
  const port = Number(new URL(s.url).port);
  try {
    assert.equal((await raw(port, '/movie/a.txt')).body, 'hello');
    assert.equal((await raw(port, '/movie/100%.png')).status, 400);
    assert.equal((await raw(port, '/movie/a.txt')).status, 200, 'still serving after a bad request');
    assert.equal((await raw(port, '/movie/a.txt', { host: `evil.example:${port}` })).status, 403);
    assert.equal((await raw(port, '/movie/voice/manifest.json')).status, 204);
    assert.equal((await raw(port, '/movie/music.json')).status, 204);
  } finally {
    await s.close();
  }
});

test('an upload replaces the output file whole, through a temporary file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vvv-upload-'));
  const s = await startServer({ movieDir: dir });
  const port = Number(new URL(s.url).port);
  try {
    assert.equal((await raw(port, '/__output', { method: 'POST', body: 'x' })).status, 409, 'no output path yet');
    const out = join(dir, 'out', 'movie.mp4');
    s.setOutput(out);
    assert.equal((await raw(port, '/__output', { method: 'POST', body: 'first' })).status, 200);
    assert.equal((await raw(port, '/__output', { method: 'POST', body: 'second' })).status, 200);
    assert.equal(await readFile(out, 'utf8'), 'second');
    assert.deepEqual(await readdir(join(dir, 'out')), ['movie.mp4']);
    s.setOutput(join(dir, 'a.txt', 'x.mp4'));
    await writeFile(join(dir, 'a.txt'), 'a file, not a directory');
    const r = await raw(port, '/__output', { method: 'POST', body: 'x' });
    assert.equal(r.status, 500);
    assert.match(r.body, /cannot write/);
  } finally {
    await s.close();
  }
});
