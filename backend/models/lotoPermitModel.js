import pool from '../config/database.js';
import { loadSessionPeople } from './dopPlanModel.js';
import {
  buildPermitDraft, mergePermitPeople, parsePermitPayload, resolvePermitStatus, stampClosing
} from '../domain/lotoPermit.js';

const conflict = message => Object.assign(new Error(message), { status: 409 });

// session_active: sesi box milik izin ini masih terbuka (personel mungkin masih di dalam).
const SELECT_PERMIT = `SELECT p.id, p.id_box, p.session_id, p.status, p.payload, p.created_by, p.updated_by,
  p.created_at, p.updated_at, b.unit,
  (p.session_id IS NOT NULL AND b.active_session_id = p.session_id) AS session_active
  FROM loto_permits p LEFT JOIN boxes b ON b.id_box = p.id_box`;

async function findById(c, id) {
  const [rows] = await c.query(`${SELECT_PERMIT} WHERE p.id = ?`, [id]);
  return rows[0] || null;
}

const LotoPermitModel = {
  getAll: async () => {
    const [rows] = await pool.query(`${SELECT_PERMIT} ORDER BY p.permit_date DESC, p.id DESC LIMIT 500`);
    return rows;
  },

  getById: async id => findById(pool, id),

  // Izin manual (tanpa box), misalnya pekerjaan yang tidak memakai box E-LOTO.
  create: async ({ payload, createdBy }) => {
    const stamped = stampClosing(payload);
    const status = resolvePermitStatus(stamped);
    const [result] = await pool.query(
      `INSERT INTO loto_permits (permit_date, status, payload, created_by, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [stamped.tanggalISO, status, JSON.stringify(stamped), createdBy, createdBy]
    );
    return findById(pool, result.insertId);
  },

  // Personel dari box dan kolom shift otomatis dipertahankan; izin yang sudah ditutup tidak bisa diubah.
  update: async (id, payload, updatedBy) => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      // Hanya baris izin yang dikunci; status sesi box dibaca tanpa kunci agar urutan kunci
      // tidak berlawanan dengan transaksi telemetri (box dulu, lalu izin).
      const [locked] = await c.query('SELECT id, status, payload, id_box, session_id FROM loto_permits WHERE id = ? FOR UPDATE', [id]);
      if (!locked.length) { await c.commit(); return null; }
      const current = locked[0];
      if (current.status === 'DITUTUP') throw conflict('Izin LOTO sudah ditutup dan tidak bisa diubah.');
      let sessionActive = false;
      if (current.id_box && current.session_id != null) {
        const [boxes] = await c.query('SELECT active_session_id FROM boxes WHERE id_box = ?', [current.id_box]);
        sessionActive = boxes.length > 0 && Number(boxes[0].active_session_id) === Number(current.session_id);
      }
      const stored = parsePermitPayload(current);
      const merged = stampClosing({
        ...payload,
        ...(stored.personel ? { personel: stored.personel } : {}),
        ...(stored.shiftOtomatis ? { shiftOtomatis: stored.shiftOtomatis } : {})
      });
      const status = resolvePermitStatus(merged, { sessionActive });
      await c.query(
        'UPDATE loto_permits SET permit_date = ?, status = ?, payload = ?, updated_by = ?, updated_at = NOW() WHERE id = ?',
        [merged.tanggalISO, status, JSON.stringify(merged), updatedBy, id]
      );
      const row = await findById(c, id);
      await c.commit();
      return row;
    } catch (error) { await c.rollback(); throw error; }
    finally { c.release(); }
  },

  // Pengawas hanya boleh menghapus DRAFT; izin AKTIF/DITUTUP adalah catatan keselamatan (admin saja).
  delete: async (id, role) => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [rows] = await c.query('SELECT status FROM loto_permits WHERE id = ? FOR UPDATE', [id]);
      if (!rows.length) { await c.commit(); return false; }
      if (role !== 'admin' && rows[0].status !== 'DRAFT') throw conflict('Hanya izin berstatus DRAFT yang bisa dihapus pengawas.');
      await c.query('DELETE FROM loto_permits WHERE id = ?', [id]);
      await c.commit();
      return true;
    } catch (error) { await c.rollback(); throw error; }
    finally { c.release(); }
  }
};

// Dipanggil di dalam transaksi telemetri (baris box sudah terkunci) setiap antrean sesi berubah.
export async function syncSessionPermit(c, { idBox, session, unit }) {
  const people = await loadSessionPeople(c, idBox, session);
  if (!people.length) return;
  const [existing] = await c.query(
    'SELECT id, payload, status FROM loto_permits WHERE id_box = ? AND session_id = ? FOR UPDATE',
    [idBox, session]
  );
  if (!existing.length) {
    const draft = buildPermitDraft({ unit, people });
    await c.query(
      `INSERT INTO loto_permits (id_box, session_id, permit_date, status, payload, created_by)
       VALUES (?, ?, ?, 'DRAFT', ?, 'SYSTEM')`,
      [idBox, session, draft.tanggalISO, JSON.stringify(draft)]
    );
    return;
  }
  const next = mergePermitPeople(parsePermitPayload(existing[0]), people, existing[0].status === 'DRAFT');
  if (next) {
    await c.query('UPDATE loto_permits SET payload = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(next), existing[0].id]);
  }
}

export default LotoPermitModel;
