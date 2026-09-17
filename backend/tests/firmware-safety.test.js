import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('firmware host helpers preserve replay identity and reject corrupt restore/host input', t => {
  try { execFileSync('g++', ['--version'], { stdio: 'ignore' }); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('g++ unavailable; Arduino sketch compilation and hardware validation remain separate');
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), 'eloto-firmware-test-'));
  try {
    const binary = join(directory, 'firmware-safety');
    const source = fileURLToPath(new URL('../../esp32/tests/firmware-safety.test.cpp', import.meta.url));
    execFileSync('g++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', source, '-o', binary], { stdio: 'inherit' });
    assert.doesNotThrow(() => execFileSync(binary, { stdio: 'inherit' }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
