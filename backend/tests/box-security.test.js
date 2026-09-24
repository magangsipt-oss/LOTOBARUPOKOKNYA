import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/database.js';
import BoxModel from '../models/boxModel.js';
import boxController from '../controllers/boxController.js';
import { hashToken } from '../security/session.js';

const originalQuery = pool.query;
const originalCreate = BoxModel.create;
const originalFetch = globalThis.fetch;
afterEach(() => { pool.query = originalQuery; BoxModel.create = originalCreate; globalThis.fetch = originalFetch; });
after(() => pool.end());
const response = () => ({ statusCode: 200, body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});
const noNetwork = () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Outbound request forbidden'); };
  return () => assert.equal(calls, 0);
};

test('registering a box never probes user-controlled IPs or trusts their status', async () => {
  const checkNetwork = noNetwork();
  let created;
  BoxModel.create = async input => { created = input; return input.idBox; };
  const res = response();
  await boxController.createBox({ body: { idBox: 'box-1', unit: 'Unit 1', ip: '127.0.0.1' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.is_online, 0);
  assert.equal(res.body.data.state, 'STATE_IDLE');
  assert.equal(created.device_token, hashToken(res.body.data.device_token));
  checkNetwork();
});

test('box registration rejects a device token that authentication would reject', async () => {
  BoxModel.create = async () => assert.fail('Invalid token reached storage');
  const res = response();
  await boxController.createBox({ body: { idBox: 'box-1', unit: 'Unit 1', device_token: 'short' } }, res);
  assert.equal(res.statusCode, 400);
});

test('box registration accepts empty GPS fields as unknown and rejects invalid coordinates', async () => {
  let created;
  BoxModel.create = async input => { created = input; return input.idBox; };
  const res = response();
  await boxController.createBox({ body: { idBox: 'box-1', unit: 'Unit 1', lat: '', lng: '' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(created.lat, null);
  assert.equal(created.lng, null);
  assert.equal(res.body.data.lat, null);
  BoxModel.create = async () => assert.fail('Invalid coordinate reached storage');
  for (const [lat, lng] of [[91, 100], [0, 181], ['not-a-number', 1], [false, 0], [[], 0]]) {
    const invalid = response();
    await boxController.createBox({ body: { idBox: 'box-1', unit: 'Unit 1', lat, lng } }, invalid);
    assert.equal(invalid.statusCode, 400);
  }
});

test('GPS lookup only uses a known, fresh authenticated snapshot, with no outbound requests', async () => {
  const checkNetwork = noNetwork();
  pool.query = async (sql, args) => {
    assert.match(sql, /FROM boxes WHERE ip = \? LIMIT 2/);
    assert.deepEqual(args, ['192.168.1.20']);
    return [[{ id_box: 'box-1', ip: args[0], state: 'STATE_IDLE', lat: '-1.25', lng: '117.5',
      hw_data: '{"gps_fix":true}', is_online: 1, last_ping: new Date() }]];
  };
  const res = response();
  await boxController.probeDevice({ params: { ip: '192.168.1.20' } }, res, error => { throw error; });
  assert.equal(res.body.data.gps_fix, true);
  assert.equal(res.body.data.lat, -1.25);
  assert.equal(res.body.data.id_box, 'box-1');
  checkNetwork();
});

test('GPS lookup reports unknown IP, duplicate IP, offline and invalid snapshots explicitly', async () => {
  const checkNetwork = noNetwork();
  for (const [rows, status] of [[[], 200], [[{}, {}], 409]]) {
    pool.query = async () => [rows];
    const res = response();
    await boxController.probeDevice({ params: { ip: '127.0.0.1' } }, res, error => { throw error; });
    assert.equal(res.statusCode, status);
  }
  for (const snapshot of [{ is_online: 0, hw_data: '{"gps_fix":true}' }, { is_online: 1, hw_data: 'broken-json' }]) {
    pool.query = async () => [[{ id_box: 'box-1', lat: 1, lng: 117, ...snapshot }]];
    const res = response();
    await boxController.probeDevice({ params: { ip: '127.0.0.1' } }, res, error => { throw error; });
    assert.equal(res.body.data.gps_fix, false);
    assert.equal(res.body.data.lat, null);
    assert.equal(res.body.data.lng, null);
  }
  checkNetwork();
});

test('deleting a box clears stale active sessions instead of rejecting the delete', async () => {
  const originalGetConnection = pool.getConnection;
  const fakeConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      if (sql.includes('SELECT active_session_id')) return [[{ active_session_id: 7, is_online: 0, last_ping: '2020-01-01 00:00:00' }]];
      if (sql.includes('UPDATE boxes SET active_session_id = NULL')) return [{ affectedRows: 1 }];
      if (sql.includes('DELETE FROM device_commands')) return [{ affectedRows: 0 }];
      if (sql.includes('DELETE FROM supervisor_box_team')) return [{ affectedRows: 0 }];
      if (sql.includes('DELETE FROM boxes WHERE id_box = ?')) return [{ affectedRows: 1 }];
      return [{ affectedRows: 0 }];
    }
  };
  pool.getConnection = async () => fakeConnection;
  try {
    const deleted = await BoxModel.delete('box-1');
    assert.equal(deleted, true);
  } finally {
    pool.getConnection = originalGetConnection;
  }
});
