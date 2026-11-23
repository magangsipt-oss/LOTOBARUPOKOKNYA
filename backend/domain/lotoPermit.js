// Izin LOTO digital, mengikuti formulir kertas F-PLT-116 "Izin Penguncian Mesin, Alat, Unit/Instalasi".
// Status dihitung dari isi formulir; aturan keselamatan ditegakkan di sini, bukan di browser.

export const SHIFTS = ['I', 'II', 'III'];
const MAX_MESIN = 10;
const MAX_TITIK = 20;
const LOTO_TIMEZONE = process.env.LOTO_TIMEZONE || process.env.DOP_TIMEZONE || 'Asia/Makassar';
// Kepala dokumen diisi per izin; nilai awal mengikuti revisi formulir kertas yang berlaku.
export const DEFAULT_DOKUMEN = Object.freeze({ nomor: 'F-PLT-116', tanggalEfektif: '2017-11-16', revisi: '0', halaman: '1 dari 1' });

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function text(value, field, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) fail(`Kolom ${field} tidak valid.`);
  return value.trim();
}

function flag(value, field) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') fail(`Kolom ${field} tidak valid.`);
  return value;
}

function isoDate(value, field, required = false) {
  const v = text(value, field, 10);
  if (!v) {
    if (required) fail(`Kolom ${field} wajib diisi.`);
    return '';
  }
  const date = new Date(`${v}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== v) {
    fail(`Kolom ${field} tidak valid.`);
  }
  return v;
}

function clock(value, field) {
  const v = text(value, field, 5);
  if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(`Kolom ${field} tidak valid.`);
  return v;
}

function object(value, field) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`Kolom ${field} tidak valid.`);
  return value;
}

// Baris kosong (tanpa nama dan tanpa centang) dibuang; baris bercentang tanpa nama ditolak.
function rows(value, label, max, map) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) fail(`Daftar ${label} tidak valid (maksimal ${max} baris).`);
  return value
    .map((row, index) => ({ row: map(object(row, `${label} ${index + 1}`), index + 1), index: index + 1 }))
    .filter(({ row }) => row.nama || Object.values(row).some(v => v === true))
    .map(({ row, index }) => {
      if (!row.nama) fail(`Nama ${label} baris ${index} wajib diisi.`);
      return row;
    });
}

export function emptyPermitPayload(tanggalISO = '') {
  return {
    dokumen: { ...DEFAULT_DOKUMEN },
    projectNo: '',
    tanggalISO,
    lokasi: '',
    pekerjaan: '',
    inspeksi: '',
    defisiensi: '',
    diperbaiki: false,
    mesin: [],
    titik: [],
    alternatif: { blockControlSwitch: false, pullwire: false, handleValve: false, lainnya: false, lainnyaKet: '' },
    shift: Object.fromEntries(SHIFTS.map(s => [s, { teknisi: '', groupLeader: '', tanggal: '', waktu: '' }])),
    keterangan: '',
    selesai: { status: '', teknisi: '', teknisiTanggal: '', teknisiWaktu: '', pjTeknis: '', pjTanggal: '', pjWaktu: '' }
  };
}

// Isi formulir dari browser. Kolom yang dikelola server (personel, shiftOtomatis) tidak dibaca dari sini.
export function validateLotoPermitPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Data izin LOTO tidak valid.');
  const inspeksi = text(value.inspeksi, 'Inspeksi Lapangan', 6);
  if (!['', 'OK', 'NOT_OK'].includes(inspeksi)) fail('Kolom Inspeksi Lapangan tidak valid.');
  const alternatif = object(value.alternatif, 'langkah tambahan');
  const shiftInput = object(value.shift, 'shift');
  const selesai = object(value.selesai, 'pekerjaan selesai');
  const selesaiStatus = text(selesai.status, 'status pekerjaan', 7);
  if (!['', 'SELESAI', 'BELUM'].includes(selesaiStatus)) fail('Status pekerjaan selesai tidak valid.');

  const dokumen = value.dokumen === undefined ? { ...DEFAULT_DOKUMEN } : object(value.dokumen, 'kepala dokumen');
  const payload = {
    dokumen: {
      nomor: text(dokumen.nomor, 'No. Dokumen', 50),
      tanggalEfektif: isoDate(dokumen.tanggalEfektif, 'Tanggal Efektif'),
      revisi: text(dokumen.revisi, 'Revisi', 10),
      halaman: text(dokumen.halaman, 'Halaman', 20)
    },
    projectNo: text(value.projectNo, 'Project No.', 50),
    tanggalISO: isoDate(value.tanggalISO, 'Tanggal', true),
    lokasi: text(value.lokasi, 'Lokasi', 200),
    pekerjaan: text(value.pekerjaan, 'Penjelasan Pekerjaan', 1000),
    inspeksi,
    defisiensi: text(value.defisiensi, 'Penjelasan Defisiensi', 2000),
    diperbaiki: flag(value.diperbaiki, 'Diperbaiki'),
    mesin: rows(value.mesin, 'mesin/alat', MAX_MESIN, (row, n) => ({
      nama: text(row.nama, `mesin ${n}`, 100),
      terisolasi: flag(row.terisolasi, `Terisolasi mesin ${n}`),
      kembaliNormal: flag(row.kembaliNormal, `Kembali Normal mesin ${n}`)
    })),
    titik: rows(value.titik, 'titik isolasi', MAX_TITIK, (row, n) => ({
      nama: text(row.nama, `titik isolasi ${n}`, 150),
      dipasang: flag(row.dipasang, `LOTO Dipasang titik ${n}`),
      ditarik: flag(row.ditarik, `LOTO Ditarik titik ${n}`)
    })),
    alternatif: {
      blockControlSwitch: flag(alternatif.blockControlSwitch, 'Block Control Switch'),
      pullwire: flag(alternatif.pullwire, 'Pullwire'),
      handleValve: flag(alternatif.handleValve, 'Handle Valve diangkat'),
      lainnya: flag(alternatif.lainnya, 'Lainnya'),
      lainnyaKet: text(alternatif.lainnyaKet, 'keterangan langkah lainnya', 200)
    },
    shift: Object.fromEntries(SHIFTS.map(s => {
      const row = object(shiftInput[s], `shift ${s}`);
      return [s, {
        teknisi: text(row.teknisi, `Teknisi shift ${s}`, 1000),
        groupLeader: text(row.groupLeader, `Group Leader shift ${s}`, 1000),
        tanggal: isoDate(row.tanggal, `Tanggal shift ${s}`),
        waktu: clock(row.waktu, `Waktu shift ${s}`)
      }];
    })),
    keterangan: text(value.keterangan, 'Keterangan', 500),
    selesai: {
      status: selesaiStatus,
      teknisi: text(selesai.teknisi, 'Teknisi (pekerjaan selesai)', 100),
      teknisiTanggal: isoDate(selesai.teknisiTanggal, 'Tanggal teknisi'),
      teknisiWaktu: clock(selesai.teknisiWaktu, 'Waktu teknisi'),
      pjTeknis: text(selesai.pjTeknis, 'Penanggung Jawab Teknis', 100),
      pjTanggal: isoDate(selesai.pjTanggal, 'Tanggal penanggung jawab teknis'),
      pjWaktu: clock(selesai.pjWaktu, 'Waktu penanggung jawab teknis')
    }
  };

  payload.mesin.forEach((m, i) => {
    if (m.kembaliNormal && !m.terisolasi) fail(`Mesin ${i + 1}: tidak bisa "Kembali Normal" sebelum "Terisolasi".`);
  });
  payload.titik.forEach((t, i) => {
    if (t.ditarik && !t.dipasang) fail(`Titik isolasi ${i + 1}: LOTO tidak bisa ditarik sebelum dipasang.`);
  });
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 100_000) fail('Ukuran data izin LOTO terlalu besar.');
  return payload;
}

// Hal yang masih kurang sebelum izin boleh dianggap AKTIF (LOTO sudah terpasang dan sah dikerjakan).
export function activationGaps(p) {
  const gaps = [];
  const dok = p.dokumen || DEFAULT_DOKUMEN;
  if (!dok.nomor || !dok.tanggalEfektif || !dok.revisi) gaps.push('kepala dokumen (No. Dokumen, Tanggal Efektif, Revisi)');
  if (!p.pekerjaan) gaps.push('penjelasan pekerjaan');
  if (!p.lokasi) gaps.push('lokasi');
  if (!p.inspeksi) gaps.push('hasil inspeksi lapangan');
  else if (p.inspeksi === 'NOT_OK' && !(p.defisiensi && p.diperbaiki)) gaps.push('penjelasan defisiensi dan centang "Diperbaiki"');
  if (!p.mesin.length) gaps.push('mesin/alat yang diisolasi');
  else if (p.mesin.some(m => !m.terisolasi)) gaps.push('centang "Terisolasi" pada semua mesin');
  const alt = p.alternatif;
  const anyAlternative = alt.blockControlSwitch || alt.pullwire || alt.handleValve || alt.lainnya;
  if (!p.titik.length && !anyAlternative) gaps.push('titik isolasi (atau langkah tambahan bila tidak bisa dikunci)');
  if (p.titik.some(t => !t.dipasang)) gaps.push('centang "LOTO Dipasang" pada semua titik isolasi');
  if (alt.lainnya && !alt.lainnyaKet) gaps.push('keterangan langkah tambahan "lainnya"');
  if (!SHIFTS.some(s => p.shift[s].teknisi && p.shift[s].groupLeader)) gaps.push('teknisi dan group leader pada salah satu shift');
  return gaps;
}

// DRAFT -> AKTIF -> DITUTUP. Melepas LOTO selama sesi box masih berjalan selalu ditolak:
// box baru menutup sesi setelah semua mekanik tap keluar dan pengawas tap keluar.
export function resolvePermitStatus(p, { sessionActive = false } = {}) {
  // Menutup izin (SELESAI maupun BELUM) juga berarti tidak ada lagi personel di area isolasi.
  const releasing = p.titik.some(t => t.ditarik) || p.mesin.some(m => m.kembaliNormal) || Boolean(p.selesai.status);
  if (releasing && sessionActive) {
    fail('Sesi LOTO di box masih berjalan. LOTO baru boleh ditarik dan izin baru boleh ditutup setelah semua personel tap keluar dan pengawas menutup sesi di box.', 409);
  }
  if (!p.selesai.status) return activationGaps(p).length ? 'DRAFT' : 'AKTIF';

  const gaps = activationGaps(p);
  if (gaps.length) fail(`Izin belum lengkap, belum bisa ditutup: ${gaps.join(', ')}.`);
  if (!p.selesai.teknisi || !p.selesai.pjTeknis) fail('Bagian III: nama teknisi dan penanggung jawab teknis wajib diisi.');
  if (p.selesai.status === 'SELESAI') {
    if (p.titik.some(t => !t.ditarik)) fail('Pekerjaan selesai: semua titik isolasi harus dicentang "LOTO Ditarik".');
    if (p.mesin.some(m => !m.kembaliNormal)) fail('Pekerjaan selesai: semua mesin harus dicentang "Kembali Normal".');
  }
  return 'DITUTUP';
}

export function localParts(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: LOTO_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, hour: Number(parts.hour) };
}

// Tanggal & waktu tanda tangan bagian III diisi waktu simpan bila dikosongkan.
export function stampClosing(p, now = new Date()) {
  if (!p.selesai.status) return p;
  const { date, time } = localParts(now);
  const s = { ...p.selesai };
  if (!s.teknisiTanggal) s.teknisiTanggal = date;
  if (!s.teknisiWaktu) s.teknisiWaktu = time;
  if (!s.pjTanggal) s.pjTanggal = date;
  if (!s.pjWaktu) s.pjWaktu = time;
  return { ...p, selesai: s };
}

const namesOf = (people, role) => people.filter(p => p.role === role).map(p => p.nama).filter(Boolean);

function appendNames(current, names) {
  const known = new Set(String(current || '').split(',').map(n => n.trim()).filter(Boolean));
  const added = names.filter(n => !known.has(n));
  if (!added.length) return current;
  return [current, ...added].filter(Boolean).join(', ').slice(0, 1000);
}

// Draft dari sesi box: tanggal, unit, kolom shift berjalan, dan personel yang tap. Sisanya diisi pengawas.
// Shift I = 06.00-17.59, Shift II = 18.00-05.59 waktu lokal (pola 2 shift sistem); Shift III untuk lanjutan.
export function buildPermitDraft({ unit, people, now = new Date() }) {
  const { date, time, hour } = localParts(now);
  const column = hour >= 6 && hour < 18 ? 'I' : 'II';
  const payload = emptyPermitPayload(date);
  const unitName = String(unit || '').trim().slice(0, 100);
  if (unitName) payload.mesin = [{ nama: unitName, terisolasi: false, kembaliNormal: false }];
  payload.shift[column] = {
    teknisi: appendNames('', namesOf(people, 'teknisi')),
    groupLeader: appendNames('', namesOf(people, 'pengawas')),
    tanggal: date,
    waktu: time
  };
  payload.shiftOtomatis = column;
  payload.personel = people;
  return payload;
}

// Personel yang tap belakangan ditambahkan sekali; nama ikut ke kolom shift selama izin masih DRAFT.
export function mergePermitPeople(payload, people, isDraft) {
  const known = new Set((payload.personel || []).map(p => p.sid));
  const added = people.filter(p => !known.has(p.sid));
  if (!added.length) return null;
  const next = { ...payload, personel: [...(payload.personel || []), ...added] };
  const column = payload.shiftOtomatis;
  if (isDraft && SHIFTS.includes(column)) {
    const row = payload.shift?.[column] || { teknisi: '', groupLeader: '', tanggal: '', waktu: '' };
    next.shift = {
      ...payload.shift,
      [column]: {
        ...row,
        teknisi: appendNames(row.teknisi, namesOf(added, 'teknisi')),
        groupLeader: appendNames(row.groupLeader, namesOf(added, 'pengawas'))
      }
    };
  }
  return next;
}

export function parsePermitPayload(row) {
  let payload = row.payload;
  if (typeof payload === 'string') payload = JSON.parse(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Data izin LOTO ${row.id} tidak valid di database.`);
  }
  return payload;
}

function gapsOf(payload) {
  try { return activationGaps({ ...emptyPermitPayload(), ...payload }); }
  catch { return []; }
}

export function formatPermit(row) {
  const payload = parsePermitPayload(row);
  return {
    ...payload,
    kekurangan: row.status === 'DRAFT' ? gapsOf(payload) : [],
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
