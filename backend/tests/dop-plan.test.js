import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/database.js';
import authorization from '../middleware/authorization.js';
import DOPPlanModel from '../models/dopPlanModel.js';
import DOPPlanController from '../controllers/dopPlanController.js';
import { formatDOPPlan, validateDOPPlanPayload } from '../domain/dopPlan.js';

const originalMethods = {
  getAll: DOPPlanModel.getAll,
  create: DOPPlanModel.create,
  delete: DOPPlanModel.delete
};

afterEach(() => Object.assign(DOPPlanModel, originalMethods));
after(() => pool.end());

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function validPayload() {
  return {
    tanggal: '11-Oct-26',
    tanggalISO: '2026-10-11',
    shift: '1&2',
    aktivitas: 'Pengecekan unit',
    keluhan: '',
    fleetUnits: ['BMO1-MTL-0009'],
    departemen: 'Support Departement',
    lokasi: 'Plant Base',
    tools: 'Common tool',
    hazard: 'Risiko pekerjaan',
    goldenRules: '',
    sib: '',
    kritis: '',
    ibpr: '',
    jsa: '',
    loto: '',
    pemantauan: '',
    foto: false,
    pja: {
      layer1s1: [],
      layer1s2: [],
      layer2: [],
      layer3: [],
      layer4: []
    }
  };
}

test('DOP payload validation rejects invalid dates, shifts and malformed PJA data', () => {
  const invalidDate = validPayload();
  invalidDate.tanggalISO = '2026-02-30';
  assert.throws(() => validateDOPPlanPayload(invalidDate), { status: 400 });

  const invalidShift = validPayload();
  invalidShift.shift = '3';
  assert.throws(() => validateDOPPlanPayload(invalidShift), { status: 400 });

  const invalidPja = validPayload();
  invalidPja.pja.layer2 = [{ nama: '<script>', jabatan: 'Spv' }];
  assert.throws(() => validateDOPPlanPayload(invalidPja), { status: 400 });
});

test('DOP payload validation returns a bounded, normalized payload', () => {
  const payload = validPayload();
  payload.fleetUnits = [' BMO1-MTL-0009 ', 'BMO1-MTL-0009'];
  const normalized = validateDOPPlanPayload(payload);
  assert.deepEqual(normalized.fleetUnits, ['BMO1-MTL-0009']);
  assert.equal(normalized.tanggalISO, '2026-10-11');
});

test('DOP list controller returns parsed records from the database', async () => {
  DOPPlanModel.getAll = async () => [{
    id: 5,
    payload: JSON.stringify(validPayload()),
    created_at: '2026-10-11 09:00:00'
  }];
  const res = response();
  await DOPPlanController.getAll({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].id, 5);
  assert.equal(res.body.data[0].aktivitas, 'Pengecekan unit');
});

test('DOP create controller saves validated payload with the authenticated SID', async () => {
  let created;
  DOPPlanModel.create = async value => { created = value; return 12; };
  const res = response();
  await DOPPlanController.create({
    body: { data: validPayload() },
    auth: { user: { sid: 'SUP-01' } }
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.id, 12);
  assert.equal(created.createdBy, 'SUP-01');
  assert.equal(created.planDate, '2026-10-11');
});

test('DOP create controller rejects malformed input before writing', async () => {
  DOPPlanModel.create = async () => assert.fail('Invalid DOP must not be stored');
  const res = response();
  await DOPPlanController.create({ body: { data: { shift: '3' } }, auth: { user: { sid: 'SUP-01' } } }, res);
  assert.equal(res.statusCode, 400);
});

test('DOP delete controller validates IDs and reports missing records', async () => {
  const invalid = response();
  await DOPPlanController.delete({ params: { id: '1 OR 1=1' } }, invalid);
  assert.equal(invalid.statusCode, 400);

  DOPPlanModel.delete = async () => false;
  const missing = response();
  await DOPPlanController.delete({ params: { id: '18' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('DOP mutations are allowed to admins and pengawas but denied to other roles', () => {
  const check = (role, method, path) => {
    let nextCalled = false;
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
    authorization({ method, path, auth: { type: 'user', role, user: { sid: 'USER-01' } } }, res, () => { nextCalled = true; });
    return { nextCalled, statusCode: res.statusCode };
  };
  assert.equal(check('pengawas', 'POST', '/dop-plans').nextCalled, true);
  assert.equal(check('admin', 'DELETE', '/dop-plans/3').nextCalled, true);
  assert.equal(check('teknisi', 'POST', '/dop-plans').statusCode, 403);
  assert.equal(check('pengawas', 'DELETE', '/dop-plans/3x').statusCode, 403);
  assert.equal(check('teknisi', 'GET', '/dop-plans').statusCode, 403);
});

test('DOP records with invalid stored JSON are surfaced as database errors', () => {
  assert.throws(() => formatDOPPlan({ id: 9, payload: '{bad json' }), SyntaxError);
});
