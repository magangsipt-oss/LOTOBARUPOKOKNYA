import pool from '../config/database.js';
import { normalizeRole } from '../security/session.js';

/**
 * Model untuk mengelola tabel supervisor_box_team
 */
const SupervisorModel = {
  replaceTeam: async (supervisorSid, idBox, mechanicSids, maintenanceType) => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [boxes] = await c.query('SELECT id_box FROM boxes WHERE id_box = ? FOR UPDATE', [idBox]);
      if (!boxes.length) throw Object.assign(new Error('Boks tidak ditemukan'), { status: 404 });
      const [supervisors] = await c.query('SELECT role FROM users WHERE sid = ?', [supervisorSid]);
      if (normalizeRole(supervisors[0]?.role) !== 'pengawas') throw Object.assign(new Error('Pengawas tidak valid'), { status: 400 });
      for (const sid of mechanicSids) {
        const [users] = await c.query('SELECT role FROM users WHERE sid = ?', [sid]);
        if (normalizeRole(users[0]?.role) !== 'teknisi') throw Object.assign(new Error('Mekanik tidak valid'), { status: 400 });
      }
      await c.query('DELETE FROM supervisor_box_team WHERE supervisor_sid = ? AND id_box = ?', [supervisorSid, idBox]);
      for (const sid of mechanicSids) await c.query('INSERT INTO supervisor_box_team (supervisor_sid, id_box, mechanic_sid, maintenance_type, created_at) VALUES (?, ?, ?, ?, NOW())', [supervisorSid, idBox, sid, maintenanceType]);
      await c.commit();
      return mechanicSids.length;
    } catch (error) { await c.rollback(); throw error; }
    finally { c.release(); }
  },

  // 1. Mengambil seluruh supervisor team untuk box tertentu
  getTeamByBox: async (idBox) => {
    const query = `
      SELECT sbt.id, sbt.supervisor_sid, sbt.id_box, sbt.mechanic_sid, sbt.maintenance_type, sbt.created_at
      FROM supervisor_box_team sbt
      WHERE sbt.id_box = ?
      ORDER BY sbt.created_at ASC
    `;
    const [rows] = await pool.query(query, [idBox]);
    return rows;
  },

  // 2. Mengambil semua team untuk supervisor tertentu
  getTeamBySupervisor: async (supervisorSid) => {
    const query = `
      SELECT sbt.id, sbt.supervisor_sid, sbt.id_box, sbt.mechanic_sid, sbt.maintenance_type, sbt.created_at
      FROM supervisor_box_team sbt
      WHERE sbt.supervisor_sid = ?
      ORDER BY sbt.created_at ASC
    `;
    const [rows] = await pool.query(query, [supervisorSid]);
    return rows;
  },

  // 3. Menambahkan mechanic ke supervisor team
  addMechanicToTeam: async (supervisorSid, idBox, mechanicSid) => {
    const query = `
      INSERT INTO supervisor_box_team (supervisor_sid, id_box, mechanic_sid, created_at)
      VALUES (?, ?, ?, NOW())
    `;
    const [result] = await pool.query(query, [supervisorSid, idBox, mechanicSid]);
    return result.insertId;
  },

  // 4. Menghapus mechanic dari supervisor team
  removeMechanicFromTeam: async (id) => {
    const query = 'DELETE FROM supervisor_box_team WHERE id = ?';
    const [result] = await pool.query(query, [id]);
    return result.affectedRows > 0;
  },

  // 5. Menghapus seluruh team untuk box tertentu
  deleteTeamByBox: async (idBox) => {
    const query = 'DELETE FROM supervisor_box_team WHERE id_box = ?';
    const [result] = await pool.query(query, [idBox]);
    return result.affectedRows;
  },

  // 6. Menghapus team untuk supervisor+box tertentu (bulk save support)
  deleteTeamBySupervisorAndBox: async (supervisorSid, idBox) => {
    const query = 'DELETE FROM supervisor_box_team WHERE supervisor_sid = ? AND id_box = ?';
    const [result] = await pool.query(query, [supervisorSid, idBox]);
    return result.affectedRows;
  }
};

export default SupervisorModel;
