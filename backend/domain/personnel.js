// Jabatan lapangan untuk formulir LOTO dan daftar hadir.
// Foreman/group leader tersimpan sebagai "MEKANIK FOREMAN" (data HSE) dan tap kartu sebagai pekerja,
// jadi role sistemnya 'teknisi'; jabatannya dibedakan dari teks role aslinya.
import { normalizeRole } from '../security/session.js';

const FOREMAN = /FOREMAN|GROUP\s*LEADER|\bGL\b/i;

export const JABATAN_LABEL = Object.freeze({
  mekanik: 'Mekanik', foreman: 'Foreman', pengawas: 'Pengawas', admin: 'Admin', safety: 'Safety', fuelman: 'Fuelman'
});

export function jabatanOf(rawRole) {
  const role = normalizeRole(rawRole);
  if (role === 'teknisi') return FOREMAN.test(String(rawRole || '')) ? 'foreman' : 'mekanik';
  return role || '';
}

// Data personel lama belum punya field jabatan.
export const jabatanOfPerson = person => person?.jabatan || (person?.role === 'teknisi' ? 'mekanik' : person?.role || '');

export const namesOf = (people, jabatan) => (people || [])
  .filter(p => jabatanOfPerson(p) === jabatan).map(p => p.nama).filter(Boolean);

// Penanggung jawab lapangan: foreman/group leader; pengawas bila tidak ada foreman yang tap.
export const leaderNames = people => {
  const foremen = namesOf(people, 'foreman');
  return foremen.length ? foremen : namesOf(people, 'pengawas');
};

export function viewerOf(auth) {
  return { sid: auth.user.sid, nama: auth.user.nama, role: auth.role, jabatan: jabatanOf(auth.user.role) };
}

// Admin, pengawas, dan safety melihat semua formulir; mekanik/foreman hanya yang ia ikuti.
export const seesAllForms = viewer => ['admin', 'pengawas', 'safety'].includes(viewer.role);
export const isLeader = viewer => ['admin', 'pengawas'].includes(viewer.role) || viewer.jabatan === 'foreman';
export const isSupervisor = viewer => ['admin', 'pengawas'].includes(viewer.role);

export function signatureOf(viewer, now = new Date()) {
  return { sid: viewer.sid, nama: viewer.nama, jabatan: viewer.jabatan, waktu: now.toISOString() };
}

// Tap kartu per sesi box dari tapping_history: bukti siapa masuk/keluar dan kapan (tanda tangan kartu).
export function groupSessionTaps(rows) {
  const bySession = new Map();
  for (const row of rows) {
    const jabatan = jabatanOf(row.role);
    if (!row.sid || !['mekanik', 'foreman', 'pengawas'].includes(jabatan)) continue;
    const key = `${row.id_box}#${row.session_id}`;
    if (!bySession.has(key)) bySession.set(key, new Map());
    const people = bySession.get(key);
    const person = people.get(row.sid) || { sid: row.sid, nama: row.nama, jabatan, masuk: null, keluar: null };
    const iso = value => (value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null);
    if (row.event_type === 'IN') person.masuk = iso(row.first_at);
    if (row.event_type === 'OUT') person.keluar = iso(row.last_at);
    people.set(row.sid, person);
  }
  return new Map([...bySession].map(([key, people]) => [key, [...people.values()]]));
}
