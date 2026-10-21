import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/database.js';
import authorization from '../middleware/authorization.js';
import DOPPlanModel, { syncSessionDraft } from '../models/dopPlanModel.js';
import DOPPlanController from '../controllers/dopPlanController.js';
import { buildSessionDraft, formatDOPPlan, mergeSessionPeople, validateDOPPlanPayload } from '../domain/dopPlan.js';

const originalMethods = {
  getAll: DOPPlanModel.getAll,
  create: DOPPlanModel.create,
  complete: DOPPlanModel.complete,
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
  assert.equal(check('pengawas', 'PUT', '/dop-plans/3').nextCalled, true);
  assert.equal(check('pengawas', 'PUT', '/dop-plans').statusCode, 403);
  assert.equal(check('teknisi', 'PUT', '/dop-plans/3').statusCode, 403);
});

test('DOP records with invalid stored JSON are surfaced as database errors', () => {
  assert.throws(() => formatDOPPlan({ id: 9, payload: '{bad json' }), SyntaxError);
});

const sessionPeople = [
  { sid: 'SPV1', nama: 'Budi', role: 'pengawas' },
  { sid: 'MEK1', nama: 'Andi', role: 'teknisi' }
];

test('a maintenance session draft carries only date, shift, unit and the people who tapped', () => {
  // 2026-10-21 01:30 UTC = 09:30 WITA -> shift 1
  const draft = buildSessionDraft({ unit: 'BMO1-MTL-0009', people: sessionPeople, now: new Date('2026-10-21T01:30:00Z') });
  assert.equal(draft.tanggalISO, '2026-10-21');
  assert.equal(draft.tanggal, '21-Oct-26');
  assert.equal(draft.shift, '1');
  assert.deepEqual(draft.fleetUnits, ['BMO1-MTL-0009']);
  assert.deepEqual(draft.personel, sessionPeople);
  assert.deepEqual(draft.pja.layer2, [{ nama: 'Budi', jabatan: 'Spv/Act Spv', hp: '' }]);
  for (const field of ['aktivitas', 'departemen', 'lokasi', 'hazard']) assert.equal(draft[field], '');
  // 2026-10-21 12:00 UTC = 20:00 WITA -> shift 2
  assert.equal(buildSessionDraft({ unit: 'X', people: [], now: new Date('2026-10-21T12:00:00Z') }).shift, '2');
});

test('people who tap later are appended once; supervisors join PJA only while drafting', () => {
  const draft = buildSessionDraft({ unit: 'U', people: [sessionPeople[0]] });
  assert.equal(mergeSessionPeople(draft, [sessionPeople[0]], true), null);
  const next = mergeSessionPeople(draft, [...sessionPeople, { sid: 'SPV2', nama: 'Cici', role: 'pengawas' }], true);
  assert.deepEqual(next.personel.map(p => p.sid), ['SPV1', 'MEK1', 'SPV2']);
  assert.deepEqual(next.pja.layer2.map(p => p.nama), ['Budi', 'Cici']);
  const final = mergeSessionPeople(draft, [{ sid: 'SPV2', nama: 'Cici', role: 'pengawas' }], false);
  assert.deepEqual(final.pja.layer2.map(p => p.nama), ['Budi']);
});

function draftConnection({ queue, existing = [] }) {
  const calls = [];
  return {
    calls,
    async query(sql, args) {
      calls.push([sql, args]);
      if (sql.includes('FROM queue')) return [queue];
      if (sql.includes('FROM dop_plans')) return [existing];
      return [{ affectedRows: 1 }];
    }
  };
}

test('the first tap of a box session creates one DOP draft for that session', async () => {
  const c = draftConnection({ queue: [
    { sid: 'SPV1', nama: 'Budi', role: 'Supervisor' },
    { sid: 'SPV1', nama: 'Budi', role: 'Supervisor' }
  ] });
  await syncSessionDraft(c, { idBox: 'BOX-1', session: 4, unit: 'BMO1-MTL-0009' });
  const insert = c.calls.find(([sql]) => sql.startsWith('INSERT INTO dop_plans'));
  assert.ok(insert);
  assert.equal(insert[1][3], 'BOX-1');
  assert.equal(insert[1][4], 4);
  const payload = JSON.parse(insert[1][2]);
  assert.deepEqual(payload.personel, [{ sid: 'SPV1', nama: 'Budi', role: 'pengawas' }]);
});

test('later taps update the existing session draft instead of creating another', async () => {
  const existing = [{ id: 7, status: 'DRAFT', payload: JSON.stringify(buildSessionDraft({ unit: 'U', people: [sessionPeople[0]] })) }];
  const c = draftConnection({ queue: [
    { sid: 'SPV1', nama: 'Budi', role: 'pengawas' },
    { sid: 'MEK1', nama: 'Andi', role: 'mekanik' }
  ], existing });
  await syncSessionDraft(c, { idBox: 'BOX-1', session: 4, unit: 'U' });
  assert.equal(c.calls.some(([sql]) => sql.startsWith('INSERT INTO dop_plans')), false);
  const update = c.calls.find(([sql]) => sql.startsWith('UPDATE dop_plans'));
  assert.deepEqual(JSON.parse(update[1][0]).personel.map(p => p.sid), ['SPV1', 'MEK1']);
  assert.equal(update[1][1], 7);
});

test('an empty session queue does not create a draft', async () => {
  const c = draftConnection({ queue: [] });
  await syncSessionDraft(c, { idBox: 'BOX-1', session: 4, unit: 'U' });
  assert.equal(c.calls.length, 1);
});

test('completing a draft validates the form and keeps the box personnel list', async () => {
  let saved;
  DOPPlanModel.complete = async (id, payload) => {
    saved = [id, payload];
    return { id, payload: { ...payload, personel: sessionPeople }, status: 'FINAL', id_box: 'BOX-1', session_id: 4 };
  };
  const res = response();
  await DOPPlanController.complete({ params: { id: '7' }, body: { data: { ...validPayload(), personel: [] } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(saved[0], 7);
  assert.equal(saved[1].personel, undefined);
  assert.equal(res.body.data.status, 'FINAL');
  assert.deepEqual(res.body.data.personel, sessionPeople);

  DOPPlanModel.complete = async () => assert.fail('incomplete DOP must not be stored');
  const invalid = response();
  await DOPPlanController.complete({ params: { id: '7' }, body: { data: { ...validPayload(), hazard: '' } } }, invalid);
  assert.equal(invalid.statusCode, 400);

  DOPPlanModel.complete = async () => null;
  const missing = response();
  await DOPPlanController.complete({ params: { id: '99' }, body: { data: validPayload() } }, missing);
  assert.equal(missing.statusCode, 404);
});
