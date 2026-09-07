import pool from '../config/database.js';

/**
 * Model untuk mengelola tabel audit_logs dan tapping_history
 */
const LogModel = {
  // ===== AUDIT LOGS =====

  getAll: async () => LogModel.getAllAuditLogs(),

  delete: async (id) => {
    const [result] = await pool.query('DELETE FROM audit_logs WHERE id = ?', [id]);
    return result.affectedRows > 0;
  },

  clearAll: async () => {
    await pool.query('DELETE FROM audit_logs');
  },

  // 1. Mengambil semua audit logs
  getAllAuditLogs: async () => {
    const query = `
            SELECT a.id, a.id_box, a.event, a.rfid_uid, a.lat, a.lng, a.tanggal,
              COALESCE(b.is_online, 0) AS is_online
            FROM audit_logs a LEFT JOIN boxes b ON b.id_box = a.id_box
            ORDER BY a.tanggal DESC LIMIT 1000
    `;
    const [rows] = await pool.query(query);
    return rows;
  },

  // 2. Mengambil audit logs untuk box tertentu
  getAuditLogsByBox: async (idBox) => {
    const query = `
            SELECT a.id, a.id_box, a.event, a.rfid_uid, a.lat, a.lng, a.tanggal,
              COALESCE(b.is_online, 0) AS is_online
            FROM audit_logs a LEFT JOIN boxes b ON b.id_box = a.id_box
            WHERE a.id_box = ? ORDER BY a.tanggal DESC LIMIT 500
    `;
    const [rows] = await pool.query(query, [idBox]);
    return rows;
  },

  // 3. Menambahkan audit log baru (dari hardware)
  createAuditLog: async (logData) => {
    const { idBox, event, rfidUid, lat, lng } = logData;
    const query = `
      INSERT INTO audit_logs (id_box, event, rfid_uid, lat, lng, tanggal)
      VALUES (?, ?, ?, ?, ?, NOW())
    `;
    const [result] = await pool.query(query, [idBox, event, rfidUid || '—', lat, lng]);
    return result.insertId;
  },

  // 4. Menghapus audit logs lama (cleanup)
  deleteOldAuditLogs: async (days = 30) => {
    const query = `
      DELETE FROM audit_logs 
      WHERE tanggal < DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    const [result] = await pool.query(query, [days]);
    return result.affectedRows;
  },

  // ===== TAPPING HISTORY =====

  // 5. Mengambil semua tapping history
  getAllTappingHistory: async () => {
    const query = `
            SELECT t.id, t.id_box, t.rfid_uid, t.nama, t.event_type, t.event_text,
              t.lat, t.lng, t.created_at, COALESCE(b.is_online, 0) AS is_online
            FROM tapping_history t LEFT JOIN boxes b ON b.id_box = t.id_box
            ORDER BY t.created_at DESC LIMIT 1000
    `;
    const [rows] = await pool.query(query);
    return rows;
  },

  // 6. Mengambil tapping history untuk box tertentu
  getTappingHistoryByBox: async (idBox) => {
    const query = `
            SELECT t.id, t.id_box, t.rfid_uid, t.nama, t.event_type, t.event_text,
              t.lat, t.lng, t.created_at, COALESCE(b.is_online, 0) AS is_online
            FROM tapping_history t LEFT JOIN boxes b ON b.id_box = t.id_box
            WHERE t.id_box = ? ORDER BY t.created_at DESC LIMIT 500
    `;
    const [rows] = await pool.query(query, [idBox]);
    return rows;
  },

  // 7. Menambahkan tapping history baru
  createTappingHistory: async (tapData) => {
    const { idBox, rfidUid, nama, eventType, eventText, lat, lng } = tapData;
    const query = `
      INSERT INTO tapping_history (id_box, rfid_uid, nama, event_type, event_text, lat, lng, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const [result] = await pool.query(query, [idBox, rfidUid, nama || null, eventType, eventText || null, lat || null, lng || null]);
    return result.insertId;
  },

  // 8. Menghapus tapping history
  deleteTappingHistoryById: async (id) => {
    const [result] = await pool.query('DELETE FROM tapping_history WHERE id = ?', [id]);
    return result.affectedRows;
  },

  deleteTappingHistoryByIds: async (ids) => {
    const validIds = ids.map(Number).filter(Number.isInteger);
    if (validIds.length === 0) return 0;
    const placeholders = validIds.map(() => '?').join(',');
    const [result] = await pool.query(`DELETE FROM tapping_history WHERE id IN (${placeholders})`, validIds);
    return result.affectedRows;
  },

  deleteTappingHistory: async (idBox) => {
    const query = 'DELETE FROM tapping_history WHERE id_box = ?';
    const [result] = await pool.query(query, [idBox]);
    return result.affectedRows;
  }
};

export default LogModel;