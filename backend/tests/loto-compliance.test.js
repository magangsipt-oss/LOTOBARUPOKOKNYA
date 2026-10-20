import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/database.js';
import controller from '../controllers/lotoComplianceController.js';

const originalConnection = pool.getConnection;
const originalQuery = pool.query;
afterEach(() => { pool.getConnection = originalConnection; pool.query = originalQuery; });
after(() => pool.end());

const mac = 'AA:BB:CC:DD:EE:01';
const secondMac = 'AA:BB:CC:DD:EE:02';
function response() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
async function invoke(method, body, extra = {}) {
  const res = response();
  await controller[method]({ body, params: {}, query: {}, ...extra }, res);
  return res;
}

function presenceFixture({ session = 7, boxExists = true, tags = [], queue = [], users = [], failSnapshot = false, previous = null } = {}) {
  const state = { queries: [], connections: 0, commits: 0, rollbacks: 0, releases: 0, events: [], snapshot: null };
  pool.getConnection = async () => {
    state.connections++;
    return {
      async beginTransaction() {},
      async commit() { state.commits++; },
      async rollback() { state.rollbacks++; },
      release() { state.releases++; },
      async query(sql, args = []) {
        state.queries.push([sql, args]);
        if (sql.startsWith('SELECT active_session_id')) {
          assert.match(sql, /WHERE id_box = \? FOR UPDATE$/);
          assert.deepEqual(args, ['BOX-1']);
          return [boxExists ? [{ active_session_id: session }] : []];
        }
        if (sql.startsWith('INSERT INTO ble_presence_log')) return [{ affectedRows: 1 }];
        if (sql.startsWith('SELECT bt.mac_address')) {
          assert.ok(args[0].length, 'empty scans must not issue an IN () lookup');
          assert.match(sql, /JOIN users u ON u.sid = bt.assigned_sid/);
          assert.match(sql, /bt.is_active = 1/);
          return [tags.filter(tag => args[0].includes(tag.mac_address) && tag.is_active !== false && users.some(user => user.sid === tag.assigned_sid))];
        }
        if (sql.includes('FROM queue q')) {
          assert.match(sql, /WHERE q.id_box = \? AND q.session_id = \?/);
          assert.match(sql, /COALESCE\(card_user.sid, sid_user.sid\)/);
          assert.match(sql, /card_user.rfid_uid = q.rfid_uid/);
          assert.deepEqual(args, ['BOX-1', session]);
          return [queue.filter(worker => worker.box === args[0] && worker.session === args[1]).map(worker => {
            const user = users.find(user => user.rfid_uid === worker.uid) || users.find(user => user.sid === worker.uid);
            return { sid: user?.sid ?? null };
          })];
        }
        if (sql.startsWith('SELECT session_id, slots, unknown_tags FROM loto_compliance')) {
          assert.deepEqual(args, ['BOX-1']);
          return [previous ? [previous] : []];
        }
        if (sql.startsWith('INSERT INTO ble_events')) {
          state.events.push(...args[0]);
          return [{ affectedRows: args[0].length }];
        }
        if (sql.startsWith('INSERT INTO loto_compliance')) {
          if (failSnapshot) throw new Error('simulated storage failure');
          state.snapshot = args;
          return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected fixture query: ${sql}`);
      }
    };
  };
  return state;
}

test('an empty BLE scan records zero detections without an empty SQL IN clause', async () => {
  const state = presenceFixture();
  const res = await invoke('reportPresence', { id_box: 'BOX-1', ble_tags: [] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.received_tag_count, 0);
  assert.equal(res.body.data.registered_tag_count, 0);
  assert.equal(res.body.data.ble_detected_count, 0);
  assert.equal(res.body.data.missing_count, 0);
  assert.deepEqual(res.body.data.detected_sids, []);
  assert.ok(state.queries.some(([sql]) => sql.startsWith('INSERT INTO loto_compliance')));
  assert.equal(state.commits, 1);
  assert.equal(state.releases, 1);
});

test('malformed BLE requests fail before opening a database connection', async () => {
  const state = presenceFixture();
  for (const body of [null, [], {}, { id_box: 'BOX-1', ble_tags: [null] }, { id_box: 'BOX-1', ble_tags: [4] }, { id_box: 'BOX-1', ble_tags: ['AA:BB'] }, { id_box: {}, ble_tags: [] }, { id_box: 'BOX-1', ble_tags: Array(101).fill(mac) }, { id_box: 'BOX-1', ble_tags: [], session_id: '7' }]) {
    const res = await invoke('reportPresence', body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(state.connections, 0);
});

test('BLE compliance resolves RFID to SID and counts people once across multiple tags', async () => {
  const state = presenceFixture({
    tags: [{ mac_address: mac, assigned_sid: 'SID-1' }, { mac_address: secondMac, assigned_sid: 'SID-1' }],
    users: [{ sid: 'SID-1', rfid_uid: 'RFID-1' }],
    queue: [{ box: 'BOX-1', session: 7, uid: 'RFID-1' }, { box: 'BOX-1', session: 7, uid: 'RFID-1' }]
  });
  const res = await invoke('reportPresence', { id_box: 'BOX-1', ble_tags: [mac.toLowerCase(), mac, secondMac], session_id: 7 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.received_tag_count, 2);
  assert.equal(res.body.data.registered_tag_count, 2);
  assert.equal(res.body.data.ble_detected_count, 1);
  assert.equal(res.body.data.loto_tapped_count, 1);
  assert.equal(res.body.data.missing_count, 0);
  assert.deepEqual(res.body.data.tapped_sids, ['SID-1']);
  assert.equal(state.queries.filter(([sql]) => sql.startsWith('INSERT INTO ble_presence_log')).length, 2);
  const snapshot = state.queries.find(([sql]) => sql.startsWith('INSERT INTO loto_compliance'))[1];
  assert.deepEqual(JSON.parse(snapshot[5]), ['SID-1']);
});

test('old sessions, other boxes and fuel-only taps cannot satisfy the live LOTO queue', async () => {
  const state = presenceFixture({
    tags: [{ mac_address: mac, assigned_sid: 'OLD' }, { mac_address: secondMac, assigned_sid: 'FUEL' }],
    users: [{ sid: 'OLD', rfid_uid: 'OLD-CARD' }, { sid: 'OTHER', rfid_uid: 'OTHER-CARD' }, { sid: 'CURRENT', rfid_uid: 'CURRENT-CARD' }, { sid: 'FUEL', rfid_uid: 'FUEL-CARD' }],
    queue: [{ box: 'BOX-1', session: 6, uid: 'OLD-CARD' }, { box: 'BOX-2', session: 7, uid: 'OTHER-CARD' }, { box: 'BOX-1', session: 7, uid: 'CURRENT' }]
  });
  const res = await invoke('reportPresence', { id_box: 'BOX-1', ble_tags: [mac, secondMac] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.tapped_sids, ['CURRENT']);
  assert.deepEqual(res.body.data.missing_sids, ['OLD', 'FUEL']);
  assert.ok(!state.queries.some(([sql]) => sql.includes('tapping_history')));
});

test('a box without an active session cannot inherit leftover queue entries', async () => {
  const state = presenceFixture({ session: null, tags: [{ mac_address: mac, assigned_sid: 'SID-1' }], users: [{ sid: 'SID-1', rfid_uid: 'RFID-1' }], queue: [{ box: 'BOX-1', session: null, uid: 'RFID-1' }] });
  const res = await invoke('reportPresence', { id_box: 'BOX-1', ble_tags: [mac], session_id: null });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.loto_tapped_count, 0);
  assert.deepEqual(res.body.data.missing_sids, ['SID-1']);
  assert.ok(!state.queries.some(([sql]) => sql.includes('FROM queue')));
});

test('unknown boxes and mismatched sessions reject scans without writing presence', async () => {
  for (const [options, session_id, status] of [[{ boxExists: false }, 7, 404], [{}, 6, 409], [{}, null, 409]]) {
    const state = presenceFixture(options);
    const res = await invoke('reportPresence', { id_box: 'BOX-1', ble_tags: [mac], session_id });
    assert.equal(res.statusCode, status);
    assert.ok(!state.queries.some(([sql]) => sql.startsWith('INSERT')));
    assert.equal(state.rollbacks, 1);
    assert.equal(state.releases, 1);
  }
});

test('failed compliance snapshots roll back presence and release the connection', async t => {
  t.mock.method(console, 'error', () => {});
  const state = presenceFixture({ failSnapshot: true });
  const res = await invoke('reportPresence', { id_box: 'BOX-1', ble_tags: [mac] });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'REQUEST_FAILED');
  assert.ok(!JSON.stringify(res.body).includes('storage failure'));
  assert.equal(state.commits, 0);
  assert.equal(state.rollbacks, 1);
  assert.equal(state.releases, 1);
});

test('tag registration rejects malformed MACs and oversized fields before querying', async () => {
  pool.query = async () => assert.fail('invalid tag must not query the database');
  for (const body of [{ mac_address: {} }, { mac_address: 'not-a-mac' }, { mac_address: 'AABBCCDDEE01' }, { mac_address: mac, assigned_sid: {} }, { mac_address: mac, tag_name: 'a'.repeat(101) }, { mac_address: mac, assigned_sid: 'a'.repeat(51) }]) {
    assert.equal((await invoke('registerTag', body)).statusCode, 400);
  }
});

test('tag registration normalizes MAC and verifies the assigned user', async () => {
  const statements = [];
  pool.query = async sql => sql.startsWith('SELECT DISTINCT id_box') ? [[]] : [{ affectedRows: 1 }];
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, args) {
      statements.push([sql, args]);
      if (sql.startsWith('SELECT sid')) return [[{ sid: 'SID-1' }]];
      if (sql.startsWith('SELECT id FROM ble_tags')) return [[]];
      return [{ affectedRows: 1 }];
    }
  });
  const res = await invoke('registerTag', { mac_address: ` ${mac.toLowerCase()} `, tag_name: ' Tag 1 ', assigned_sid: 'SID-1' });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body.data, { mac_address: mac, tag_name: 'Tag 1', assigned_sid: 'SID-1' });
  assert.deepEqual(statements.find(([sql]) => sql.startsWith('INSERT'))[1], [mac, 'Tag 1', 'SID-1']);
  assert.ok(statements.some(([sql]) => sql.includes('FOR UPDATE')));
});

test('an employee cannot be assigned a second active BLE tag', async () => {
  let inserted = false;
  let rolledBack = false;
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() { rolledBack = true; },
    release() {},
    async query(sql) {
      if (sql.startsWith('SELECT sid')) return [[{ sid: 'SID-1' }]];
      if (sql.startsWith('SELECT id FROM ble_tags')) return [[{ id: 8 }]];
      if (sql.startsWith('INSERT')) inserted = true;
      return [{ affectedRows: 1 }];
    }
  });
  const res = await invoke('registerTag', { mac_address: mac, assigned_sid: 'SID-1' });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /sudah memiliki BLE tag aktif/);
  assert.equal(inserted, false);
  assert.equal(rolledBack, true);
});

test('an inactive tag cannot be reactivated when the employee already has an active tag', async () => {
  let updated = false;
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      if (sql.startsWith('SELECT id, assigned_sid')) {
        return [[{ id: 1, assigned_sid: 'SID-1', is_active: 0 }]];
      }
      if (sql.startsWith('SELECT sid')) return [[{ sid: 'SID-1' }]];
      if (sql.startsWith('SELECT id FROM ble_tags')) return [[{ id: 2 }]];
      if (sql.startsWith('UPDATE ble_tags')) updated = true;
      return [{ affectedRows: 1 }];
    }
  });
  const res = await invoke('updateTag', { is_active: true }, { params: { id: '1' } });
  assert.equal(res.statusCode, 409);
  assert.equal(updated, false);
});

test('assigning a BLE tag refreshes compliance from recent presence immediately', async () => {
  const snapshots = [];
  pool.query = async sql => {
    if (sql.startsWith('SELECT id')) return [[]];
    if (sql.startsWith('SELECT DISTINCT id_box')) return [[{ id_box: 'BOX-1' }]];
    return [{ affectedRows: 1 }];
  };
  let registrationTransaction = true;
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, args) {
      if (registrationTransaction && sql.startsWith('SELECT sid')) return [[{ sid: 'SID-1' }]];
      if (registrationTransaction && sql.startsWith('SELECT id FROM ble_tags')) return [[]];
      if (registrationTransaction && sql.startsWith('INSERT INTO ble_tags')) {
        registrationTransaction = false;
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT active_session_id')) return [[{ active_session_id: 7 }]];
      if (sql.startsWith('SELECT DISTINCT u.sid')) return [[{ sid: 'SID-1' }]];
      if (sql.includes('FROM queue q')) return [[{ sid: 'SID-1' }]];
      if (sql.startsWith('INSERT INTO loto_compliance')) {
        snapshots.push({ sql, args });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected fixture query: ${sql}`);
    }
  });

  const res = await invoke('registerTag', { mac_address: mac, assigned_sid: 'SID-1' });
  assert.equal(res.statusCode, 201);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].args[0], 'BOX-1');
  assert.equal(snapshots[0].args[1], 1);
  assert.equal(snapshots[0].args[2], 1);
  assert.equal(snapshots[0].args[3], 0);
  assert.deepEqual(JSON.parse(snapshots[0].args[4]), ['SID-1']);
  assert.deepEqual(JSON.parse(snapshots[0].args[5]), ['SID-1']);
  assert.deepEqual(JSON.parse(snapshots[0].args[6]), []);
});

test('unknown user assignments fail without inserting or updating tags', async () => {
  const statements = [];
  pool.query = async () => [[]];
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT id, assigned_sid')) return [[{ id: 1, assigned_sid: null, is_active: 1 }]];
      return [[]];
    }
  });
  assert.equal((await invoke('registerTag', { mac_address: mac, assigned_sid: 'UNKNOWN' })).statusCode, 400);
  assert.equal((await invoke('updateTag', { assigned_sid: 'UNKNOWN' }, { params: { id: '1' } })).statusCode, 400);
  assert.ok(statements.every(sql => sql.startsWith('SELECT')));
});

test('a concurrent duplicate tag registration returns conflict instead of a server error', async () => {
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      if (sql.startsWith('INSERT')) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      return [[]];
    }
  });
  assert.equal((await invoke('registerTag', { mac_address: mac })).statusCode, 409);
});

test('tag updates support explicit unassignment and preserve omitted fields', async () => {
  const statements = [];
  pool.query = async sql => {
    if (sql.startsWith('SELECT DISTINCT id_box')) return [[]];
    return [{ affectedRows: 1 }];
  };
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, args) {
      if (sql.startsWith('SELECT id, assigned_sid')) {
        return [[{ id: 1, assigned_sid: 'SID-1', is_active: 1 }]];
      }
      statements.push([sql, args]);
      return [{ affectedRows: 1 }];
    }
  });
  assert.equal((await invoke('updateTag', { assigned_sid: null }, { params: { id: '1' } })).statusCode, 200);
  assert.deepEqual(statements[0], ['UPDATE ble_tags SET assigned_sid = ? WHERE id = ?', [null, 1]]);
  assert.equal((await invoke('updateTag', { is_active: false }, { params: { id: '1' } })).statusCode, 200);
  assert.deepEqual(statements[1], ['UPDATE ble_tags SET is_active = ? WHERE id = ?', [0, 1]]);
});

test('tag updates reject invalid IDs, no-op payloads and invalid active flags', async () => {
  pool.query = async () => assert.fail('invalid update must not query the database');
  for (const [id, body] of [['0', { is_active: true }], ['abc', { is_active: true }], ['1', {}], ['1', { is_active: 'false' }], ['1', { is_active: null }], ['1', { tag_name: [] }]]) {
    assert.equal((await invoke('updateTag', body, { params: { id } })).statusCode, 400);
  }
});

test('updating or deleting absent tags returns not found', async () => {
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql) {
      if (sql.startsWith('SELECT id, assigned_sid')) return [[]];
      return [{ affectedRows: 0 }];
    }
  });
  pool.query = async () => [{ affectedRows: 0 }];
  assert.equal((await invoke('updateTag', { is_active: true }, { params: { id: '1' } })).statusCode, 404);
  assert.equal((await invoke('deleteTag', undefined, { params: { id: '1' } })).statusCode, 404);
});

test('history limits are capped and invalid limits do not reach SQL', async () => {
  const statements = [];
  pool.query = async (sql, args) => { statements.push([sql, args]); return [[]]; };
  const res = await invoke('getComplianceHistory', undefined, { params: { idBox: 'BOX-1' }, query: { limit: '1000000' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(statements[0][1], ['BOX-1', 200]);
  for (const limit of ['-1', '0', '5x', '1.5', ['20', '30']]) {
    assert.equal((await invoke('getComplianceHistory', undefined, { params: { idBox: 'BOX-1' }, query: { limit } })).statusCode, 400);
  }
  assert.equal(statements.length, 1);
});

test('active BLE presence exposes its stable BLE tag number', async () => {
  const statements = [];
  pool.query = async (sql, args) => {
    statements.push([sql, args]);
    if (sql.includes('FROM ble_presence_log')) return [[{ ble_mac: mac, last_seen: '2026-10-07 10:00:00' }]];
    if (sql.includes('FROM ble_tags bt')) return [[{
      tag_id: 3, mac_address: mac, assigned_sid: 'SID-1', tag_name: null,
      nama: 'Mekanik 1', role: 'mekanik'
    }]];
    throw new Error(`Unexpected query: ${sql}`);
  };
  const res = await invoke('getActivePresence', undefined, { params: { idBox: 'BOX-1' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].tag_id, 3);
  assert.equal(res.body.data[0].assigned_sid, 'SID-1');
  assert.match(statements[0][0], /detected_at >= NOW\(\) - INTERVAL 15 SECOND/);
  assert.ok(statements[1][0].includes('bt.id AS tag_id'));
});

test('BLE presence history is scoped to the box, resolves tag owners, and caps results', async () => {
  const statements = [];
  pool.query = async (sql, args) => {
    statements.push([sql, args]);
    return [[{
      id: 9, id_box: 'BOX-1', ble_mac: mac, detected_at: '2026-10-09 08:30:00',
      tag_id: 3, tag_name: 'Tag Mekanik', assigned_sid: 'SID-1', nama: 'Mekanik 1', role: 'mekanik'
    }]];
  };
  const res = await invoke('getPresenceHistory', undefined, {
    params: { idBox: 'BOX-1' }, query: { limit: '1000000' }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].tag_id, 3);
  assert.equal(res.body.data[0].assigned_sid, 'SID-1');
  assert.deepEqual(statements[0][1], ['BOX-1', 200]);
  assert.match(statements[0][0], /WHERE p\.id_box = \?/);
  assert.match(statements[0][0], /ORDER BY p\.detected_at DESC, p\.id DESC/);

  for (const limit of ['0', '-1', '5x', ['20', '30']]) {
    assert.equal((await invoke('getPresenceHistory', undefined, {
      params: { idBox: 'BOX-1' }, query: { limit }
    })).statusCode, 400);
  }
  assert.equal(statements.length, 1);
});

test('tap-order BLE slots count bound iTags as tapped and flag tags nobody tapped for', async () => {
  const state = presenceFixture({ users: [{ sid: 'SPV1', rfid_uid: 'U1' }, { sid: 'MEK1', rfid_uid: 'U2' }] });
  const res = await invoke('reportPresence', {
    id_box: 'BOX-1',
    ble_tags: [mac, secondMac],
    ble_slots: [
      { slot: 1, sid: 'SPV1', uid: 'U1', mac, present: true, pending: false, rssi: -50 },
      { slot: 2, sid: 'MEK1', uid: 'U2', mac: null, present: false, pending: false }
    ]
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.detected_sids, ['SPV1']);
  assert.deepEqual(res.body.data.tapped_sids, ['SPV1', 'MEK1']);
  assert.equal(res.body.data.missing_count, 0);
  assert.deepEqual(res.body.data.unknown_tags, [secondMac]);
  // MEK1 tapped without an iTag, so one unknown tag may be theirs: not yet a violation.
  assert.equal(res.body.data.unidentified_count, 0);
  assert.deepEqual(state.events.map(row => row.slice(2)), [[1, 'SPV1', mac, 'TAG_BOUND'], [2, 'MEK1', null, 'TAG_NOT_FOUND'], [null, null, secondMac, 'UNKNOWN_TAG']]);
  assert.equal(JSON.parse(state.snapshot[8])[0].slot, 1);
});

test('an extra iTag beyond untagged taps is unidentified, and only changes are logged', async () => {
  const slots = [{ slot: 1, sid: 'SPV1', uid: 'U1', mac, present: true, pending: false, rssi: -50 }];
  const state = presenceFixture({ previous: { session_id: 7, slots: JSON.stringify(slots), unknown_tags: '[]' } });
  const res = await invoke('reportPresence', { id_box: 'BOX-1', ble_tags: [mac, secondMac], ble_slots: slots });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.unidentified_count, 1);
  assert.deepEqual(state.events.map(row => row.slice(2)), [[null, null, secondMac, 'UNKNOWN_TAG']]);
});

test('a lost bound iTag is logged once and pending bindings suppress unidentified warnings', async () => {
  const before = [{ slot: 1, sid: 'SPV1', mac, present: true, pending: false }];
  const state = presenceFixture({ previous: { session_id: 7, slots: JSON.stringify(before), unknown_tags: '[]' } });
  const res = await invoke('reportPresence', {
    id_box: 'BOX-1',
    ble_tags: [secondMac],
    ble_slots: [{ slot: 1, sid: 'SPV1', mac, present: false }, { slot: 2, sid: 'MEK1', mac: null, pending: true }]
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.unidentified_count, 0);
  assert.deepEqual(state.events.map(row => row.slice(2)), [[1, 'SPV1', mac, 'TAG_LOST'], [null, null, secondMac, 'UNKNOWN_TAG']]);
});

test('malformed BLE slots are rejected before touching the database', async () => {
  for (const ble_slots of [[{ slot: 0 }], [{ slot: 1 }, { slot: 1 }], [{ slot: 1, mac: 'bad' }], [{ slot: 1, present: 'yes' }], 'x']) {
    pool.getConnection = async () => { throw new Error('must not connect'); };
    const res = await invoke('reportPresence', { id_box: 'BOX-1', ble_tags: [], ble_slots });
    assert.equal(res.statusCode, 400, JSON.stringify(ble_slots));
  }
});

test('BLE event history is scoped to the box and caps its limit', async () => {
  let captured;
  pool.query = async (sql, args) => { captured = [sql, args]; return [[{ id: 1, event: 'TAG_BOUND' }]]; };
  const res = await invoke('getBleEvents', undefined, { params: { idBox: 'BOX-1' }, query: { limit: '999' } });
  assert.equal(res.statusCode, 200);
  assert.match(captured[0], /FROM ble_events e/);
  assert.deepEqual(captured[1], ['BOX-1', 200]);
});
