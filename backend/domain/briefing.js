// Daftar hadir sosialisasi digital, mengikuti formulir kertas F-HSE-105.
// Peserta terisi dari tap kartu di box (tap = tanda tangan peserta). Jam tidur diisi tiap peserta sebagai
// pemeriksaan kelelahan. "Yang memimpin" (foreman) dan "Mengetahui" (supervisor) bertanda tangan lewat akun.
import { clock, fail, isoDate, object, text } from './formFields.js';
import { localParts } from './lotoPermit.js';
import {
  JABATAN_LABEL, isLeader, isSupervisor, jabatanOfPerson, namesOf, seesAllForms, signatureOf
} from './personnel.js';

export const DEFAULT_DOKUMEN_HADIR = Object.freeze({ nomor: 'F-HSE-105', tanggalEfektif: '2017-02-25', revisi: '1', halaman: '1 dari 1' });
const configuredSleep = Number(process.env.FATIGUE_MIN_SLEEP_HOURS);
// Batas jam tidur minimal sebelum bekerja (aturan kelelahan); bisa diatur lewat FATIGUE_MIN_SLEEP_HOURS.
export const MIN_JAM_TIDUR = Number.isFinite(configuredSleep) && configuredSleep > 0 && configuredSleep <= 24 ? configuredSleep : 6;
export const MAX_PESERTA = 40;
export const SIGN_SLOTS = ['yangMemimpin', 'mengetahui'];

export function emptyBriefingPayload(tanggalISO = '') {
  return {
    dokumen: { ...DEFAULT_DOKUMEN_HADIR },
    departemen: '',
    tanggalISO,
    waktu: '',
    pembicara: '',
    lokasi: '',
    namaDokumen: '',
    revisiDokumen: '',
    tanggalEfektifDokumen: '',
    peserta: [],
    yangMemimpin: '',
    mengetahui: ''
  };
}

function hours(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 24) fail(`Kolom ${field} tidak valid (0 sampai 24 jam).`);
  return Math.round(n * 10) / 10;
}

// Isi formulir dari browser. Tanda tangan akun (tandaTangan) dikelola server.
export function validateBriefingPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Data daftar hadir tidak valid.');
  const dokumen = value.dokumen === undefined ? { ...DEFAULT_DOKUMEN_HADIR } : object(value.dokumen, 'kepala dokumen');
  if (value.peserta !== undefined && (!Array.isArray(value.peserta) || value.peserta.length > MAX_PESERTA)) {
    fail(`Daftar peserta tidak valid (maksimal ${MAX_PESERTA} orang).`);
  }
  const peserta = (value.peserta || [])
    .map((row, i) => {
      const r = object(row, `peserta ${i + 1}`);
      return {
        sid: text(r.sid, `SID peserta ${i + 1}`, 50),
        nama: text(r.nama, `nama peserta ${i + 1}`, 100),
        instansi: text(r.instansi, `instansi peserta ${i + 1}`, 100),
        jamTidur: hours(r.jamTidur, `jam tidur peserta ${i + 1}`),
        jabatan: text(r.jabatan, `jabatan peserta ${i + 1}`, 100)
      };
    })
    .filter(r => r.nama || r.sid || r.instansi || r.jabatan || r.jamTidur !== null)
    .map((r, i) => {
      if (!r.nama) fail(`Nama peserta baris ${i + 1} wajib diisi.`);
      return r;
    });
  return {
    dokumen: {
      nomor: text(dokumen.nomor, 'No. Dokumen', 50),
      tanggalEfektif: isoDate(dokumen.tanggalEfektif, 'Tanggal Efektif'),
      revisi: text(dokumen.revisi, 'Revisi', 10),
      halaman: text(dokumen.halaman, 'Halaman', 20)
    },
    departemen: text(value.departemen, 'Departemen', 100),
    tanggalISO: isoDate(value.tanggalISO, 'Hari/Tanggal', true),
    waktu: clock(value.waktu, 'Waktu'),
    pembicara: text(value.pembicara, 'Pembicara', 100),
    lokasi: text(value.lokasi, 'Lokasi', 200),
    namaDokumen: text(value.namaDokumen, 'Nama Dokumen', 200),
    revisiDokumen: text(value.revisiDokumen, 'Revisi dokumen', 20),
    tanggalEfektifDokumen: isoDate(value.tanggalEfektifDokumen, 'Tanggal Efektif dokumen'),
    peserta,
    yangMemimpin: text(value.yangMemimpin, 'Yang memimpin', 100),
    mengetahui: text(value.mengetahui, 'Mengetahui', 100)
  };
}

// Isi yang harus ada sebelum yang memimpin/mengetahui boleh tanda tangan.
export function briefingDataGaps(p) {
  const gaps = [];
  if (!p.pembicara) gaps.push('pembicara');
  if (!p.lokasi) gaps.push('lokasi');
  if (!p.namaDokumen) gaps.push('nama dokumen yang disosialisasikan');
  if (!p.peserta.length) gaps.push('peserta');
  else if (p.peserta.some(x => x.jamTidur === null || x.jamTidur === undefined)) gaps.push('jam tidur semua peserta');
  return gaps;
}

export function briefingGaps(p) {
  const gaps = briefingDataGaps(p);
  if (!p.tandaTangan?.yangMemimpin) gaps.push('tanda tangan yang memimpin (foreman)');
  if (!p.tandaTangan?.mengetahui) gaps.push('tanda tangan mengetahui (supervisor)');
  return gaps;
}

export const resolveBriefingStatus = p => (briefingGaps(p).length ? 'DRAFT' : 'LENGKAP');

export const fatigueWarnings = p => (p.peserta || [])
  .filter(x => x.jamTidur !== null && x.jamTidur !== undefined && x.jamTidur < MIN_JAM_TIDUR)
  .map(x => `${x.nama}: tidur ${x.jamTidur} jam (minimal ${MIN_JAM_TIDUR} jam)`);

export function signBriefing(p, slot, viewer, now = new Date()) {
  if (!SIGN_SLOTS.includes(slot)) fail('Kolom tanda tangan tidak dikenal.');
  if (slot === 'yangMemimpin' && !isLeader(viewer)) fail('Tanda tangan "Yang memimpin" dilakukan foreman atau pengawas.', 403);
  if (slot === 'mengetahui' && !isSupervisor(viewer)) fail('Tanda tangan "Mengetahui" dilakukan pengawas (supervisor).', 403);
  if (p.tandaTangan?.[slot]) fail('Kolom ini sudah ditandatangani.', 409);
  const gaps = briefingDataGaps(p);
  if (gaps.length) fail(`Daftar hadir belum lengkap, belum bisa ditandatangani: ${gaps.join(', ')}.`);
  return {
    ...p,
    [slot]: p[slot] || String(viewer.nama || '').slice(0, 100),
    tandaTangan: { ...(p.tandaTangan || {}), [slot]: signatureOf(viewer, now) }
  };
}

// Peserta dari box: mekanik dan foreman yang tap kartu. Pengawas tercatat sebagai "Mengetahui".
const attendeesOf = people => (people || [])
  .filter(p => ['mekanik', 'foreman'].includes(jabatanOfPerson(p)))
  .map(p => ({ sid: p.sid, nama: String(p.nama || '').slice(0, 100), instansi: '', jamTidur: null, jabatan: JABATAN_LABEL[jabatanOfPerson(p)] }));

export function buildBriefingDraft({ people, now = new Date() }) {
  const { date, time } = localParts(now);
  const payload = emptyBriefingPayload(date);
  payload.waktu = time;
  payload.peserta = attendeesOf(people).slice(0, MAX_PESERTA);
  payload.yangMemimpin = namesOf(people, 'foreman')[0] || '';
  payload.mengetahui = namesOf(people, 'pengawas')[0] || '';
  return payload;
}

export function mergeBriefingPeople(payload, people) {
  const known = new Set((payload.peserta || []).map(x => x.sid).filter(Boolean));
  const room = MAX_PESERTA - (payload.peserta || []).length;
  const added = attendeesOf(people).filter(x => !known.has(x.sid)).slice(0, Math.max(0, room));
  const next = { ...payload, peserta: [...(payload.peserta || []), ...added] };
  let changed = added.length > 0;
  if (!next.yangMemimpin && namesOf(people, 'foreman')[0]) { next.yangMemimpin = namesOf(people, 'foreman')[0]; changed = true; }
  if (!next.mengetahui && namesOf(people, 'pengawas')[0]) { next.mengetahui = namesOf(people, 'pengawas')[0]; changed = true; }
  return changed ? next : null;
}

export const briefingInvolves = (row, p, viewer) => row.created_by === viewer.sid || (p.peserta || []).some(x => x.sid === viewer.sid);
export const canSeeBriefing = (row, p, viewer) => seesAllForms(viewer) || briefingInvolves(row, p, viewer);

export function briefingPermissions(row, p, viewer) {
  const involved = briefingInvolves(row, p, viewer);
  const full = ['admin', 'pengawas'].includes(viewer.role) || (viewer.jabatan === 'foreman' && involved);
  const attendee = (p.peserta || []).some(x => x.sid === viewer.sid);
  return {
    ubah: full,
    jamTidurSendiri: !full && viewer.role === 'teknisi' && attendee,
    ttdMemimpin: full && isLeader(viewer) && !p.tandaTangan?.yangMemimpin,
    ttdMengetahui: isSupervisor(viewer) && !p.tandaTangan?.mengetahui,
    hapus: viewer.role === 'admin' || (viewer.role === 'pengawas' && row.status === 'DRAFT')
  };
}

// Mekanik hanya mengisi jam tidurnya sendiri; isi lain diambil dari data tersimpan.
export function applyOwnSleep(stored, incoming, viewer) {
  const mine = incoming.peserta.find(x => x.sid === viewer.sid);
  if (!mine) fail('Anda tidak terdaftar sebagai peserta daftar hadir ini.', 403);
  return { ...stored, peserta: stored.peserta.map(x => (x.sid === viewer.sid ? { ...x, jamTidur: mine.jamTidur } : x)) };
}

export function parseBriefingPayload(row) {
  let payload = row.payload;
  if (typeof payload === 'string') payload = JSON.parse(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Data daftar hadir ${row.id} tidak valid di database.`);
  }
  return { ...emptyBriefingPayload(), ...payload };
}

export function formatBriefing(row, { viewer = null, taps = [] } = {}) {
  const payload = parseBriefingPayload(row);
  return {
    ...payload,
    tandaTangan: payload.tandaTangan || {},
    kekurangan: row.status === 'LENGKAP' ? [] : briefingGaps(payload),
    peringatan: fatigueWarnings(payload),
    minJamTidur: MIN_JAM_TIDUR,
    tapKartu: taps,
    izin: viewer ? briefingPermissions(row, payload, viewer) : { ubah: false, jamTidurSendiri: false, ttdMemimpin: false, ttdMengetahui: false, hapus: false },
    id: Number(row.id),
    status: row.status,
    idBox: row.id_box ?? null,
    sessionId: row.session_id ?? null,
    unit: row.unit ?? null,
    sessionActive: Boolean(Number(row.session_active || 0)),
    createdBy: row.created_by,
    updatedBy: row.updated_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null
  };
}
