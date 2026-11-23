import pool from '../config/database.js';
import { loadSessionPeople } from './dopPlanModel.js';
import { loadSessionTaps } from './sessionTaps.js';
import {
  applyOwnSleep, briefingPermissions, buildBriefingDraft, canSeeBriefing, mergeBriefingPeople,
  parseBriefingPayload, resolveBriefingStatus, signBriefing
} from '../domain/briefing.js';
import { isLeader } from '../domain/personnel.js';

const forbidden = message => Object.assign(new Error(message), { status: 403 });
const conflict = message => Object.assign(new Error(message), { status: 409 });

const SELECT_BRIEFING = `SELECT a.id, a.id_box, a.session_id, a.status, a.payload, a.created_by, a.updated_by,
  a.created_at, a.updated_at, b.unit,
  (a.session_id IS NOT NULL AND b.active_session_id = a.session_id) AS session_active
  FROM briefing_attendance a LEFT JOIN boxes b ON b.id_box = a.id_box`;

async function findById(c, id) {
  const [rows] = await c.query(`${SELECT_BRIEFING} WHERE a.id = ?`, [id]);
  return rows[0] || null;
}

async function lockForChange(c, id, viewer) {
  const [locked] = await c.query('SELECT id, status, payload, id_box, session_id, created_by FROM briefing_attendance WHERE id = ? FOR UPDATE', [id]);
  if (!locked.length) return null;
  const stored = parseBriefingPayload(locked[0]);
  if (!canSeeBriefing(locked[0], stored, viewer)) return null;
  return { row: locked[0], stored };
}

async function save(c, id, payload, viewer) {
  const status = resolveBriefingStatus(payload);
  await c.query('UPDATE briefing_attendance SET briefing_date = ?, status = ?, payload = ?, updated_by = ?, updated_at = NOW() WHERE id = ?',
    [payload.tanggalISO, status, JSON.stringify(payload), viewer.sid, id]);
}

async function inTransaction(work) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const result = await work(c);
    await c.commit();
    return result;
  } catch (error) { await c.rollback(); throw error; }
  finally { c.release(); }
}

const BriefingModel = {
  getAll: async () => {
    const [rows] = await pool.query(`${SELECT_BRIEFING} ORDER BY a.briefing_date DESC, a.id DESC LIMIT 500`);
    return rows;
  },

  getById: async id => findById(pool, id),

  sessionTaps: async rows => loadSessionTaps(pool, rows),

  // Daftar hadir manual (sosialisasi tanpa box) dibuat oleh yang memimpin: foreman atau pengawas.
  create: async ({ payload, viewer }) => {
    if (!isLeader(viewer)) throw forbidden('Daftar hadir dibuat oleh foreman atau pengawas.');
    const status = resolveBriefingStatus(payload);
    const [result] = await pool.query(
      `INSERT INTO briefing_attendance (briefing_date, status, payload, created_by, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [payload.tanggalISO, status, JSON.stringify(payload), viewer.sid, viewer.sid]
    );
    return findById(pool, result.insertId);
  },

  // Foreman/pengawas mengubah semua isi; mekanik hanya jam tidurnya sendiri. Tanda tangan dipertahankan.
  update: async (id, payload, viewer) => inTransaction(async c => {
    const found = await lockForChange(c, id, viewer);
    if (!found) return null;
    const permissions = briefingPermissions(found.row, found.stored, viewer);
    let next;
    if (permissions.ubah) next = { ...payload, ...(found.stored.tandaTangan ? { tandaTangan: found.stored.tandaTangan } : {}) };
    else if (permissions.jamTidurSendiri) next = applyOwnSleep(found.stored, payload, viewer);
    else throw forbidden('Anda tidak bisa mengubah daftar hadir ini.');
    await save(c, id, next, viewer);
    return findById(c, id);
  }),

  sign: async (id, slot, viewer) => inTransaction(async c => {
    const found = await lockForChange(c, id, viewer);
    if (!found) return null;
    const permissions = briefingPermissions(found.row, found.stored, viewer);
    if (slot === 'yangMemimpin' && !permissions.ttdMemimpin && !found.stored.tandaTangan?.yangMemimpin) {
      throw forbidden('Tanda tangan "Yang memimpin" dilakukan foreman yang ikut sosialisasi atau pengawas.');
    }
    await save(c, id, signBriefing(found.stored, slot, viewer), viewer);
    return findById(c, id);
  }),

  delete: async (id, role) => inTransaction(async c => {
    const [rows] = await c.query('SELECT status FROM briefing_attendance WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) return false;
    if (role !== 'admin' && rows[0].status !== 'DRAFT') throw conflict('Hanya daftar hadir berstatus DRAFT yang bisa dihapus pengawas.');
    await c.query('DELETE FROM briefing_attendance WHERE id = ?', [id]);
    return true;
  })
};

// Dipanggil di dalam transaksi telemetri (baris box sudah terkunci) setiap antrean sesi berubah.
export async function syncSessionBriefing(c, { idBox, session }) {
  const people = await loadSessionPeople(c, idBox, session);
  if (!people.length) return;
  const [existing] = await c.query(
    'SELECT id, payload, status FROM briefing_attendance WHERE id_box = ? AND session_id = ? FOR UPDATE',
    [idBox, session]
  );
  if (!existing.length) {
    const draft = buildBriefingDraft({ people });
    // Sesi tanpa mekanik/foreman (mis. hanya pengawas atau petugas BBM) tidak membuat daftar hadir kosong.
    if (!draft.peserta.length) return;
    await c.query(
      `INSERT INTO briefing_attendance (id_box, session_id, briefing_date, status, payload, created_by)
       VALUES (?, ?, ?, ?, ?, 'SYSTEM')`,
      [idBox, session, draft.tanggalISO, resolveBriefingStatus(draft), JSON.stringify(draft)]
    );
    return;
  }
  const next = mergeBriefingPeople(parseBriefingPayload(existing[0]), people);
  if (next) {
    await c.query('UPDATE briefing_attendance SET status = ?, payload = ?, updated_at = NOW() WHERE id = ?',
      [resolveBriefingStatus(next), JSON.stringify(next), existing[0].id]);
  }
}

export default BriefingModel;
