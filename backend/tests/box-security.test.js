import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/database.js';
import BoxModel from '../models/boxModel.js';
import boxController from '../controllers/boxController.js';

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
  pool.query = async () => [[]];
  let created;
  BoxModel.create = async input => { created = input; return input.idBox; };
  const res = response();
  await boxController.createBox({ body: { idBox: 'box-1', unit: 'Unit 1', ip: '127.0.0.1' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.is_online, 0);
  assert.equal(res.body.data.state, 'STATE_IDLE');
  assert.equal(created.ip, '127.0.0.1');
  assert.equal('device_token' in res.body.data, false);
  checkNetwork();
});

test('box registration requires a valid unique IPv4 address', async () => {
  BoxModel.create = async () => assert.fail('Invalid token reached storage');
  for (const ip of ['', 'not-an-ip', '0.0.0.0', '2001:db8::1']) {
    const res = response();
    await boxController.createBox({ body: { idBox: 'box-1', unit: 'Unit 1', ip } }, res);
    assert.equal(res.statusCode, 400);
  }
  pool.query = async () => [[{ id_box: 'another-box' }]];
  const duplicate = response();
  await boxController.createBox({ body: { idBox: 'box-1', unit: 'Unit 1', ip: '192.168.1.20' } }, duplicate);
  assert.equal(duplicate.statusCode, 409);
});

test('box registration accepts empty GPS fields as unknown and rejects invalid coordinates', async () => {
  pool.query = async () => [[]];
  let created;
  BoxModel.create = async input => { created = input; return input.idBox; };
  const res = response();
  await boxController.createBox({ body: { idBox: 'box-1', unit: 'Unit 1', ip: '192.168.1.20', lat: '', lng: '' } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(created.lat, null);
  assert.equal(created.lng, null);
  assert.equal(res.body.data.lat, null);
  BoxModel.create = async () => assert.fail('Invalid coordinate reached storage');
  for (const [lat, lng] of [[91, 100], [0, 181], ['not-a-number', 1], [false, 0], [[], 0]]) {
    const invalid = response();
    await boxController.createBox({ body: { idBox: 'box-1', unit: 'Unit 1', ip: '192.168.1.20', lat, lng } }, invalid);
    assert.equal(invalid.statusCode, 400);
  }
});

test('GPS lookup pulls and persists live status only for a registered private box IP', async () => {
  let updated = false;
  pool.query = async (sql, args) => {
    if (sql.includes('FROM boxes WHERE ip = ? LIMIT 2')) {
      assert.deepEqual(args, ['192.168.1.20']);
      return [[{ id_box: 'box-1', ip: args[0], state: 'STATE_IDLE', lat: null, lng: null,
        hw_data: JSON.stringify({ sd_card_ok: true, sd_sync_ok: true, ble_scan_ok: true, ble_tag_count: 3 }), is_online: 0, last_ping: null }]];
    }
    assert.match(sql, /UPDATE boxes SET/);
    assert.doesNotMatch(sql, /is_online\s*=\s*1|last_ping\s*=\s*NOW\(\)/i);
    assert.equal(args.at(-2), 'box-1');
    assert.equal(args.at(-1), '192.168.1.20');
    const hardware = JSON.parse(args[7]);
    assert.equal(hardware.sd_sync_ok, true);
    assert.equal(hardware.ble_tag_count, 3);
    assert.equal(hardware.gps_fix, true);
    updated = true;
    return [{ affectedRows: 1 }];
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'http://192.168.1.20/status');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return {
      ok: true,
      headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json' : null },
      text: async () => JSON.stringify({ id_box: 'box-1', ip: '192.168.1.20', state: 'WAIT_SPV',
        lat: -1.25, lng: 117.5, gps_fix: true, wifi_connected: true, relay_open: false,
        uptime_ms: 1234, queue: [] })
    };
  };
  const res = response();
  await boxController.probeDevice({ params: { ip: '192.168.1.20' } }, res, error => { throw error; });
  assert.equal(res.body.data.gps_fix, true);
  assert.equal(res.body.data.lat, -1.25);
  assert.equal(res.body.data.id_box, 'box-1');
  assert.equal(res.body.data.source, 'device');
  assert.equal(res.body.data.is_online, 1);
  assert.equal(res.body.data.telemetry_online, 0);
  assert.equal(res.body.data.telemetry_last_ping, null);
  assert.equal(JSON.parse(res.body.data.hw_data).sd_card_ok, true);
  assert.equal(updated, true);
});

test('GPS lookup never contacts unknown, duplicate or non-private addresses', async () => {
  const checkNetwork = noNetwork();
  for (const [rows, status] of [[[], 200], [[{}, {}], 409]]) {
    pool.query = async () => [rows];
    const res = response();
    await boxController.probeDevice({ params: { ip: '192.168.1.99' } }, res, error => { throw error; });
    assert.equal(res.statusCode, status);
  }
  pool.query = async () => [[{ id_box: 'box-1', ip: '127.0.0.1' }]];
  const blocked = response();
  await boxController.probeDevice({ params: { ip: '127.0.0.1' } }, blocked, error => { throw error; });
  assert.equal(blocked.statusCode, 400);
  checkNetwork();
});

test('GPS lookup falls back to the database when a registered ESP is unreachable or invalid', async () => {
  for (const snapshot of [{ is_online: 0, hw_data: '{"gps_fix":true}' }, { is_online: 1, hw_data: 'broken-json' }]) {
    pool.query = async () => [[{ id_box: 'box-1', ip: '192.168.1.20', lat: 1, lng: 117, ...snapshot }]];
    globalThis.fetch = async () => { throw new Error('device unavailable'); };
    const res = response();
    await boxController.probeDevice({ params: { ip: '192.168.1.20' } }, res, error => { throw error; });
    assert.equal(res.body.data.gps_fix, false);
    assert.equal(res.body.data.lat, null);
    assert.equal(res.body.data.lng, null);
    assert.equal(res.body.data.source, 'database');
  }
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
