// "Tugas Anda": ke mana laporan lapangan dikirim setelah disimpan. Setiap formulir yang belum selesai
// menjadi tugas bagi orang yang harus bertindak berikutnya; formulir selesai masuk rekap HSE.
//   Izin LOTO  : mekanik melengkapi -> foreman menyetujui -> (semua tap keluar) foreman menutup.
//   Daftar hadir: peserta mengisi jam tidur -> foreman melengkapi & tanda tangan -> supervisor mengetahui.
//   Kurang tidur hari ini: peringatan untuk foreman sesi, pengawas, safety, dan admin.
// Pengawas menjadi penanggung jawab cadangan bila tidak ada foreman yang ikut sesi.
import { canSeePermit, parsePermitPayload, permitInvolves, permitPermissions } from './lotoPermit.js';
import {
  briefingDataGaps, briefingInvolves, briefingPermissions, canSeeBriefing, fatigueWarnings, parseBriefingPayload
} from './briefing.js';
import { jabatanOfPerson } from './personnel.js';

const PRIORITY = { darurat: 0, tinggi: 1, normal: 2 };
const placeOf = row => (row.id_box ? `${row.id_box}${row.unit ? ` (${row.unit})` : ''}` : 'Manual');
const hasForeman = people => (people || []).some(p => jabatanOfPerson(p) === 'foreman');
// Peserta daftar hadir menyimpan label jabatan ("Foreman", bisa diketik ulang), bukan kode sistem.
const listHasForeman = peserta => (peserta || []).some(x => /FOREMAN|GROUP\s*LEADER|\bGL\b/i.test(String(x.jabatan || '')));

function leadsPermit(row, payload, viewer) {
  if (viewer.jabatan === 'foreman') return permitInvolves(row, payload, viewer);
  if (viewer.role === 'pengawas') return !hasForeman(payload.personel);
  return false;
}

function permitTasks(row, viewer) {
  const p = parsePermitPayload(row);
  if (row.status === 'DITUTUP' || !canSeePermit(row, p, viewer)) return [];
  const can = permitPermissions(row, p, viewer);
  const base = { jenis: 'izin', formId: Number(row.id), tempat: placeOf(row), waktu: row.updated_at || row.created_at };
  const sessionActive = Boolean(Number(row.session_active || 0));
  if (row.status === 'DRAFT' && viewer.role === 'teknisi' && can.ubah) {
    return [{ ...base, aksi: 'lengkapi', prioritas: 'normal', judul: `Lengkapi izin LOTO #${row.id}`, detail: 'Isi lokasi, pekerjaan, inspeksi, dan titik isolasi, lalu centang LOTO Dipasang.' }];
  }
  if (row.status === 'MENUNGGU' && can.setujui && leadsPermit(row, p, viewer)) {
    return [{ ...base, aksi: 'setujui', prioritas: 'tinggi', judul: `Setujui izin LOTO #${row.id}`, detail: p.pekerjaan || 'Isian lengkap, menunggu persetujuan penanggung jawab.' }];
  }
  // Izin manual tidak punya sinyal tap keluar, jadi hanya izin dari box yang diingatkan untuk ditutup.
  if (row.status === 'AKTIF' && row.id_box && !sessionActive && can.tutup && leadsPermit(row, p, viewer)) {
    return [{ ...base, aksi: 'tutup', prioritas: 'tinggi', judul: `Tutup izin LOTO #${row.id} (bagian III)`, detail: 'Semua personel sudah tap keluar di box: tarik LOTO dan tutup izin.' }];
  }
  return [];
}

function briefingTasks(row, viewer, today) {
  const p = parseBriefingPayload(row);
  if (!canSeeBriefing(row, p, viewer)) return [];
  const can = briefingPermissions(row, p, viewer);
  const base = { jenis: 'hadir', formId: Number(row.id), tempat: placeOf(row), waktu: row.updated_at || row.created_at };
  const tasks = [];
  if (row.status !== 'LENGKAP') {
    const me = p.peserta.find(x => x.sid === viewer.sid);
    if (me && (me.jamTidur === null || me.jamTidur === undefined) && (can.jamTidurSendiri || can.ubah)) {
      tasks.push({ ...base, aksi: 'jamTidur', prioritas: 'tinggi', judul: `Isi jam tidur Anda (daftar hadir #${row.id})`, detail: 'Pemeriksaan kelelahan sebelum bekerja.' });
    }
    const gaps = briefingDataGaps(p);
    if (gaps.length && can.ubah && viewer.jabatan === 'foreman') {
      tasks.push({ ...base, aksi: 'lengkapi', prioritas: 'normal', judul: `Lengkapi daftar hadir #${row.id}`, detail: `Belum diisi: ${gaps.join(', ')}.` });
    }
    if (!gaps.length && can.ttdMemimpin && (viewer.jabatan === 'foreman' || !listHasForeman(p.peserta))) {
      tasks.push({ ...base, aksi: 'ttdMemimpin', prioritas: 'tinggi', judul: `Tanda tangani "Yang memimpin" (daftar hadir #${row.id})`, detail: p.namaDokumen || 'Daftar hadir sosialisasi' });
    }
    if (!gaps.length && p.tandaTangan?.yangMemimpin && can.ttdMengetahui && viewer.role === 'pengawas' && (!p.mengetahui || p.mengetahui === viewer.nama)) {
      tasks.push({ ...base, aksi: 'ttdMengetahui', prioritas: 'normal', judul: `Tanda tangani "Mengetahui" (daftar hadir #${row.id})`, detail: p.namaDokumen || 'Daftar hadir sosialisasi' });
    }
  }
  const warnings = p.tanggalISO === today ? fatigueWarnings(p) : [];
  const alerted = ['pengawas', 'safety', 'admin'].includes(viewer.role) || (viewer.jabatan === 'foreman' && briefingInvolves(row, p, viewer));
  if (warnings.length && alerted) {
    tasks.push({ ...base, aksi: 'kelelahan', prioritas: 'darurat', judul: `Kurang tidur hari ini (daftar hadir #${row.id})`, detail: `${warnings.join('; ')}. Lakukan evaluasi kelelahan sebelum bekerja.` });
  }
  return tasks;
}

export function computeTasks({ permits = [], briefings = [], viewer, today }) {
  const tasks = [
    ...permits.flatMap(row => permitTasks(row, viewer)),
    ...briefings.flatMap(row => briefingTasks(row, viewer, today))
  ];
  return tasks
    .map(task => ({ ...task, id: `${task.jenis}-${task.formId}-${task.aksi}` }))
    .sort((a, b) => PRIORITY[a.prioritas] - PRIORITY[b.prioritas] || new Date(b.waktu || 0) - new Date(a.waktu || 0));
}
