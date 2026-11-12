import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const hseBody = {
  count: 3,
  results: [
    { sidCode: 'NEW01', name: 'Baru', status: 'AKTIF', functionalPosition: 'Mekanik', structuralPosition: 'Mekanik', rfidCardNo: '0000000007' },
    { sidCode: 'OLD01', name: 'Lama Baru', status: 'AKTIF', functionalPosition: 'Foreman/Group Leader', structuralPosition: 'Foreman Mekanik', rfidCardNo: '0000000008' },
    { sidCode: 'VIS01', name: 'Tamu', status: 'AKTIF', functionalPosition: 'Visitor', structuralPosition: 'VISITOR', rfidCardNo: '0000000009' },
  ],
};

function runImport(args, existing = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hse-import-'));
  const file = path.join(dir, 'hse.json');
  writeFileSync(file, JSON.stringify(hseBody));
  try {
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
      input: `
        import pool from './config/database.js';
        import CommandModel from './models/commandModel.js';
        const calls = { writes: [], commits: 0, rollbacks: 0, synced: [], closed: false };
        pool.query = async sql => {
          if (sql.startsWith('SELECT sid, nama, role, rfid_uid FROM users')) return [${JSON.stringify(existing)}];
          if (sql.startsWith('SELECT id_box FROM boxes')) return [[{ id_box: 'BOX-1' }]];
          throw new Error('unexpected pool query ' + sql);
        };
        pool.getConnection = async () => ({
          beginTransaction: async () => {},
          query: async (sql, params) => { calls.writes.push([sql.split(' ').slice(0, 2).join(' '), params[0], params.length]); return [{}]; },
          commit: async () => { calls.commits++; },
          rollback: async () => { calls.rollbacks++; },
          release: () => {},
        });
        CommandModel.setCommand = async (idBox, command) => { calls.synced.push([idBox, command]); return 'id'; };
        pool.end = async () => { calls.closed = true; };
        process.argv = [process.execPath, 'import-hse-employees.js', ...${JSON.stringify(args.map(arg => arg === '<file>' ? file : arg))}];
        await import('./scripts/import-hse-employees.js');
        console.log(JSON.stringify({ calls, exitCode: process.exitCode ?? 0 }));
      `,
    });
    assert.ifError(result.error);
    const lines = result.stdout.trim().split('\n');
    return { ...JSON.parse(lines.at(-1)), output: lines.slice(0, -1).join('\n'), stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('dry-run reports the plan without writing to the database', () => {
  const { calls, exitCode, output } = runImport(['<file>'], [{ sid: 'OLD01', nama: 'Lama', role: 'MEKANIK', rfid_uid: null }]);
  assert.equal(exitCode, 0);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(calls.synced, []);
  assert.equal(calls.closed, true);
  assert.match(output, /Lolos filter \(aktif \+ jabatan relevan\): 2/);
  assert.match(output, /1 baru, 1 diperbarui/);
  assert.match(output, /Dry-run/);
});

test('--apply writes updates then inserts in one transaction and asks boxes to resync', () => {
  const { calls, exitCode } = runImport(['<file>', '--apply'], [{ sid: 'OLD01', nama: 'Lama', role: 'MEKANIK', rfid_uid: null }]);
  assert.equal(exitCode, 0);
  assert.deepEqual(calls.writes.map(([verb, sid]) => [verb, sid]), [['UPDATE users', 'Lama Baru'], ['INSERT INTO', 'NEW01']]);
  assert.equal(calls.commits, 1);
  assert.equal(calls.rollbacks, 0);
  assert.deepEqual(calls.synced, [['BOX-1', 'SYNC_USERS']]);
});

test('missing file argument fails with usage and closes the pool', () => {
  const { calls, exitCode, stderr } = runImport([]);
  assert.equal(exitCode, 1);
  assert.match(stderr, /Pakai: pnpm --filter backend run import:hse/);
  assert.equal(calls.closed, true);
});
