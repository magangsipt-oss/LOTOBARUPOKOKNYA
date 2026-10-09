import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import pool from '../config/database.js';
import UserModel from '../models/userModel.js';
import { hashToken, csrfToken, normalizeRole } from '../security/session.js';
import { validateTelemetry, normalizeState } from '../domain/telemetry.js';

const originalQuery = pool.query;
const originalGetConnection = pool.getConnection;
const originalAuthenticate = UserModel.authenticate;
const originalCreate = UserModel.create;
const token = 'a'.repeat(64);
const user = { sid: 'worker-1', nama: 'Test Worker', role: 'WORKER', rfid_uid: 'ABC' };
let server, base, sessions = new Map(), statements = [];
before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.FRONTEND_URL = 'http://localhost:3000';
  pool.query = async (sql, params = []) => {
    statements.push([sql, params]);
    if (sql.includes('FROM web_sessions s JOIN users')) return [[sessions.get(params[0])].filter(Boolean)];
    if (sql.includes('SELECT id_box FROM boxes WHERE id_box = ?')) return [params[0] === 'BOX ELOTO 1' ? [{ id_box: params[0] }] : []];
    if (sql.startsWith('INSERT INTO web_sessions')) { sessions.set(params[0], user); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('DELETE FROM web_sessions WHERE token_hash')) sessions.delete(params[0]);
    return [{ affectedRows: 1 }];
  };
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => { UserModel.authenticate = originalAuthenticate; UserModel.create = originalCreate; statements = []; sessions.clear(); });
after(async () => { await new Promise(resolve => server.close(resolve)); pool.query = originalQuery; await pool.end(); });
const call = (path, options = {}) => fetch(base + path, options);
const authHeaders = (role = 'WORKER') => {
  sessions.set(hashToken(token), { ...user, role });
  return { Cookie: `eloto_session=${token}`, 'X-CSRF-Token': csrfToken(token), 'Content-Type': 'application/json' };
};

test('production defaults to trusting only the loopback reverse proxy', () => {
  const keys = ['NODE_ENV', 'FRONTEND_URL', 'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'TRUST_PROXY', 'MJPEG_PORTS'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://eloto.example.com',
      DB_HOST: '127.0.0.1',
      DB_NAME: 'eloto_test',
      DB_USER: 'eloto_app',
      DB_PASSWORD: 'test-only-password',
      TRUST_PROXY: '',
      MJPEG_PORTS: '{}'
    });
    delete process.env.TRUST_PROXY;
    const app = createApp();
    assert.deepEqual(app.get('trust proxy'), ['loopback']);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('anonymous users cannot read or mutate protected data, even without API_SECRET_KEY', async () => {
  delete process.env.API_SECRET_KEY;
  for (const [path, method] of [['/api/users','GET'],['/api/users','POST'],['/api/logs/clear','DELETE'],['/api/maintenance','POST'],['/api/stream','GET'],['/api/diagnostic/device','GET']]) {
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
test('account creation allows SID as password while password changes reject weak passwords', async () => {
  const headers = authHeaders('ADMIN');
  const createdUsers = [];
  UserModel.create = async data => {
    createdUsers.push(data);
    return originalCreate(data);
  };
  const weakCreate = await call('/api/users', { method: 'POST', headers,
    body: JSON.stringify({ sid: 'new-user', nama: 'New User', role: 'WORKER', password: 'short' }) });
  assert.equal(weakCreate.status, 400);
  assert.equal(createdUsers.length, 0);
  const sidPasswordCreate = await call('/api/users', { method: 'POST', headers,
    body: JSON.stringify({ sid: 'new-user', nama: 'New User', role: 'WORKER', password: 'new-user' }) });
  assert.equal(sidPasswordCreate.status, 201);
  assert.equal(createdUsers[0].password, 'new-user');
  const insertedUser = statements.find(([sql]) => sql.includes('INSERT INTO users'));
  assert.ok(insertedUser[1][5].startsWith('$2'));
  const strongCreate = await call('/api/users', { method: 'POST', headers,
    body: JSON.stringify({ sid: 'new-user', nama: 'New User', role: 'WORKER', password: 'correct horse battery staple' }) });
  assert.equal(strongCreate.status, 201);
  assert.equal(createdUsers[1].password, 'correct horse battery staple');
  const weakChange = await call('/api/users/password', { method: 'POST', headers,
    body: JSON.stringify({ currentPassword: 'old password', newPassword: 'too-short' }) });
  assert.equal(weakChange.status, 400);
});
test('untrusted origins and old shared Bearer token cannot authorize requests', async () => {
  assert.equal((await call('/api/users/login',{method:'POST',headers:{Origin:'https://evil.invalid'}})).status,403);
  assert.equal((await call('/api/users',{headers:{Authorization:'Bearer ELOTO_SECURE_KEY_2026'}})).status,401);
});
test('local frontend origins receive credentialed CORS headers in development', async () => {
  for (const origin of ['http://localhost:3000', 'http://192.168.137.10:3000']) {
    const response = await call('/api/users/login', { method: 'OPTIONS', headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type'
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  }
});
test('device identity headers are scoped to their own box and cannot administer accounts', async () => {
  const headers = {'X-Device-Id':'BOX ELOTO 1','Content-Type':'application/json'};
  assert.equal((await call('/api/boxes/BOX%20ELOTO%202/telemetry',{method:'POST',headers,body:'{}'})).status,403);
  assert.equal((await call('/api/users',{method:'POST',headers,body:'{}'})).status,403);
  assert.equal((await call('/api/boxes/BOX%20ELOTO%201/telemetry',{method:'POST',headers,body:'{}'})).status,400);
});
test('device handshake is scoped to the identified box and publishes the telemetry contract', async () => {
  const headers = { 'X-Device-Id': 'BOX ELOTO 1' };
  const response = await call('/api/boxes/BOX%20ELOTO%201/device-handshake', { headers });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, {
    contract: 'eloto-device-v1',
    id_box: 'BOX ELOTO 1',
    telemetry_endpoint: '/api/boxes/BOX%20ELOTO%201/telemetry'
  });
  assert.equal((await call('/api/boxes/BOX%20ELOTO%202/device-handshake', { headers })).status, 403);
});
test('device pending-card sync is box-scoped and idempotent', async () => {
  const stored = new Set();
  const statementsSeen = [];
  let registered = false;
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      statementsSeen.push([sql, params]);
      if (sql.includes('SELECT id_box FROM boxes')) return [[{ id_box: params[0] }]];
      if (sql.includes('FROM users')) return [registered ? [{ sid: 'worker-1' }] : []];
      if (sql.includes('SELECT id FROM rfid_buffer')) return [stored.has(params[1]) ? [{ id: 1 }] : []];
      if (sql.startsWith('INSERT INTO rfid_buffer')) stored.add(params[1]);
      if (sql.startsWith('DELETE FROM rfid_buffer')) stored.delete(params[1]);
      return [{ affectedRows: 1 }];
    }
  });
  try {
    const headers = { 'X-Device-Id': 'BOX ELOTO 1', 'Content-Type': 'application/json' };
    const path = '/api/boxes/BOX%20ELOTO%201/pending-cards';
    const payload = JSON.stringify({ rfid_uid: '3C001E9494' });
    for (let index = 0; index < 2; index++) {
      const response = await call(path, { method: 'POST', headers, body: payload });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.queued, true);
    }
    assert.equal(stored.size, 1);
    registered = true;
    const registeredResponse = await call(path, { method: 'POST', headers, body: payload });
    const registeredBody = await registeredResponse.json();
    assert.equal(registeredResponse.status, 200);
    assert.equal(registeredBody.data.already_registered, true);
    assert.equal(registeredBody.data.queued, false);
    assert.equal(stored.size, 0);
    assert.equal((await call('/api/boxes/BOX%20ELOTO%202/pending-cards', {
      method: 'POST', headers, body: payload
    })).status, 403);
    assert.equal((await call(path, { method: 'POST', headers,
      body: JSON.stringify({ rfid_uid: '../bad' }) })).status, 400);
    assert.equal(statementsSeen.filter(([sql]) => sql.startsWith('INSERT INTO rfid_buffer')).length, 1);
  } finally { pool.getConnection = originalGetConnection; }
});
test('device telemetry diagnostics log HTTP outcome and event name without card identifiers', async t => {
  const messages = [];
  t.mock.method(console, 'info', message => messages.push(message));
  const headers = {'X-Device-Id':'BOX ELOTO 1','Content-Type':'application/json'};
  const response = await call('/api/boxes/BOX%20ELOTO%201/telemetry', {
    method: 'POST', headers, body: JSON.stringify({ event: 'MECHANIC_LOG_IN', uid: 'private-card-id' })
  });
  assert.equal(response.status, 400);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(messages.some(message => message === '[DEVICE_TELEMETRY] HTTP 400 event=MECHANIC_LOG_IN'));
  assert.ok(messages.every(message => !message.includes('private-card-id')));
});
test('unknown device IDs cannot claim unconfigured boxes or register new boxes', async () => {
  const query = pool.query;
  const queries = [];
  pool.query = async (sql, args) => {
    queries.push(sql);
    if (sql === 'SELECT id_box FROM boxes WHERE id_box = ?') return [[]];
    return query(sql, args);
  };
  try {
    const headers = { 'X-Device-Id': 'unknown-device', 'Content-Type': 'application/json' };
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
test('device identity in telemetry body must match the ID header and URL', async () => {
  const response = await call('/api/boxes/BOX%20ELOTO%201/telemetry', {
    method: 'POST', headers: { 'X-Device-Id': 'BOX ELOTO 1', 'Content-Type': 'application/json' },
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
