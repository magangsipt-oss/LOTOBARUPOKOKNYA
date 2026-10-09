import pool from '../config/database.js';

/**
 * Model untuk mengelola tabel refueling_logs dan supervisor_box_team
 */
const RefuelingModel = {
  // ===== REFUELING LOGS =====

  // 1. Mengambil semua refueling logs
  getAll: async () => {
    const query = `
      SELECT id, id_box, fuelman_uid, fuelman_name, start_time, end_time, 
             duration_seconds, latitude, longitude, is_loto_active 
      FROM refueling_logs ORDER BY start_time DESC LIMIT 1000
    `;
    const [rows] = await pool.query(query);
    return rows;
  },

  // 2. Mengambil refueling logs untuk box tertentu
  getByIdBox: async (idBox) => {
    const query = `
      SELECT id, id_box, fuelman_uid, fuelman_name, start_time, end_time, 
             duration_seconds, latitude, longitude, is_loto_active 
      FROM refueling_logs WHERE id_box = ? ORDER BY start_time DESC LIMIT 1000
    `;
    const [rows] = await pool.query(query, [idBox]);
    return rows;
  },

  // 3. Memulai refueling (create record)
  startRefueling: async (refuelingData) => {
    const { idBox, fuelmanUid, fuelmanName, latitude, longitude, isLotoActive } = refuelingData;
    const query = `
      INSERT INTO refueling_logs (id_box, fuelman_uid, fuelman_name, start_time, 
                                 latitude, longitude, is_loto_active)
      VALUES (?, ?, ?, NOW(), ?, ?, ?)
    `;
    const [result] = await pool.query(query, [
      idBox,
      fuelmanUid,
      fuelmanName || null,
      latitude || null,
      longitude || null,
      isLotoActive ? 1 : 0
    ]);
    return result.insertId;
  },

  // 4. Mengakhiri refueling (update end_time dan duration)
  endRefueling: async (id) => {
    const query = `
      UPDATE refueling_logs 
      SET end_time = NOW(), 
          duration_seconds = TIMESTAMPDIFF(SECOND, start_time, NOW())
      WHERE id = ? AND end_time IS NULL
    `;
    const [result] = await pool.query(query, [id]);
    return result.affectedRows > 0;
  },

  // 5. Menghapus refueling log
  delete: async (id) => {
    const query = 'DELETE FROM refueling_logs WHERE id = ?';
    const [result] = await pool.query(query, [id]);
    return result.affectedRows > 0;
  }
};

export default RefuelingModel;
