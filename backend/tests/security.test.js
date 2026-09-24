import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import pool from '../config/database.js';
import UserModel from '../models/userModel.js';
import { hashToken, csrfToken, normalizeRole } from '../security/session.js';
import { validateTelemetry, normalizeState } from '../domain/telemetry.js';

const originalQuery = pool.query;
const originalAuthenticate = UserModel.authenticate;
const token = 'a'.repeat(64);
const deviceToken = 'device-test-token-'.repeat(4);
const user = { sid: 'worker-1', nama: 'Test Worker', role: 'WORKER', rfid_uid: 'ABC' };
let server, base, sessions = new Map(), statements = [];
before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  pool.query = async (sql, params = []) => {
    statements.push([sql, params]);
    if (sql.includes('FROM web_sessions s JOIN users')) return [[sessions.get(params[0])].filter(Boolean)];
    if (sql.includes('SELECT id_box FROM boxes WHERE device_token')) return [params[0] === hashToken(deviceToken) ? [{ id_box: 'BOX ELOTO 1' }] : []];
    if (sql.startsWith('INSERT INTO web_sessions')) { sessions.set(params[0], user); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('DELETE FROM web_sessions WHERE token_hash')) sessions.delete(params[0]);
    return [{ affectedRows: 1 }];
  };
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => { UserModel.authenticate = originalAuthenticate; statements = []; sessions.clear(); });
after(async () => { await new Promise(resolve => server.close(resolve)); pool.query = originalQuery; await pool.end(); });
const call = (path, options = {}) => fetch(base + path, options);
const authHeaders = (role = 'WORKER') => {
  sessions.set(hashToken(token), { ...user, role });
  return { Cookie: `eloto_session=${token}`, 'X-CSRF-Token': csrfToken(token), 'Content-Type': 'application/json' };
};

test('anonymous users cannot read or mutate protected data, even without API_SECRET_KEY', async () => {
  delete process.env.API_SECRET_KEY;
  for (const [path, method] of [['/api/users','GET'],['/api/users','POST'],['/api/logs/clear','DELETE'],['/api/maintenance','POST'],['/api/stream','GET']]) {
    assert.equal((await call(path,{method})).status,401);
  }
  assert.equal(statements.length,0);
});
test('login reaches authenticate, issues HttpOnly cookie, restores server identity and logs out', async () => {
  UserModel.authenticate = async (sid,password) => { assert.equal(sid,'worker-1'); assert.equal(password,'correct-password'); return user; };
  const login = await call('/api/users/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:'worker-1',password:'correct-password'})});
  assert.equal(login.status,200);
  const body = await login.json();
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/); assert.match(cookie,/SameSite=Lax/);
  const headers = { Cookie: cookie.split(';')[0], 'X-CSRF-Token': body.csrfToken };
  assert.equal((await call('/api/users/me',{headers})).status,200);
  assert.equal((await call('/api/users/logout',{method:'POST',headers})).status,200);
  assert.equal((await call('/api/users/me',{headers})).status,401);
});
test('CSRF and role checks reject unauthorized writes before models execute', async () => {
  const headers = authHeaders();
  assert.equal((await call('/api/users/victim',{method:'DELETE',headers})).status,403);
  assert.equal((await call('/api/users/worker-1',{method:'PUT',headers,body:JSON.stringify({role:'admin'})})).status,403);
  delete headers['X-CSRF-Token'];
  assert.equal((await call('/api/users/logout',{method:'POST',headers})).status,403);
  assert.ok(!statements.some(([sql])=>sql.startsWith('DELETE FROM users')||sql.startsWith('UPDATE users')));
});
test('untrusted origins and old shared Bearer token cannot authorize requests', async () => {
  assert.equal((await call('/api/users/login',{method:'POST',headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await call('/api/users',{headers:{Authorization:'Bearer ELOTO_SECURE_KEY_2026'}})).status,401);
});
test('device tokens are scoped to their own box and cannot administer accounts', async () => {
  const headers = {'X-Device-Token':deviceToken,'Content-Type':'application/json'};
  assert.equal((await call('/api/boxes/BOX%20ELOTO%202/telemetry',{method:'POST',headers,body:'{}'})).status,403);
  assert.equal((await call('/api/users',{method:'POST',headers,body:'{}'})).status,403);
  assert.equal((await call('/api/boxes/BOX%20ELOTO%201/telemetry',{method:'POST',headers,body:'{}'})).status,400);
});
test('unknown device tokens cannot claim unconfigured boxes or register new boxes', async () => {
  const query = pool.query;
  const queries = [];
  pool.query = async (sql, args) => {
    queries.push(sql);
    if (sql.includes('device_token IS NULL')) return [[{ id_box: 'unconfigured' }]];
    if (sql === 'SELECT id_box FROM boxes WHERE id_box = ?') return [[]];
    return query(sql, args);
  };
  try {
    const headers = { 'X-Device-Token': 'unknown-device-token-'.repeat(4), 'Content-Type': 'application/json' };
    for (const id of ['unconfigured', 'new-box']) {
      const response = await call(`/api/boxes/${id}/telemetry`, { method: 'POST', headers,
        body: JSON.stringify({ id_box: id, ip: '192.168.1.20', event_id: 'untrusted-event' }) });
      assert.equal(response.status, 401);
    }
    assert.ok(!queries.some(sql => /^(INSERT|UPDATE|DELETE)/.test(sql)));
  } finally { pool.query = query; }
});
test('probe for an unregistered IP returns a safe offline payload instead of 404', async () => {
  const query = pool.query;
  pool.query = async (sql, args) => {
    if (sql.includes('FROM boxes WHERE ip = ? LIMIT 2')) return [[]];
    return query(sql, args);
  };
  try {
    const headers = authHeaders();
    const response = await call('/api/boxes/probe/192.168.137.64', { headers });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.is_online, 0);
    assert.equal(body.data.stale, true);
  } finally { pool.query = query; }
});
test('device identity in telemetry body must match the token and URL', async () => {
  const response = await call('/api/boxes/BOX%20ELOTO%201/telemetry', {
    method: 'POST', headers: { 'X-Device-Token': deviceToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_box: 'BOX ELOTO 2', event_id: 'wrong-box' })
  });
  assert.equal(response.status, 403);
});
test('fabricated/expired sessions are rejected', async () => {
  assert.equal((await call('/api/users/me',{headers:{Cookie:`eloto_session=${token}`}})).status,401);
});
test('telemetry rejects malformed numbers, unbounded queues and missing event IDs', () => {
  assert.throws(()=>validateTelemetry({}),/event_id/);
  assert.throws(()=>validateTelemetry({event_id:'bad id'}),/event_id/);
  assert.throws(()=>validateTelemetry({event_id:'x'.repeat(101)}),/event_id/);
  assert.throws(()=>validateTelemetry({event_id:'event-1',lat:NaN}),/lat/);
  assert.throws(()=>validateTelemetry({event_id:'event-1',relay_open:'false'}),/relay/);
  assert.throws(()=>validateTelemetry({event_id:'event-1',gps_fix:true}),/GPS fix/);
  assert.throws(()=>validateTelemetry({event_id:'event-1',gps_fix:1,lat:0,lng:null}),/GPS fix/);
  assert.doesNotThrow(()=>validateTelemetry({event_id:'event-1',gps_fix:true,lat:0,lng:0}));
  assert.doesNotThrow(()=>validateTelemetry({event_id:'event-1',gps_fix:false,lat:null,lng:null}));
  assert.equal(normalizeState('LOCKED_ACTIVE'),'STATE_LOTO_LOCKED_ACTIVE');
  assert.equal(normalizeState('WAIT_SPV'),'STATE_WAIT_SPV_IN');
  assert.equal(normalizeState('SPV_OUT_CONFIRM'),'STATE_SPV_OUT_CONFIRM');
  assert.equal(normalizeState('COUNTDOWN'),'STATE_COUNTDOWN');
  assert.equal(normalizeState('WELCOME'),'STATE_WELCOME');
  assert.equal(normalizeState('BOOT_IP'),'STATE_BOOT_IP');
  assert.equal(normalizeRole('not-admin'),null);
});
test('profile edits without fingerprint do not overwrite its existing value', async () => {
  await UserModel.update('worker-1',{nama:'Changed',role:'WORKER',rfidUid:'ABC'});
  const [sql,params] = statements.at(-1);
  assert.match(sql,/fp_id = COALESCE\(\?, fp_id\)/);
  assert.equal(params[3],null);
});

test('worker maintenance form accepts the frontend id_box contract', async () => {
  const headers = authHeaders();
  const response = await call('/api/maintenance', { method: 'POST', headers, body: JSON.stringify({ id_box: 'BOX ELOTO 1', jenis: 'Mekanikal', estimasi: '2 Jam', teknisi: 'Test Worker', pengawas: 'Supervisor', deskripsi: 'Service', status: 'PROSES' }) });
  assert.equal(response.status, 201);
  const insert = statements.find(([sql]) => sql.includes('INSERT INTO maintenance_logs'));
  assert.equal(insert[1][0], 'BOX ELOTO 1');
});
test('unknown camera state is explicit, rather than reporting zero detected people', async () => {
  const headers = authHeaders();
  const query = pool.query;
  pool.query = async (sql, args) => sql.includes('FROM people_counting_latest') ? [[]] : query(sql, args);
  try {
    const response = await call('/api/logs/people-counting/BOX%20ELOTO%201', { headers });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.detected_count, null); assert.equal(data.stale, true);
  } finally { pool.query = query; }
});
