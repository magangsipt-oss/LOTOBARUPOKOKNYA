import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/database.js';
import BriefingModel, { syncSessionBriefing } from '../models/briefingModel.js';
import BriefingController from '../controllers/briefingController.js';
import {
  MIN_JAM_TIDUR, applyOwnSleep, briefingPermissions, buildBriefingDraft, canSeeBriefing, fatigueWarnings,
  mergeBriefingPeople, resolveBriefingStatus, signBriefing, validateBriefingPayload
} from '../domain/briefing.js';

const originalMethods = { ...BriefingModel };
afterEach(() => Object.assign(BriefingModel, originalMethods));
after(() => pool.end());

const foreman = { sid: 'GL1', nama: 'M. Suhaeri', role: 'teknisi', jabatan: 'foreman' };
const supervisor = { sid: 'SPV1', nama: 'Budi', role: 'pengawas', jabatan: 'pengawas' };
const mechanic = { sid: 'MEK1', nama: 'Fathurrahman', role: 'teknisi', jabatan: 'mekanik' };
const other = { sid: 'MEK2', nama: 'Restu K', role: 'teknisi', jabatan: 'mekanik' };

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

// Daftar hadir seperti contoh kertas: sosialisasi IK Service & JSA di Base Service.
function filled() {
  return {
    departemen: 'Plant',
    tanggalISO: '2026-11-18',
    waktu: '08:00',
    pembicara: 'M. Suhaeri',
    lokasi: 'Base Service',
    namaDokumen: 'IK Service & JSA',
    peserta: [
      { sid: 'MEK1', nama: 'Fathurrahman', instansi: 'Plant', jamTidur: 6, jabatan: 'Mekanik' },
      { sid: 'MEK2', nama: 'Restu K', instansi: 'Plant', jamTidur: '6,5', jabatan: 'Mekanik' }
    ],
    yangMemimpin: 'M. Suhaeri',
    mengetahui: 'Budi'
  };
}

test('validation keeps the F-HSE-105 header, parses sleep hours and drops blank rows', () => {
  const p = validateBriefingPayload({ ...filled(), peserta: [...filled().peserta, { nama: '', instansi: '', jamTidur: '' }] });
  assert.deepEqual(p.dokumen, { nomor: 'F-HSE-105', tanggalEfektif: '2017-02-25', revisi: '1', halaman: '1 dari 1' });
  assert.equal(p.peserta.length, 2);
  assert.equal(p.peserta[1].jamTidur, 6.5);
  assert.throws(() => validateBriefingPayload({ ...filled(), tanggalISO: '' }), /Hari\/Tanggal/);
  assert.throws(() => validateBriefingPayload({ ...filled(), peserta: [{ nama: 'A', jamTidur: 25 }] }), /jam tidur/);
  assert.throws(() => validateBriefingPayload({ ...filled(), peserta: [{ nama: '', jamTidur: 5 }] }), /Nama peserta baris 1/);
  assert.throws(() => validateBriefingPayload({ ...filled(), peserta: Array.from({ length: 41 }, (_, i) => ({ nama: `P${i}` })) }), /maksimal 40/);
});

test('a list is complete only with every sleep hour and both account signatures; short sleep is flagged', () => {
  const p = validateBriefingPayload(filled());
  assert.equal(resolveBriefingStatus(p), 'DRAFT');
  assert.throws(() => signBriefing(p, 'mengetahui', foreman), { status: 403 });
  assert.throws(() => signBriefing(p, 'yangMemimpin', mechanic), { status: 403 });
  const led = signBriefing(p, 'yangMemimpin', foreman, new Date('2026-11-18T00:30:00Z'));
  assert.equal(led.tandaTangan.yangMemimpin.nama, 'M. Suhaeri');
  assert.throws(() => signBriefing(led, 'yangMemimpin', foreman), { status: 409 });
  const known = signBriefing(led, 'mengetahui', supervisor);
  assert.equal(resolveBriefingStatus(known), 'LENGKAP');

  const missingSleep = validateBriefingPayload({ ...filled(), peserta: [{ sid: 'MEK1', nama: 'Fathurrahman', jamTidur: null }] });
  assert.throws(() => signBriefing(missingSleep, 'yangMemimpin', foreman), /jam tidur semua peserta/);

  const tired = validateBriefingPayload({ ...filled(), peserta: [{ nama: 'Teddy', jamTidur: 4 }] });
  assert.deepEqual(fatigueWarnings(tired), [`Teddy: tidur 4 jam (minimal ${MIN_JAM_TIDUR} jam)`]);
});

test('a box session fills attendees from card taps, the foreman as leader and the supervisor as acknowledger', () => {
  const draft = buildBriefingDraft({ people: [supervisor, mechanic], now: new Date('2026-11-18T00:00:00Z') });
  assert.equal(draft.tanggalISO, '2026-11-18');
  assert.equal(draft.waktu, '08:00');
  assert.deepEqual(draft.peserta, [{ sid: 'MEK1', nama: 'Fathurrahman', instansi: '', jamTidur: null, jabatan: 'Mekanik' }]);
  assert.equal(draft.mengetahui, 'Budi');
  assert.equal(draft.yangMemimpin, '');

  const merged = mergeBriefingPeople(draft, [supervisor, mechanic, foreman, other]);
  assert.deepEqual(merged.peserta.map(x => x.sid), ['MEK1', 'GL1', 'MEK2']);
  assert.equal(merged.yangMemimpin, 'M. Suhaeri');
  assert.equal(mergeBriefingPeople(merged, [supervisor, mechanic, foreman, other]), null);
});

test('mechanics fill only their own sleep hours; the foreman who joined and supervisors edit everything', () => {
  const stored = validateBriefingPayload(filled());
  const incoming = validateBriefingPayload({ ...filled(), pembicara: 'Diubah', peserta: filled().peserta.map(x => ({ ...x, jamTidur: 3 })) });
  const next = applyOwnSleep(stored, incoming, mechanic);
  assert.equal(next.pembicara, 'M. Suhaeri');
  assert.deepEqual(next.peserta.map(x => x.jamTidur), [3, 6.5]);
  assert.throws(() => applyOwnSleep(stored, incoming, { sid: 'X', role: 'teknisi', jabatan: 'mekanik' }), { status: 403 });

  const row = { created_by: 'SYSTEM', status: 'DRAFT' };
  const withLeader = { ...stored, peserta: [...stored.peserta, { sid: 'GL1', nama: 'M. Suhaeri', jamTidur: 7 }] };
  assert.deepEqual(briefingPermissions(row, withLeader, mechanic), { ubah: false, jamTidurSendiri: true, ttdMemimpin: false, ttdMengetahui: false, hapus: false });
  assert.deepEqual(briefingPermissions(row, withLeader, foreman), { ubah: true, jamTidurSendiri: false, ttdMemimpin: true, ttdMengetahui: false, hapus: false });
  assert.deepEqual(briefingPermissions(row, withLeader, supervisor), { ubah: true, jamTidurSendiri: false, ttdMemimpin: true, ttdMengetahui: true, hapus: true });
  assert.equal(canSeeBriefing(row, stored, { sid: 'MEK9', role: 'teknisi', jabatan: 'mekanik' }), false);
  assert.equal(canSeeBriefing(row, stored, { sid: 'S1', role: 'safety', jabatan: 'safety' }), true);
});

function sessionConnection({ queue = [], existing = [] }) {
  return {
    calls: [],
    async query(sql, args) {
      this.calls.push([sql, args]);
      if (sql.includes('FROM queue')) return [queue];
      if (sql.includes('FROM briefing_attendance')) return [existing];
      return [{ affectedRows: 1 }];
    }
  };
}

test('the first tap of a session creates one attendance list; later taps add attendees', async () => {
  const first = sessionConnection({ queue: [{ sid: 'SPV1', nama: 'Budi', role: 'PENGAWAS' }, { sid: 'MEK1', nama: 'Fathurrahman', role: 'MEKANIK' }] });
  await syncSessionBriefing(first, { idBox: 'BOX-1', session: 7 });
  const insert = first.calls.find(([sql]) => sql.startsWith('INSERT INTO briefing_attendance'));
  assert.deepEqual(insert[1].slice(0, 2), ['BOX-1', 7]);
  assert.deepEqual(JSON.parse(insert[1][4]).peserta.map(x => x.sid), ['MEK1']);

  const supervisorOnly = sessionConnection({ queue: [{ sid: 'SPV1', nama: 'Budi', role: 'PENGAWAS' }] });
  await syncSessionBriefing(supervisorOnly, { idBox: 'BOX-1', session: 8 });
  assert.equal(supervisorOnly.calls.some(([sql]) => sql.startsWith('INSERT INTO briefing_attendance')), false);

  const existing = [{ id: 5, status: 'DRAFT', payload: JSON.stringify(buildBriefingDraft({ people: [supervisor, mechanic] })) }];
  const later = sessionConnection({ queue: [{ sid: 'MEK1', nama: 'Fathurrahman', role: 'MEKANIK' }, { sid: 'GL1', nama: 'M. Suhaeri', role: 'MEKANIK FOREMAN' }], existing });
  await syncSessionBriefing(later, { idBox: 'BOX-1', session: 7 });
  const update = later.calls.find(([sql]) => sql.startsWith('UPDATE briefing_attendance'));
  const saved = JSON.parse(update[1][1]);
  assert.deepEqual(saved.peserta.map(x => x.sid), ['MEK1', 'GL1']);
  assert.equal(saved.yangMemimpin, 'M. Suhaeri');
  assert.equal(update[1][2], 5);
});

test('controller rejects invalid input, hides missing lists and passes permission errors through', async () => {
  const auth = { user: { sid: 'MEK1', nama: 'Fathurrahman', role: 'MEKANIK' }, role: 'teknisi' };
  BriefingModel.update = async () => assert.fail('invalid input must not be stored');
  const invalid = response();
  await BriefingController.update({ params: { id: '3' }, body: { data: { ...filled(), tanggalISO: 'x' } }, auth }, invalid);
  assert.equal(invalid.statusCode, 400);

  BriefingModel.update = async () => null;
  const missing = response();
  await BriefingController.update({ params: { id: '9' }, body: { data: filled() }, auth }, missing);
  assert.equal(missing.statusCode, 404);

  BriefingModel.create = async () => { throw Object.assign(new Error('Daftar hadir dibuat oleh foreman atau pengawas.'), { status: 403 }); };
  const denied = response();
  await BriefingController.create({ body: { data: filled() }, auth }, denied);
  assert.equal(denied.statusCode, 403);
});
