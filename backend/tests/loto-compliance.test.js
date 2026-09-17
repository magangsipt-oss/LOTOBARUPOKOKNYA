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

function presenceFixture({ session = 7, boxExists = true, tags = [], queue = [], users = [], failSnapshot = false } = {}) {
  const state = { queries: [], connections: 0, commits: 0, rollbacks: 0, releases: 0 };
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
        if (sql.startsWith('INSERT INTO loto_compliance')) {
          if (failSnapshot) throw new Error('simulated storage failure');
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
  pool.query = async (sql, args) => {
    statements.push([sql, args]);
    if (sql.startsWith('SELECT id')) return [[]];
    if (sql.startsWith('SELECT sid')) return [[{ sid: 'SID-1' }]];
    return [{ affectedRows: 1 }];
  };
  const res = await invoke('registerTag', { mac_address: ` ${mac.toLowerCase()} `, tag_name: ' Tag 1 ', assigned_sid: 'SID-1' });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body.data, { mac_address: mac, tag_name: 'Tag 1', assigned_sid: 'SID-1' });
  assert.deepEqual(statements.find(([sql]) => sql.startsWith('INSERT'))[1], [mac, 'Tag 1', 'SID-1']);
});

test('unknown user assignments fail without inserting or updating tags', async () => {
  const statements = [];
  pool.query = async sql => { statements.push(sql); return [[]]; };
  assert.equal((await invoke('registerTag', { mac_address: mac, assigned_sid: 'UNKNOWN' })).statusCode, 400);
  assert.equal((await invoke('updateTag', { assigned_sid: 'UNKNOWN' }, { params: { id: '1' } })).statusCode, 400);
  assert.ok(statements.every(sql => sql.startsWith('SELECT')));
});

test('a concurrent duplicate tag registration returns conflict instead of a server error', async () => {
  pool.query = async sql => {
    if (sql.startsWith('SELECT')) return [[]];
    throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
  };
  assert.equal((await invoke('registerTag', { mac_address: mac })).statusCode, 409);
});

test('tag updates support explicit unassignment and preserve omitted fields', async () => {
  const statements = [];
  pool.query = async (sql, args) => { statements.push([sql, args]); return [{ affectedRows: 1 }]; };
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
