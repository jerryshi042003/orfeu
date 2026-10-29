import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
