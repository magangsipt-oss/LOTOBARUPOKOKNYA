import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function runLauncher(config) {
  const directory = mkdtempSync(path.join(tmpdir(), 'eloto-start-'));
  try {
    copyFileSync(new URL('../start.js', import.meta.url), path.join(directory, 'start.mjs'));
    writeFileSync(path.join(directory, '.env'), config);
    const env = { ...process.env, ELOTO_PYTHON: '/nonexistent-eloto-python' };
    delete env.NODE_TEST_CONTEXT;
    delete env.ELOTO_RTSP_URL;
    return spawnSync(process.execPath, [path.join(directory, 'start.mjs')], { env, encoding: 'utf8' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('optional counting exits successfully without launching Python when unconfigured', () => {
  const result = runLauncher('');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Belum diaktifkan/);
  assert.match(result.stdout, /ELOTO_RTSP_URL/);
  assert.equal(result.stderr, '');
});

test('configured counting still reports a real Python startup failure', () => {
  const result = runLauncher('ELOTO_RTSP_URL=rtsp://camera/stream\n');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Python gagal dijalankan/);
  assert.doesNotMatch(result.stdout, /Belum diaktifkan/);
});
