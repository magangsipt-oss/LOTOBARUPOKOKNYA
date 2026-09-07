import pool from '../config/database.js';

/**
 * Model untuk mengelola tapping_history, people_counting, dan rfid_buffer.
 *
 * Catatan: audit_logs ditangani oleh EventModel — tidak perlu duplikasi di sini.
 */
const LogModel = {
  // Legacy alias — arahkan ke EventModel
  getAll: async () => {
    const { default: EventModel } = await import('./eventModel.js');
    return EventModel.getAllAuditLogs();
  },

  delete: async (id) => {
    const { default: EventModel } = await import('./eventModel.js');
    return EventModel.deleteAuditLog(id);
  },

  clearAll: async () => {
    const { default: EventModel } = await import('./eventModel.js');
    return EventModel.clearAllAuditLogs();
  },

  // ===== TAPPING HISTORY =====

  // 5. Mengambil semua tapping history
  getAllTappingHistory: async () => {
    const query = `
            SELECT t.id, t.id_box, t.session_id, t.rfid_uid, t.nama, t.event_type, t.event_text,
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
            SELECT t.id, t.id_box, t.session_id, t.rfid_uid, t.nama, t.event_type, t.event_text,
              t.lat, t.lng, t.created_at, COALESCE(b.is_online, 0) AS is_online
            FROM tapping_history t LEFT JOIN boxes b ON b.id_box = t.id_box
            WHERE t.id_box = ? ORDER BY t.created_at DESC LIMIT 500
    `;
    const [rows] = await pool.query(query, [idBox]);
    return rows;
  },

  // 6b. Mengambil statistik tapping per session
  getTappingStats: async (idBox = null) => {
    let query = `
      SELECT t.id_box, t.session_id,
        COUNT(*) AS total_taps,
        COUNT(DISTINCT t.rfid_uid) AS unique_users,
        SUM(t.event_type = 'IN') AS total_in,
        SUM(t.event_type = 'OUT') AS total_out,
        MIN(t.created_at) AS session_start,
        MAX(t.created_at) AS session_end
      FROM tapping_history t
      WHERE t.session_id IS NOT NULL
    `;
    const params = [];
    if (idBox) {
      query += ' AND t.id_box = ?';
      params.push(idBox);
    }
    query += ' GROUP BY t.id_box, t.session_id ORDER BY t.id_box, session_start DESC';
    const [rows] = await pool.query(query, params);
    return rows;
  },

  // 7. Menambahkan tapping history baru
  createTappingHistory: async (tapData) => {
    const { idBox, rfidUid, nama, eventType, eventText, lat, lng, sessionId } = tapData;
    const query = `
      INSERT INTO tapping_history (id_box, session_id, rfid_uid, nama, event_type, event_text, lat, lng, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const [result] = await pool.query(query, [idBox, sessionId || null, rfidUid, nama || null, eventType, eventText || null, lat || null, lng || null]);
    return result.insertId;
  },

  // 7b. Auto-generate next session_id for a box
  getNextSessionId: async (idBox) => {
    const [rows] = await pool.query(
      'SELECT COALESCE(MAX(session_id), 0) + 1 AS next_id FROM tapping_history WHERE id_box = ?',
      [idBox]
    );
    return rows[0]?.next_id || 1;
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
  },

  // ===== PEOPLE COUNTING =====

  upsertPeopleCount: async (data) => {
    const { idBox, sessionId, detectedCount, registeredCount, timestamp } = data;
    const query = `
      INSERT INTO people_counting (id_box, session_id, detected_count, registered_count, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        detected_count = VALUES(detected_count),
        registered_count = VALUES(registered_count),
        created_at = VALUES(created_at)
    `;
    await pool.query(query, [idBox, sessionId || null, detectedCount, registeredCount || 0, timestamp || new Date()]);
  },

  getLatestPeopleCount: async (idBox) => {
    const [rows] = await pool.query(
      'SELECT * FROM people_counting WHERE id_box = ? ORDER BY created_at DESC LIMIT 1',
      [idBox]
    );
    return rows[0] || null;
  },

  getPeopleCountHistory: async (idBox, limit = 100) => {
    const [rows] = await pool.query(
      'SELECT * FROM people_counting WHERE id_box = ? ORDER BY created_at DESC LIMIT ?',
      [idBox, limit]
    );
    return rows;
  },

  // ===== RFID BUFFER =====
  getAllBuffer: async () => {
    const [rows] = await pool.query(
      'SELECT * FROM rfid_buffer ORDER BY created_at DESC LIMIT 200'
    );
    return rows;
  },

  deleteBuffer: async (id) => {
    const [result] = await pool.query('DELETE FROM rfid_buffer WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
};

export default LogModel;