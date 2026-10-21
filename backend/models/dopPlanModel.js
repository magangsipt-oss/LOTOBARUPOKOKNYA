import pool from '../config/database.js';
import { normalizeRole } from '../security/session.js';
import { buildSessionDraft, mergeSessionPeople, parseDOPPayload } from '../domain/dopPlan.js';

const DOPPlanModel = {
  getAll: async () => {
    const [rows] = await pool.query(
      `SELECT id, payload, status, id_box, session_id, created_at FROM dop_plans
       ORDER BY plan_date DESC, id DESC LIMIT 1000`
    );
    return rows;
  },

  create: async ({ planDate, shift, payload, createdBy }) => {
    const [result] = await pool.query(
      'INSERT INTO dop_plans (plan_date, shift, payload, created_by) VALUES (?, ?, ?, ?)',
      [planDate, shift, JSON.stringify(payload), createdBy]
    );
    return result.insertId;
  },

  // Pengawas melengkapi draft otomatis; daftar personel dari box tidak bisa diubah dari form.
  complete: async (id, payload) => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [rows] = await c.query('SELECT id, payload, status, id_box, session_id, created_at FROM dop_plans WHERE id = ? FOR UPDATE', [id]);
      if (!rows.length) { await c.commit(); return null; }
      const personel = parseDOPPayload(rows[0]).personel;
      const merged = personel ? { ...payload, personel } : payload;
      await c.query(
        `UPDATE dop_plans SET plan_date = ?, shift = ?, payload = ?, status = 'FINAL', updated_at = NOW() WHERE id = ?`,
        [payload.tanggalISO, payload.shift, JSON.stringify(merged), id]
      );
      await c.commit();
      return { ...rows[0], payload: merged, status: 'FINAL' };
    } catch (error) { await c.rollback(); throw error; }
    finally { c.release(); }
  },

  delete: async id => {
    const [result] = await pool.query('DELETE FROM dop_plans WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
};

// Dipanggil di dalam transaksi telemetri (baris box sudah terkunci) setiap antrean sesi berubah.
export async function syncSessionDraft(c, { idBox, session, unit }) {
  const [rows] = await c.query(
    `SELECT u.sid, u.nama, u.role FROM queue q
     JOIN users u ON u.rfid_uid = q.rfid_uid OR u.sid = q.rfid_uid
     WHERE q.id_box = ? AND q.session_id = ? ORDER BY q.id`,
    [idBox, session]
  );
  const seen = new Set();
  const people = rows
    .filter(row => !seen.has(row.sid) && seen.add(row.sid))
    .map(row => ({ sid: row.sid, nama: row.nama, role: normalizeRole(row.role) || String(row.role || '') }));
  if (!people.length) return;

  const [existing] = await c.query(
    'SELECT id, payload, status FROM dop_plans WHERE id_box = ? AND session_id = ? FOR UPDATE',
    [idBox, session]
  );
  if (!existing.length) {
    const draft = buildSessionDraft({ unit, people });
    await c.query(
      `INSERT INTO dop_plans (plan_date, shift, payload, created_by, status, id_box, session_id)
       VALUES (?, ?, ?, 'SYSTEM', 'DRAFT', ?, ?)`,
      [draft.tanggalISO, draft.shift, JSON.stringify(draft), idBox, session]
    );
    return;
  }
  const next = mergeSessionPeople(parseDOPPayload(existing[0]), people, existing[0].status === 'DRAFT');
  if (next) {
    await c.query('UPDATE dop_plans SET payload = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(next), existing[0].id]);
  }
}

export default DOPPlanModel;
