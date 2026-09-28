import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function runBootstrap({ args = ['--seed'], sid, name, password = 'correct horse battery staple', existing = null } = {}) {
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    cwd: new URL('../', import.meta.url),
    encoding: 'utf8',
    input: `
      import pool from './config/database.js';
      import UserModel from './models/userModel.js';
      delete process.env.ELOTO_USER_SID;
      delete process.env.ELOTO_USER_NAME;
      delete process.env.ELOTO_NEW_PASSWORD;
      const settings = ${JSON.stringify({ sid, name, password })};
      if (settings.sid !== undefined) process.env.ELOTO_USER_SID = settings.sid;
      if (settings.name !== undefined) process.env.ELOTO_USER_NAME = settings.name;
      if (settings.password !== undefined && settings.password !== null) process.env.ELOTO_NEW_PASSWORD = settings.password;
      process.argv = [process.execPath, 'bootstrap-admin.js', ...${JSON.stringify(args)}];
      const calls = { lookups: [], created: [], closed: false };
      UserModel.getBySid = async sid => { calls.lookups.push(sid); return ${JSON.stringify(existing)}; };
      UserModel.create = async user => { calls.created.push(user); };
      pool.end = async () => { calls.closed = true; };
      await import('./scripts/bootstrap-admin.js');
      console.log(JSON.stringify(calls));
    `
  });
  assert.ifError(result.error);
  const calls = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(calls.closed, true);
  return { ...result, calls };
}

test('admin seeding requires a strong password and accepts a custom SID and name', () => {
  const defaultResult = runBootstrap();
  assert.equal(defaultResult.status, 0);
  assert.deepEqual(defaultResult.calls.created, [{ sid: 'Admin', nama: 'Administrator', role: 'ADMIN', password: 'correct horse battery staple' }]);
  const customResult = runBootstrap({ sid: 'ADMIN02', name: 'Custom Administrator', password: 'another strong password' });
  assert.equal(customResult.status, 0);
  assert.deepEqual(customResult.calls.lookups, ['ADMIN02']);
  assert.deepEqual(customResult.calls.created, [{ sid: 'ADMIN02', nama: 'Custom Administrator', role: 'ADMIN', password: 'another strong password' }]);
  const weakResult = runBootstrap({ password: 'short' });
  assert.equal(weakResult.status, 1);
  assert.deepEqual(weakResult.calls.created, []);
  assert.match(weakResult.stderr, /ELOTO_NEW_PASSWORD/);
});

test('admin seeding skips an existing admin without replacing its password', () => {
  const result = runBootstrap({ existing: { sid: 'Admin', role: 'ADMIN' } });
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls.created, []);
  assert.match(result.stdout, /already exists; skipped/);
});

test('admin seeding rejects a SID belonging to a non-admin', () => {
  const result = runBootstrap({ existing: { sid: 'Admin', role: 'WORKER' } });
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls.created, []);
  assert.match(result.stderr, /non-admin user/);
});

test('bootstrap still requires an explicit SID and rejects an existing user', () => {
  const missing = runBootstrap({ args: [], password: null });
  assert.equal(missing.status, 1);
  assert.deepEqual(missing.calls.lookups, []);
  const existing = runBootstrap({ args: [], sid: 'Admin', existing: { sid: 'Admin', role: 'ADMIN' } });
  assert.equal(existing.status, 1);
  assert.deepEqual(existing.calls.created, []);
  assert.match(existing.stderr, /use reset-password/);
});
