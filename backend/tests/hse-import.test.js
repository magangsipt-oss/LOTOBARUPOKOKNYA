import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import pool from '../config/database.js';
import UserModel from '../models/userModel.js';
import { hashToken, csrfToken, normalizeRole } from '../security/session.js';
import { normalizeUserRole } from '../../frontend/src/utils/helpers.js';
import {
  HSE_ROLES,
  extractHseRecords,
  classifyHseEmployee,
  toLotoUser,
  planHseImport,
} from '../domain/hseEmployees.js';

const employee = (overrides = {}) => ({
  sidCode: 'ABCDE',
  name: '  Budi Santoso ',
  status: 'AKTIF',
  functionalPosition: 'Mekanik',
  structuralPosition: 'Mekanik',
  departmentName: 'Plant & Maintenance',
  divisionName: 'ALL DIVISION',
  rfidCardNo: '0012345678',
  ktpNo: '6403000000000000',
  dateOfBirth: '1990-01-01',
  ...overrides,
});

test('extractHseRecords accepts the getEmployee envelope and rejects other shapes', () => {
  assert.deepEqual(extractHseRecords({ count: 1, results: [employee()] }), [employee()]);
  assert.throws(() => extractHseRecords({ data: [] }), /results/);
  assert.throws(() => extractHseRecords(null), /results/);
});

test('classifyHseEmployee maps HSE positions to LOTO roles', () => {
  assert.equal(classifyHseEmployee(employee({ functionalPosition: 'Supervisor/Officer', structuralPosition: 'Mechanical Supervisor Jr' })), HSE_ROLES.PENGAWAS);
  assert.equal(classifyHseEmployee(employee({ functionalPosition: 'Superintendent', structuralPosition: 'Mining Infrastructure Superintendent' })), HSE_ROLES.PENGAWAS);
  assert.equal(classifyHseEmployee(employee({ functionalPosition: 'Foreman/Group Leader', structuralPosition: 'Foreman Mekanik' })), HSE_ROLES.FOREMAN);
  assert.equal(classifyHseEmployee(employee({ functionalPosition: 'Technician', structuralPosition: 'Electric Technician' })), HSE_ROLES.MEKANIK);
  assert.equal(classifyHseEmployee(employee({ functionalPosition: 'Supervisor/Officer', structuralPosition: 'Safety Officer ' })), HSE_ROLES.SAFETY);
  assert.equal(classifyHseEmployee(employee({ functionalPosition: 'Supervisor/Officer', structuralPosition: 'HSE Supervisor', departmentName: 'HSE & Compliance' })), HSE_ROLES.SAFETY);
  assert.equal(classifyHseEmployee(employee({ functionalPosition: 'Visitor', structuralPosition: 'VISITOR' })), null);
  assert.equal(classifyHseEmployee(employee({ functionalPosition: 'Operator', structuralPosition: 'Operator Double Trailer' })), null);
  assert.equal(classifyHseEmployee(employee({ functionalPosition: 'Supervisor/Officer', structuralPosition: 'Data Analysis Officer' })), null);
});

test('LOTO roles keep box behaviour: pengawas locks, foreman taps as worker, safety is read-only', () => {
  assert.equal(normalizeRole(HSE_ROLES.PENGAWAS), 'pengawas');
  assert.equal(normalizeRole(HSE_ROLES.MEKANIK), 'teknisi');
  assert.equal(normalizeRole(HSE_ROLES.FOREMAN), 'teknisi');
  assert.equal(normalizeRole(HSE_ROLES.SAFETY), 'safety');
  assert.equal(normalizeUserRole(HSE_ROLES.FOREMAN), 'teknisi');
  assert.equal(normalizeUserRole(HSE_ROLES.SAFETY), 'safety');
  assert.equal(normalizeUserRole('PENGAWAS'), 'pengawas');
});

test('toLotoUser keeps only the fields LOTO needs and drops personal data', () => {
  assert.deepEqual(toLotoUser(employee()), { sid: 'ABCDE', nama: 'Budi Santoso', role: HSE_ROLES.MEKANIK, rfid_uid: '0012345678' });
});

test('toLotoUser skips inactive, invalid SID, and unmapped employees', () => {
  assert.equal(toLotoUser(employee({ status: 'NONAKTIF' })), null);
  assert.equal(toLotoUser(employee({ status: 'DELETED' })), null);
  assert.notEqual(toLotoUser(employee({ status: 'BARU' })), null);
  assert.equal(toLotoUser(employee({ sidCode: null })), null);
  assert.equal(toLotoUser(employee({ sidCode: 'AB CD' })), null);
  assert.equal(toLotoUser(employee({ name: '   ' })), null);
  assert.equal(toLotoUser(employee({ functionalPosition: 'Visitor', structuralPosition: 'VISITOR' })), null);
});

test('toLotoUser drops RFID for safety and for malformed card numbers', () => {
  const safety = employee({ functionalPosition: 'Supervisor/Officer', structuralPosition: 'Safety Officer' });
  assert.equal(toLotoUser(safety).rfid_uid, null);
  assert.equal(toLotoUser(employee({ rfidCardNo: '9' })).rfid_uid, null);
  assert.equal(toLotoUser(employee({ rfidCardNo: 'ABC123' })).rfid_uid, null);
  assert.equal(toLotoUser(employee({ rfidCardNo: null })).rfid_uid, null);
  assert.equal(toLotoUser(employee({ rfidCardNo: ' 0012345678 ' })).rfid_uid, '0012345678');
});

test('planHseImport inserts new users and updates changed non-admin users', () => {
  const plan = planHseImport(
    [
      { sid: 'NEW01', nama: 'New', role: 'MEKANIK', rfid_uid: '0000000001' },
      { sid: 'OLD01', nama: 'Old Renamed', role: 'PENGAWAS', rfid_uid: '0000000002' },
      { sid: 'SAME1', nama: 'Same', role: 'MEKANIK', rfid_uid: '0000000003' },
    ],
    [
      { sid: 'OLD01', nama: 'Old', role: 'teknisi', rfid_uid: null },
      { sid: 'SAME1', nama: 'Same', role: 'MEKANIK', rfid_uid: '0000000003' },
    ],
  );
  assert.deepEqual(plan.inserts.map(u => u.sid), ['NEW01']);
  assert.deepEqual(plan.updates, [{ sid: 'OLD01', nama: 'Old Renamed', role: 'PENGAWAS', rfid_uid: '0000000002' }]);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.rfidReleases, []);
  assert.deepEqual(plan.skipped, []);
});

test('planHseImport never touches admin accounts or admin cards', () => {
  const plan = planHseImport(
    [
      { sid: 'Admin', nama: 'Hijack', role: 'MEKANIK', rfid_uid: null },
      { sid: 'NEW01', nama: 'New', role: 'MEKANIK', rfid_uid: '0000000009' },
    ],
    [{ sid: 'Admin', nama: 'Administrator', role: 'ADMIN', rfid_uid: '0000000009' }],
  );
  assert.deepEqual(plan.updates, []);
  assert.deepEqual(plan.rfidReleases, []);
  assert.deepEqual(plan.inserts, [{ sid: 'NEW01', nama: 'New', role: 'MEKANIK', rfid_uid: null }]);
  assert.deepEqual(plan.skipped, [
    { sid: 'Admin', reason: 'admin_protected' },
    { sid: 'NEW01', reason: 'rfid_owned_by_admin' },
  ]);
});

test('planHseImport takes cards from other local users so HSE wins conflicts', () => {
  const plan = planHseImport(
    [
      { sid: 'A', nama: 'A', role: 'MEKANIK', rfid_uid: '0000000002' },
      { sid: 'B', nama: 'B', role: 'MEKANIK', rfid_uid: '0000000001' },
    ],
    [
      { sid: 'A', nama: 'A', role: 'MEKANIK', rfid_uid: '0000000001' },
      { sid: 'B', nama: 'B', role: 'MEKANIK', rfid_uid: '0000000002' },
      { sid: 'LOCAL', nama: 'Local', role: 'MEKANIK', rfid_uid: '0000000003' },
    ],
  );
  assert.deepEqual([...plan.rfidReleases].sort(), ['A', 'B']);
  assert.deepEqual(plan.updates.map(u => [u.sid, u.rfid_uid]), [['A', '0000000002'], ['B', '0000000001']]);
});

test('planHseImport skips duplicate SIDs and duplicate cards inside the HSE data', () => {
  const plan = planHseImport(
    [
      { sid: 'A', nama: 'First', role: 'MEKANIK', rfid_uid: '0000000001' },
      { sid: 'A', nama: 'Second', role: 'MEKANIK', rfid_uid: '0000000005' },
      { sid: 'B', nama: 'B', role: 'MEKANIK', rfid_uid: '0000000001' },
    ],
    [],
  );
  assert.deepEqual(plan.inserts, [
    { sid: 'A', nama: 'First', role: 'MEKANIK', rfid_uid: '0000000001' },
    { sid: 'B', nama: 'B', role: 'MEKANIK', rfid_uid: null },
  ]);
  assert.deepEqual(plan.skipped, [
    { sid: 'A', reason: 'duplicate_sid' },
    { sid: 'B', reason: 'duplicate_rfid' },
  ]);
});

test('planHseImport does not mutate its inputs', () => {
  const incoming = [Object.freeze({ sid: 'A', nama: 'A', role: 'MEKANIK', rfid_uid: '0000000001' })];
  const existing = [Object.freeze({ sid: 'A', nama: 'Old', role: 'MEKANIK', rfid_uid: null })];
  assert.doesNotThrow(() => planHseImport(Object.freeze(incoming), Object.freeze(existing)));
});

describeApi();

function describeApi() {
  const token = 'b'.repeat(64);
  const sessions = new Map();
  const originalQuery = pool.query;
  const originalGetAll = UserModel.getAll;
  let server, base;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    pool.query = async (sql, params = []) => {
      if (sql.includes('FROM web_sessions s JOIN users')) return [[sessions.get(params[0])].filter(Boolean)];
      if (sql.includes('SELECT id_box FROM boxes WHERE id_box = ?')) return [params[0] === 'BOX ELOTO 1' ? [{ id_box: params[0] }] : []];
      return [[]];
    };
    UserModel.getAll = async () => [
      { sid: 'S1', nama: 'Safety', role: 'SAFETY', rfid_uid: null, fp_id: null },
      { sid: 'M1', nama: 'Mekanik', role: 'MEKANIK', rfid_uid: '0000000001', fp_id: null },
    ];
    server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise(resolve => server.close(resolve));
    pool.query = originalQuery;
    UserModel.getAll = originalGetAll;
    await pool.end();
  });

  test('boxes never receive safety personnel in their user cache', async () => {
    const res = await fetch(`${base}/api/users`, { headers: { 'X-Device-Id': 'BOX ELOTO 1' } });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data.map(u => u.sid), ['M1']);
  });

  test('safety accounts can read the dashboard but cannot change data', async () => {
    sessions.set(hashToken(token), { sid: 'S1', nama: 'Safety', role: 'SAFETY', rfid_uid: null });
    const headers = { Cookie: `eloto_session=${token}`, 'X-CSRF-Token': csrfToken(token), 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${base}/api/users`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/api/maintenance`, { method: 'POST', headers, body: '{}' })).status, 403);
  });
}
