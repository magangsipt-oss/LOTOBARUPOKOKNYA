import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/database.js';
import authorization from '../middleware/authorization.js';
import LotoPermitModel, { syncSessionPermit } from '../models/lotoPermitModel.js';
import LotoPermitController from '../controllers/lotoPermitController.js';
import {
  activationGaps, buildPermitDraft, mergePermitPeople, resolvePermitStatus, stampClosing, validateLotoPermitPayload
} from '../domain/lotoPermit.js';

const originalMethods = { ...LotoPermitModel };
afterEach(() => Object.assign(LotoPermitModel, originalMethods));
after(() => pool.end());

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

// Izin yang sudah lengkap: LOTO terpasang di semua titik, siap dikerjakan.
function activePayload() {
  return {
    projectNo: 'WO-0912',
    tanggalISO: '2026-11-23',
    lokasi: 'Workshop Plant',
    pekerjaan: 'Ganti seal silinder hidrolik',
    inspeksi: 'OK',
    defisiensi: '',
    diperbaiki: false,
    mesin: [{ nama: 'BMO1-MTL-0009', terisolasi: true, kembaliNormal: false }],
    titik: [
      { nama: 'Main breaker panel MCC-2', dipasang: true, ditarik: false },
      { nama: 'Valve hidrolik utama', dipasang: true, ditarik: false }
    ],
    alternatif: { blockControlSwitch: false, pullwire: false, handleValve: false, lainnya: false, lainnyaKet: '' },
    shift: {
      I: { teknisi: 'Andi', groupLeader: 'Budi', tanggal: '2026-11-23', waktu: '08:15' },
      II: { teknisi: '', groupLeader: '', tanggal: '', waktu: '' },
      III: { teknisi: '', groupLeader: '', tanggal: '', waktu: '' }
    },
    keterangan: '',
    selesai: { status: '', teknisi: '', teknisiTanggal: '', teknisiWaktu: '', pjTeknis: '', pjTanggal: '', pjWaktu: '' }
  };
}

function closedPayload() {
  const p = activePayload();
  p.titik = p.titik.map(t => ({ ...t, ditarik: true }));
  p.mesin = p.mesin.map(m => ({ ...m, kembaliNormal: true }));
  p.selesai = { ...p.selesai, status: 'SELESAI', teknisi: 'Andi', pjTeknis: 'Budi' };
  return p;
}

const status = (value, options) => resolvePermitStatus(validateLotoPermitPayload(value), options);

test('validation rejects malformed fields and contradictory LOTO states', () => {
  assert.throws(() => validateLotoPermitPayload(null), { status: 400 });
  assert.throws(() => validateLotoPermitPayload({ ...activePayload(), tanggalISO: '2026-02-30' }), { status: 400 });
  assert.throws(() => validateLotoPermitPayload({ ...activePayload(), inspeksi: 'MAYBE' }), { status: 400 });
  const pulledBeforePlaced = activePayload();
  pulledBeforePlaced.titik[0] = { nama: 'Breaker', dipasang: false, ditarik: true };
  assert.throws(() => validateLotoPermitPayload(pulledBeforePlaced), /ditarik sebelum dipasang/);
  const normalBeforeIsolated = activePayload();
  normalBeforeIsolated.mesin[0] = { nama: 'Unit', terisolasi: false, kembaliNormal: true };
  assert.throws(() => validateLotoPermitPayload(normalBeforeIsolated), /Kembali Normal/);
  const tickedWithoutName = activePayload();
  tickedWithoutName.titik.push({ nama: ' ', dipasang: true, ditarik: false });
  assert.throws(() => validateLotoPermitPayload(tickedWithoutName), /baris 3 wajib diisi/);
  const shiftClock = activePayload();
  shiftClock.shift.I.waktu = '25:00';
  assert.throws(() => validateLotoPermitPayload(shiftClock), { status: 400 });
});

test('validation drops blank rows and ignores server-managed fields from the browser', () => {
  const value = { ...activePayload(), personel: [{ sid: 'X' }], shiftOtomatis: 'III' };
  value.titik.push({ nama: '', dipasang: false, ditarik: false });
  const payload = validateLotoPermitPayload(value);
  assert.equal(payload.titik.length, 2);
  assert.equal(payload.personel, undefined);
  assert.equal(payload.shiftOtomatis, undefined);
});

test('a permit stays DRAFT until isolation is complete, then becomes AKTIF', () => {
  assert.equal(status(activePayload()), 'AKTIF');

  const notPlaced = activePayload();
  notPlaced.titik[1].dipasang = false;
  assert.equal(status(notPlaced), 'DRAFT');
  assert.ok(activationGaps(validateLotoPermitPayload(notPlaced)).some(g => g.includes('LOTO Dipasang')));

  const failedInspection = activePayload();
  failedInspection.inspeksi = 'NOT_OK';
  failedInspection.defisiensi = 'Kabel grounding putus';
  assert.equal(status(failedInspection), 'DRAFT');
  failedInspection.diperbaiki = true;
  assert.equal(status(failedInspection), 'AKTIF');

  const noIsolationPoint = activePayload();
  noIsolationPoint.titik = [];
  assert.equal(status(noIsolationPoint), 'DRAFT');
  noIsolationPoint.alternatif.pullwire = true;
  assert.equal(status(noIsolationPoint), 'AKTIF');
});

test('LOTO cannot be pulled or the permit closed while the box session is still open', () => {
  const pulling = activePayload();
  pulling.titik[0].ditarik = true;
  assert.throws(() => status(pulling, { sessionActive: true }), { status: 409 });
  assert.equal(status(pulling, { sessionActive: false }), 'AKTIF');

  const notFinished = activePayload();
  notFinished.selesai = { ...notFinished.selesai, status: 'BELUM', teknisi: 'Andi', pjTeknis: 'Budi' };
  assert.throws(() => status(notFinished, { sessionActive: true }), { status: 409 });
  assert.equal(status(notFinished, { sessionActive: false }), 'DITUTUP');
});

test('closing as finished requires every point pulled, every machine normal and both sign-offs', () => {
  assert.equal(status(closedPayload()), 'DITUTUP');

  const pointLeft = closedPayload();
  pointLeft.titik[1].ditarik = false;
  assert.throws(() => status(pointLeft), /LOTO Ditarik/);

  const noSignOff = closedPayload();
  noSignOff.selesai.pjTeknis = '';
  assert.throws(() => status(noSignOff), /penanggung jawab teknis/);

  const incomplete = closedPayload();
  incomplete.lokasi = '';
  assert.throws(() => status(incomplete), /belum bisa ditutup/);
});

test('closing sign-off date and time default to the save time', () => {
  const stamped = stampClosing(validateLotoPermitPayload(closedPayload()), new Date('2026-11-23T01:30:00Z'));
  assert.equal(stamped.selesai.teknisiTanggal, '2026-11-23');
  assert.equal(stamped.selesai.teknisiWaktu, '09:30');
  assert.equal(stamped.selesai.pjWaktu, '09:30');
});

const people = [
  { sid: 'SPV1', nama: 'Budi', role: 'pengawas' },
  { sid: 'MEK1', nama: 'Andi', role: 'teknisi' }
];

test('a box session draft fills date, unit, current shift column and personnel', () => {
  const day = buildPermitDraft({ unit: 'BMO1-MTL-0009', people, now: new Date('2026-11-23T00:15:00Z') });
  assert.equal(day.tanggalISO, '2026-11-23');
  assert.deepEqual(day.mesin, [{ nama: 'BMO1-MTL-0009', terisolasi: false, kembaliNormal: false }]);
  assert.deepEqual(day.shift.I, { teknisi: 'Andi', groupLeader: 'Budi', tanggal: '2026-11-23', waktu: '08:15' });
  assert.equal(day.shiftOtomatis, 'I');
  assert.deepEqual(day.personel, people);
  // A draft is a valid form, and is not yet active.
  assert.equal(resolvePermitStatus(validateLotoPermitPayload(day)), 'DRAFT');

  const night = buildPermitDraft({ unit: 'U', people, now: new Date('2026-11-23T12:00:00Z') });
  assert.equal(night.shiftOtomatis, 'II');
  assert.equal(night.shift.II.waktu, '20:00');
});

test('people who tap later join the personnel list once and the shift column only while drafting', () => {
  const draft = buildPermitDraft({ unit: 'U', people: [people[0]], now: new Date('2026-11-23T00:15:00Z') });
  const added = [...people, { sid: 'MEK2', nama: 'Citra', role: 'teknisi' }];
  const merged = mergePermitPeople(draft, added, true);
  assert.deepEqual(merged.personel.map(p => p.sid), ['SPV1', 'MEK1', 'MEK2']);
  assert.equal(merged.shift.I.teknisi, 'Andi, Citra');
  assert.equal(merged.shift.I.groupLeader, 'Budi');
  assert.equal(mergePermitPeople(merged, added, true), null);

  const active = mergePermitPeople(draft, added, false);
  assert.equal(active.shift.I.teknisi, '');
  assert.equal(active.personel.length, 3);
});

function draftConnection({ queue = [], existing = [] }) {
  return {
    calls: [],
    async query(sql, args) {
      this.calls.push([sql, args]);
      if (sql.includes('FROM queue')) return [queue];
      if (sql.includes('FROM loto_permits')) return [existing];
      return [{ affectedRows: 1 }];
    }
  };
}

test('the first tap of a box session creates one permit draft; later taps update it', async () => {
  const first = draftConnection({ queue: [{ sid: 'SPV1', nama: 'Budi', role: 'Supervisor' }] });
  await syncSessionPermit(first, { idBox: 'BOX-1', session: 4, unit: 'BMO1-MTL-0009' });
  const insert = first.calls.find(([sql]) => sql.startsWith('INSERT INTO loto_permits'));
  assert.deepEqual(insert[1].slice(0, 2), ['BOX-1', 4]);
  assert.deepEqual(JSON.parse(insert[1][3]).personel, [{ sid: 'SPV1', nama: 'Budi', role: 'pengawas' }]);

  const existing = [{ id: 9, status: 'DRAFT', payload: JSON.stringify(buildPermitDraft({ unit: 'U', people: [people[0]] })) }];
  const later = draftConnection({ queue: [{ sid: 'SPV1', nama: 'Budi', role: 'pengawas' }, { sid: 'MEK1', nama: 'Andi', role: 'mekanik' }], existing });
  await syncSessionPermit(later, { idBox: 'BOX-1', session: 4, unit: 'U' });
  assert.equal(later.calls.some(([sql]) => sql.startsWith('INSERT INTO loto_permits')), false);
  const update = later.calls.find(([sql]) => sql.startsWith('UPDATE loto_permits'));
  assert.deepEqual(JSON.parse(update[1][0]).personel.map(p => p.sid), ['SPV1', 'MEK1']);
  assert.equal(update[1][1], 9);

  const empty = draftConnection({ queue: [] });
  await syncSessionPermit(empty, { idBox: 'BOX-1', session: 4, unit: 'U' });
  assert.equal(empty.calls.length, 1);
});

function authorize(method, path, role, body = {}) {
  let allowed = false;
  const res = response();
  authorization({ method, path, body, auth: { type: 'user', role, user: { sid: 'U1' } } }, res, () => { allowed = true; });
  return allowed;
}

test('permits are readable by admin, pengawas and safety, and writable only by admin and pengawas', () => {
  for (const role of ['admin', 'pengawas', 'safety']) assert.equal(authorize('GET', '/loto-permits', role), true, role);
  for (const role of ['teknisi', 'fuelman']) assert.equal(authorize('GET', '/loto-permits/3', role), false, role);
  for (const role of ['admin', 'pengawas']) {
    assert.equal(authorize('POST', '/loto-permits', role), true, role);
    assert.equal(authorize('PUT', '/loto-permits/3', role), true, role);
    assert.equal(authorize('DELETE', '/loto-permits/3', role), true, role);
  }
  for (const role of ['safety', 'teknisi']) {
    assert.equal(authorize('POST', '/loto-permits', role), false, role);
    assert.equal(authorize('PUT', '/loto-permits/3', role), false, role);
  }
  assert.equal(authorize('PUT', '/loto-permits/abc', 'pengawas'), false);
});

test('update controller validates input, reports missing permits and surfaces safety conflicts', async () => {
  LotoPermitModel.update = async () => assert.fail('invalid input must not be stored');
  const invalid = response();
  await LotoPermitController.update({ params: { id: '3' }, body: { data: { ...activePayload(), tanggalISO: 'x' } }, auth: { user: { sid: 'SPV1' } } }, invalid);
  assert.equal(invalid.statusCode, 400);

  LotoPermitModel.update = async () => null;
  const missing = response();
  await LotoPermitController.update({ params: { id: '99' }, body: { data: activePayload() }, auth: { user: { sid: 'SPV1' } } }, missing);
  assert.equal(missing.statusCode, 404);

  LotoPermitModel.update = async () => { throw Object.assign(new Error('Sesi LOTO di box masih berjalan.'), { status: 409 }); };
  const blocked = response();
  await LotoPermitController.update({ params: { id: '3' }, body: { data: activePayload() }, auth: { user: { sid: 'SPV1' } } }, blocked);
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.body.message, /masih berjalan/);

  const badId = response();
  await LotoPermitController.update({ params: { id: '0' }, body: { data: activePayload() }, auth: { user: { sid: 'SPV1' } } }, badId);
  assert.equal(badId.statusCode, 400);
});
