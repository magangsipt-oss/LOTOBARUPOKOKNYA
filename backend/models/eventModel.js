import pool from '../config/database.js';

/**
 * Model untuk mengelola RFID Buffer dan Event Logs
 */
const EventModel = {
  // ===== RFID BUFFER =====

  // 1. Ambil semua RFID buffer (kartu yang belum terdaftar)
  getAllRfidBuffer: async () => {
    const query = `
      SELECT id, id_box, rfid_uid, created_at 
      FROM rfid_buffer ORDER BY created_at DESC LIMIT 1000
    `;
    const [rows] = await pool.query(query);
    return rows;
  },

  // 2. Ambil RFID buffer untuk box tertentu
  getBufferByBox: async (idBox) => {
    const query = `
      SELECT id, id_box, rfid_uid, created_at 
      FROM rfid_buffer WHERE id_box = ? ORDER BY created_at DESC LIMIT 1000
    `;
    const [rows] = await pool.query(query, [idBox]);
    return rows;
  },

  // 3. Tambah kartu ke RFID buffer (kartu tidak terdaftar ditemukan)
  addToBuffer: async (idBox, rfidUid) => {
    const query = `
      INSERT INTO rfid_buffer (id_box, rfid_uid, created_at) 
      VALUES (?, ?, NOW())
      ON DUPLICATE KEY UPDATE id_box = ?, created_at = NOW()
    `;
    const [result] = await pool.query(query, [idBox, rfidUid, idBox]);
    return result.insertId || true;
  },

  // 4. Hapus dari RFID buffer (setelah diverifikasi/didaftar)
  removeFromBuffer: async (id) => {
    const query = 'DELETE FROM rfid_buffer WHERE id = ?';
    const [result] = await pool.query(query, [id]);
    return result.affectedRows > 0;
  },

  // 5. Clear semua buffer untuk box
  clearBufferByBox: async (idBox) => {
    const query = 'DELETE FROM rfid_buffer WHERE id_box = ?';
    const [result] = await pool.query(query, [idBox]);
    return result.affectedRows;
  },

  // ===== AUDIT LOGS (EVENT HISTORY) =====

  // 6. Ambil semua audit logs
  getAllAuditLogs: async (limit = 1000) => {
    const query = `
      SELECT a.id, a.id_box, a.event, a.rfid_uid, a.lat, a.lng, a.tanggal,
             u.nama AS user_name, u.role AS user_role
      FROM audit_logs a
      LEFT JOIN users u ON (u.rfid_uid = a.rfid_uid OR u.sid = a.rfid_uid)
      ORDER BY a.tanggal DESC LIMIT ?
    `;
    const [rows] = await pool.query(query, [limit]);
    return rows;
  },

  // 7. Ambil audit logs untuk box tertentu
  getAuditLogsByBox: async (idBox, limit = 500) => {
    const query = `
      SELECT a.id, a.id_box, a.event, a.rfid_uid, a.lat, a.lng, a.tanggal,
             u.nama AS user_name, u.role AS user_role
      FROM audit_logs a
      LEFT JOIN users u ON (u.rfid_uid = a.rfid_uid OR u.sid = a.rfid_uid)
      WHERE a.id_box = ?
      ORDER BY a.tanggal DESC LIMIT ?
    `;
    const [rows] = await pool.query(query, [idBox, limit]);
    return rows;
  },

  // 8. Catat event ke audit log
  createAuditLog: async (idBox, event, rfidUid, lat, lng) => {
    const query = `
      INSERT INTO audit_logs (id_box, event, rfid_uid, lat, lng, tanggal)
      VALUES (?, ?, ?, ?, ?, NOW())
    `;
    const [result] = await pool.query(query, [idBox, event, rfidUid, lat ?? 0, lng ?? 0]);
    return result.insertId;
  },

  // 9. Hapus audit log
  deleteAuditLog: async (id) => {
    const query = 'DELETE FROM audit_logs WHERE id = ?';
    const [result] = await pool.query(query, [id]);
    return result.affectedRows > 0;
  },

  // 10. Clear semua audit logs lebih lama dari N hari
  deleteOldAuditLogs: async (days = 30) => {
    const query = `
      DELETE FROM audit_logs
      WHERE tanggal < DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const [result] = await pool.query(query, [days]);
    return result.affectedRows;
  },

  // 11. Clear semua audit logs
  clearAllAuditLogs: async () => {
    await pool.query('DELETE FROM audit_logs');
  }
};

export default EventModel;
