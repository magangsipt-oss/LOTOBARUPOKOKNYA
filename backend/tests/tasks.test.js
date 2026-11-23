import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTasks } from '../domain/tasks.js';
import { dateRange } from '../domain/formFields.js';

const mechanic = { sid: 'MEK1', nama: 'Fathurrahman', role: 'teknisi', jabatan: 'mekanik' };
const foreman = { sid: 'GL1', nama: 'M. Suhaeri', role: 'teknisi', jabatan: 'foreman' };
const supervisor = { sid: 'SPV1', nama: 'Budi Santoso', role: 'pengawas', jabatan: 'pengawas' };
const safety = { sid: 'SAF1', nama: 'Sari', role: 'safety', jabatan: 'safety' };
const outsider = { sid: 'MEK9', nama: 'Eko', role: 'teknisi', jabatan: 'mekanik' };
const personel = [supervisor, mechanic, foreman];

const permit = (status, extra = {}) => ({
  id: 6, id_box: 'BOX-T1', unit: 'BMO1', session_id: 1, session_active: 0, status, created_by: 'SYSTEM',
  updated_at: '2026-11-23T06:00:00Z', payload: { personel, pekerjaan: 'Service unit', selesai: { status: status === 'DITUTUP' ? 'SELESAI' : '' } }, ...extra
});
const actions = (viewer, rows, briefings = []) => computeTasks({ permits: rows, briefings, viewer, today: '2026-11-23' }).map(t => `${t.jenis}:${t.aksi}`);

test('a permit travels mechanic -> foreman -> foreman, and a supervisor stands in only without a foreman', () => {
  assert.deepEqual(actions(mechanic, [permit('DRAFT')]), ['izin:lengkapi']);
  assert.deepEqual(actions(foreman, [permit('DRAFT')]), ['izin:lengkapi']);
  assert.deepEqual(actions(supervisor, [permit('DRAFT')]), []);

  assert.deepEqual(actions(mechanic, [permit('MENUNGGU')]), []);
  assert.deepEqual(actions(foreman, [permit('MENUNGGU')]), ['izin:setujui']);
  assert.deepEqual(actions(supervisor, [permit('MENUNGGU')]), []);
  const noForeman = permit('MENUNGGU', { payload: { personel: [supervisor, mechanic], selesai: { status: '' } } });
  assert.deepEqual(actions(supervisor, [noForeman]), ['izin:setujui']);

  // Closing is asked for once everyone has tapped out; not while the box session runs, never for manual permits.
  assert.deepEqual(actions(foreman, [permit('AKTIF', { session_active: 1 })]), []);
  assert.deepEqual(actions(foreman, [permit('AKTIF')]), ['izin:tutup']);
  assert.deepEqual(actions(foreman, [permit('AKTIF', { id_box: null, session_id: null, created_by: 'GL1' })]), []);
  assert.deepEqual(actions(foreman, [permit('DITUTUP')]), []);
  assert.deepEqual(actions(outsider, [permit('DRAFT')]), []);
  assert.deepEqual(actions(safety, [permit('MENUNGGU')]), []);
});

const briefing = (payload, extra = {}) => ({
  id: 4, id_box: 'BOX-T1', unit: 'BMO1', session_id: 1, status: 'DRAFT', created_by: 'SYSTEM', updated_at: '2026-11-23T06:00:00Z',
  payload: {
    tanggalISO: '2026-11-23', pembicara: 'M. Suhaeri', lokasi: 'Base Service', namaDokumen: 'IK Service & JSA',
    yangMemimpin: 'M. Suhaeri', mengetahui: 'Budi Santoso',
    peserta: [{ sid: 'MEK1', nama: 'Fathurrahman', jamTidur: null }, { sid: 'GL1', nama: 'M. Suhaeri', jamTidur: 7, jabatan: 'Foreman' }],
    ...payload
  },
  ...extra
});

test('an attendance list asks each attendee for sleep, then the foreman, then the supervisor', () => {
  assert.deepEqual(actions(mechanic, [], [briefing({})]), ['hadir:jamTidur']);
  assert.deepEqual(actions(foreman, [], [briefing({})]), ['hadir:lengkapi']);
  assert.deepEqual(actions(supervisor, [], [briefing({})]), []);

  const slept = { peserta: [{ sid: 'MEK1', nama: 'Fathurrahman', jamTidur: 6.5 }, { sid: 'GL1', nama: 'M. Suhaeri', jamTidur: 7, jabatan: 'Foreman' }] };
  assert.deepEqual(actions(foreman, [], [briefing(slept)]), ['hadir:ttdMemimpin']);
  assert.deepEqual(actions(supervisor, [], [briefing(slept)]), []);
  // Without a foreman among the attendees, the supervisor leads and signs "Yang memimpin".
  const mechanicsOnly = { peserta: [{ sid: 'MEK1', nama: 'Fathurrahman', jamTidur: 6.5, jabatan: 'Mekanik' }] };
  assert.deepEqual(actions(supervisor, [], [briefing(mechanicsOnly)]), ['hadir:ttdMemimpin']);
  const led = { ...slept, tandaTangan: { yangMemimpin: { sid: 'GL1' } } };
  assert.deepEqual(actions(supervisor, [], [briefing(led)]), ['hadir:ttdMengetahui']);
  assert.deepEqual(actions({ ...supervisor, sid: 'SPV2', nama: 'Lain' }, [], [briefing(led)]), []);
  assert.deepEqual(actions(supervisor, [], [briefing({ ...led, tandaTangan: { yangMemimpin: {}, mengetahui: {} } }, { status: 'LENGKAP' })]), []);
});

test('short sleep today alerts the foreman of the session, supervisors, safety and admin first', () => {
  const tired = briefing({ peserta: [{ sid: 'MEK1', nama: 'Fathurrahman', jamTidur: 4 }, { sid: 'GL1', nama: 'M. Suhaeri', jamTidur: 7, jabatan: 'Foreman' }] }, { status: 'LENGKAP' });
  for (const viewer of [foreman, supervisor, safety, { sid: 'A', nama: 'Admin', role: 'admin', jabatan: 'admin' }]) {
    const tasks = computeTasks({ permits: [permit('MENUNGGU')], briefings: [tired], viewer, today: '2026-11-23' });
    assert.equal(tasks.some(t => t.aksi === 'kelelahan'), true, viewer.sid);
    assert.equal(tasks[0].prioritas, 'darurat', viewer.sid);
    assert.match(tasks.find(t => t.aksi === 'kelelahan').detail, /Fathurrahman: tidur 4 jam/);
  }
  assert.deepEqual(actions(mechanic, [], [tired]), []);
  assert.deepEqual(computeTasks({ briefings: [tired], viewer: safety, today: '2026-11-24' }), []);
});

test('report periods need both dates in order', () => {
  assert.equal(dateRange({}), null);
  assert.deepEqual(dateRange({ dari: '2026-11-01', sampai: '2026-11-30' }), { dari: '2026-11-01', sampai: '2026-11-30' });
  assert.throws(() => dateRange({ dari: '2026-11-01' }), { status: 400 });
  assert.throws(() => dateRange({ dari: '2026-11-30', sampai: '2026-11-01' }), { status: 400 });
  assert.throws(() => dateRange({ dari: '2026-13-01', sampai: '2026-11-01' }), { status: 400 });
});
