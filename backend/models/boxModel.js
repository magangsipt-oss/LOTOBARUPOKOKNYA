import pool from '../config/database.js';

/**
 * Model untuk mengelola tabel boxes di database MySQL
 * Database actual: id_box (PK, VARCHAR), unit, ip, state, lat, lng, supervisor_uid, etc.
 */
const BoxModel = {
  // 1. Mengambil semua data box
  getAll: async () => {
    const query = `
            SELECT id_box, unit, ip, rtsp_url, ssid, state, lat, lng, lcd0, lcd1, relay_open,
              supervisor_uid, active_fuelman, last_uid, last_event, uptime_ms,
              CASE WHEN is_online = 1 AND last_ping >= NOW() - INTERVAL 15 SECOND THEN 1 ELSE 0 END AS is_online,
              last_ping, updated_at
      FROM boxes ORDER BY id_box ASC
    `;
    const [rows] = await pool.query(query);
    return rows;
  },

  // 2. Mengambil data box berdasarkan ID Box
  getByIdBox: async (idBox) => {
    const query = 'SELECT * FROM boxes WHERE id_box = ?';
    const [rows] = await pool.query(query, [idBox]);
    return rows[0] || null;
  },

  // 3. Menambahkan box baru
  create: async (boxData) => {
    const { idBox, unit, ip, state, lat, lng, supervisorUid, rtsp_url } = boxData;
    const query = `
      INSERT INTO boxes (id_box, unit, ip, rtsp_url, state, lat, lng, supervisor_uid,
                        last_event, last_uid, relay_open, uptime_ms, is_online, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IDLE', '', 0, 0, 1, NOW())
    `;
    await pool.query(query, [idBox, unit, ip, rtsp_url || null, state || 'IDLE', lat, lng, supervisorUid]);
    return idBox;
  },

  // 4. Memperbarui informasi box
  update: async (idBox, boxData) => {
    const { unit, ip, lat, lng, supervisorUid, rtsp_url } = boxData;
    const query = `
      UPDATE boxes
      SET unit = ?, ip = ?, lat = ?, lng = ?, supervisor_uid = ?, rtsp_url = ?, updated_at = NOW()
      WHERE id_box = ?
    `;
    const [result] = await pool.query(query, [unit, ip, lat, lng, supervisorUid, rtsp_url || null, idBox]);
    return result.affectedRows > 0;
  },

  // 5. Menghapus box
  delete: async (idBox) => {
    const query = 'DELETE FROM boxes WHERE id_box = ?';
    const [result] = await pool.query(query, [idBox]);
    return result.affectedRows > 0;
  },

  // 6. Memperbarui state box
  updateState: async (idBox, state) => {
    const query = `
      UPDATE boxes 
      SET state = ?, updated_at = NOW() 
      WHERE id_box = ?
    `;
    const [result] = await pool.query(query, [state, idBox]);
    return result.affectedRows > 0;
  },

  // 7. Memperbarui telemetri/status hardware
  updateTelemetry: async (idBox, telemetryData) => {
    const { state, lastEvent, lastUid, lat, lng, lcdZero, lcdOne, relayOpen, uptimeMs, hwData, isOnline, ssid, ip } = telemetryData;
    const query = `
      UPDATE boxes
      SET state = ?, last_event = ?, last_uid = ?, lat = ?, lng = ?,
          lcd0 = ?, lcd1 = ?, relay_open = ?, uptime_ms = ?, hw_data = ?,
          is_online = ?, ssid = ?, ip = IF(? != '0.0.0.0' AND ? IS NOT NULL, ?, ip),
          last_ping = NOW(), updated_at = NOW()
      WHERE id_box = ?
    `;
    const [result] = await pool.query(query, [
      state, lastEvent, lastUid, lat, lng, lcdZero, lcdOne, relayOpen, uptimeMs, hwData, isOnline, ssid, ip, ip, ip, idBox
    ]);
    return result.affectedRows > 0;
  }
};

export default BoxModel;