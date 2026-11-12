// Mapping data karyawan HSE Automation (getEmployee) ke tabel users E-LOTO.
// Modul ini murni: tidak menyentuh database, sehingga rencana import dapat diuji.
import { normalizeRole } from '../security/session.js';

// Nilai role yang disimpan. Firmware hanya mengenal PENGAWAS, FUELMAN, dan
// selain itu MEKANIK; "MEKANIK FOREMAN" tetap tapping sebagai pekerja.
export const HSE_ROLES = Object.freeze({
  PENGAWAS: 'PENGAWAS',
  MEKANIK: 'MEKANIK',
  FOREMAN: 'MEKANIK FOREMAN',
  SAFETY: 'SAFETY',
});

const ACTIVE_STATUSES = new Set(['AKTIF', 'BARU']);
const SID_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;
const RFID_PATTERN = /^\d{8,20}$/;
const MAX_NAME_LENGTH = 100;

const SAFETY_POSITION = /SAFETY|\bHSE\b|\bK3\b|\bOHS\b/;
const SAFETY_DEPARTMENT_LEVELS = new Set(['SUPERVISOR/OFFICER', 'FOREMAN/GROUP LEADER', 'SUPERINTENDENT', 'ENGINEER/SPECIALIST']);
const FOREMAN_POSITION = /FOREMAN|GROUP LEADER|\bGL\b/;
const SUPERVISOR_LEVELS = new Set(['SUPERVISOR/OFFICER', 'SUPERINTENDENT']);
const SUPERVISOR_POSITION = /SUPERVISOR|\bSPV\b|SUPERINTENDENT/;
const MECHANIC_LEVELS = new Set(['MEKANIK', 'TECHNICIAN']);
const MECHANIC_POSITION = /MEKANIK|MECHANIC|TECHNICIAN|ELECTRIC|WELDER/;

const upper = value => String(value ?? '').trim().toUpperCase();

/**
 * @param {unknown} body Response JSON getEmployee.
 * @returns {object[]}
 */
export function extractHseRecords(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.results)) {
    throw new Error('Format JSON HSE tidak dikenal: field "results" (array) tidak ditemukan.');
  }
  return body.results;
}

/**
 * @param {object} record Satu karyawan HSE.
 * @returns {string|null} Role E-LOTO, atau null jika jabatan tidak relevan.
 */
export function classifyHseEmployee(record) {
  const level = upper(record?.functionalPosition);
  const position = upper(record?.structuralPosition);
  const department = `${upper(record?.departmentName)} ${upper(record?.divisionName)}`;

  if (SAFETY_POSITION.test(position)) return HSE_ROLES.SAFETY;
  if (/\bHSE\b/.test(department) && SAFETY_DEPARTMENT_LEVELS.has(level)) return HSE_ROLES.SAFETY;
  if (level.includes('FOREMAN') || FOREMAN_POSITION.test(position)) return HSE_ROLES.FOREMAN;
  if (SUPERVISOR_LEVELS.has(level) && SUPERVISOR_POSITION.test(position)) return HSE_ROLES.PENGAWAS;
  if (MECHANIC_LEVELS.has(level) || MECHANIC_POSITION.test(position)) return HSE_ROLES.MEKANIK;
  return null;
}

/**
 * Ambil hanya field yang dibutuhkan E-LOTO. Data pribadi lain (KTP, tanggal lahir, dll.) dibuang.
 * @param {object} record
 * @returns {{sid: string, nama: string, role: string, rfid_uid: string|null}|null}
 */
export function toLotoUser(record) {
  if (!ACTIVE_STATUSES.has(upper(record?.status))) return null;
  const sid = String(record?.sidCode ?? '').trim();
  if (!SID_PATTERN.test(sid)) return null;
  const nama = String(record?.name ?? '').trim().slice(0, MAX_NAME_LENGTH);
  if (!nama) return null;
  const role = classifyHseEmployee(record);
  if (!role) return null;

  const card = String(record?.rfidCardNo ?? '').trim();
  // Safety hanya mengawasi; tanpa kartu, boks tidak akan menerima tap mereka.
  const rfid_uid = role !== HSE_ROLES.SAFETY && RFID_PATTERN.test(card) ? card : null;
  return { sid, nama, role, rfid_uid };
}

const isAdmin = user => normalizeRole(user?.role) === 'admin';
const sameValue = (a, b) => String(a ?? '') === String(b ?? '');
const isChanged = (current, target) =>
  !sameValue(current.nama, target.nama) || !sameValue(current.role, target.role) || !sameValue(current.rfid_uid, target.rfid_uid);

function resolveTargets(incoming, existingBySid, holderByRfid) {
  const seenSids = new Set();
  const seenCards = new Set();
  const targets = [];
  const skipped = [];

  for (const user of incoming) {
    if (seenSids.has(user.sid)) { skipped.push({ sid: user.sid, reason: 'duplicate_sid' }); continue; }
    seenSids.add(user.sid);
    if (isAdmin(existingBySid.get(user.sid))) { skipped.push({ sid: user.sid, reason: 'admin_protected' }); continue; }

    let rfid = user.rfid_uid;
    const holder = rfid ? holderByRfid.get(rfid) : null;
    if (rfid && seenCards.has(rfid)) {
      skipped.push({ sid: user.sid, reason: 'duplicate_rfid' });
      rfid = null;
    } else if (holder && holder.sid !== user.sid && isAdmin(holder)) {
      skipped.push({ sid: user.sid, reason: 'rfid_owned_by_admin' });
      rfid = null;
    }
    if (rfid) seenCards.add(rfid);
    targets.push({ ...user, rfid_uid: rfid });
  }
  return { targets, skipped };
}

/**
 * Susun rencana import. Data HSE menang atas data lokal, kecuali akun ADMIN.
 * Urutan eksekusi: rfidReleases -> updates -> inserts (menghindari bentrok UNIQUE rfid_uid).
 * @param {ReadonlyArray<{sid:string,nama:string,role:string,rfid_uid:string|null}>} incoming
 * @param {ReadonlyArray<{sid:string,nama:string,role:string,rfid_uid:string|null}>} existing
 */
export function planHseImport(incoming, existing) {
  const existingBySid = new Map(existing.map(user => [user.sid, user]));
  const holderByRfid = new Map(existing.filter(user => user.rfid_uid).map(user => [String(user.rfid_uid), user]));
  const { targets, skipped } = resolveTargets(incoming, existingBySid, holderByRfid);

  const rfidReleases = [...new Set(targets
    .map(target => target.rfid_uid && holderByRfid.get(target.rfid_uid))
    .filter((holder, index) => holder && holder.sid !== targets[index].sid)
    .map(holder => holder.sid))];

  const known = targets.filter(target => existingBySid.has(target.sid));
  const updates = known.filter(target => isChanged(existingBySid.get(target.sid), target));
  return {
    inserts: targets.filter(target => !existingBySid.has(target.sid)),
    updates,
    unchanged: known.length - updates.length,
    rfidReleases,
    skipped,
  };
}
