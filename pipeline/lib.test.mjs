import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeJson } from './lib.mjs';

test('writes an output when its parent directory does not exist, then replaces it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orfeu-output-'));
  try {
    const path = join(dir, 'reports', 'nested', 'result.json');
    writeJson(path, { kept: 3 });
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { kept: 3 });
    writeJson(path, { kept: 4 }, false);
    assert.equal(readFileSync(path, 'utf8'), '{"kept":4}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Copy the actual module so each cache lives outside the checkout. HTTP stays on loopback.
async function withCache(run) {
  const dir = mkdtempSync(join(tmpdir(), 'orfeu-cache-'));
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    const status = req.url === '/missing' ? 404 : req.url === '/failure' ? 500 : 200;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/null' ? null : { fixture: true }));
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const source = join(dir, 'lib.mjs');
    writeFileSync(source, readFileSync(new URL('./lib.mjs', import.meta.url)));
    mkdirSync(join(dir, '.cache'));
    const lib = await import(pathToFileURL(source));
    const url = path => `http://127.0.0.1:${server.address().port}${path}`;
    const file = url => join(dir, '.cache', createHash('sha1').update(url).digest('hex') + '.json');
    await run({ ...lib, url, file, requests: () => requests });
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    rmSync(dir, { recursive: true, force: true });
  }
}

test('valid success, null and not-found responses reuse the cache without extra requests', async () => {
  await withCache(async ({ getJson, isCached, url, requests }) => {
    for (const path of ['/success', '/null', '/missing']) {
      const target = url(path);
      const first = await getJson(target, { retries: 0 });
      assert.equal(first.status, path === '/missing' ? 404 : 200);
      assert.deepEqual(first.body, path === '/success' ? { fixture: true } : null);
      assert.equal(isCached(target), true);
      const before = requests();
      assert.deepEqual(await getJson(target), first);
      assert.equal(requests(), before);
    }
    assert.equal(requests(), 3);
  });
});

test('truncated cache is a miss, recovers once, then reuses the repaired result', async () => {
  await withCache(async ({ getJson, isCached, url, file, requests }) => {
    const target = url('/success');
    writeFileSync(file(target), '{"status":200,"body":');
    assert.equal(isCached(target), false, 'image lookup must use its paced network path');
    assert.deepEqual(await getJson(target, { retries: 0 }), { status: 200, body: { fixture: true } });
    assert.equal(requests(), 1);
    assert.equal(isCached(target), true);
    assert.deepEqual(await getJson(target), JSON.parse(readFileSync(file(target), 'utf8')));
    assert.equal(requests(), 1);
  });
});

test('valid JSON with an invalid cache envelope is also a miss', async () => {
  await withCache(async ({ getJson, isCached, url, file, requests }) => {
    const bad = [null, {}, { status: 500, body: null }, { status: 200 }];
    for (const [i, value] of bad.entries()) {
      const target = url(`/invalid-${i}`);
      writeFileSync(file(target), JSON.stringify(value));
      assert.equal(isCached(target), false);
      assert.equal((await getJson(target, { retries: 0 })).status, 200);
      assert.equal(isCached(target), true);
    }
    assert.equal(requests(), bad.length);
  });
});

test('a filesystem error stops before any HTTP request', async () => {
  await withCache(async ({ getJson, isCached, url, file, requests }) => {
    const target = url('/success');
    mkdirSync(file(target));
    assert.throws(() => isCached(target), { code: 'EISDIR' });
    await assert.rejects(getJson(target, { retries: 0 }), { code: 'EISDIR' });
    assert.equal(requests(), 0);
  });
});

test('explicit cache bypass neither reads nor overwrites the saved result', async () => {
  await withCache(async ({ getJson, url, file, requests }) => {
    const target = url('/success');
    const saved = JSON.stringify({ status: 200, body: { stored: true } });
    writeFileSync(file(target), saved);
    assert.deepEqual(await getJson(target, { cache: false, retries: 0 }), { status: 200, body: { fixture: true } });
    assert.equal(requests(), 1);
    assert.equal(readFileSync(file(target), 'utf8'), saved);
  });
});

test('transient HTTP failures are not admitted to the cache', async () => {
  await withCache(async ({ getJson, isCached, url, requests }) => {
    const target = url('/failure');
    assert.deepEqual(await getJson(target, { retries: 0 }), { status: 500, body: null });
    assert.equal(isCached(target), false);
    await getJson(target, { retries: 0 });
    assert.equal(requests(), 2);
  });
});
