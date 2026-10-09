import { randomUUID } from 'node:crypto';
import pool from '../config/database.js';
const CommandModel = {
  async setCommand(idBox, command, parameter = '') {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [boxes] = await connection.query('SELECT id_box FROM boxes WHERE id_box = ? FOR UPDATE', [idBox]);
      if (!boxes.length) { await connection.rollback(); return null; }
      const [pending] = await connection.query('SELECT id FROM device_commands WHERE id_box = ? AND acknowledged_at IS NULL AND created_at >= NOW() - INTERVAL 10 MINUTE', [idBox]);
      if (pending.length >= 20) throw Object.assign(new Error('Antrean perintah penuh'), { status: 409 });
      const id = randomUUID();
      await connection.query('INSERT INTO device_commands (id, id_box, command, parameter) VALUES (?, ?, ?, ?)', [id, idBox, command, parameter]);
      await connection.commit();
      return id;
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },
  async getPendingCommand(idBox) {
    const [rows] = await pool.query(`SELECT id, command AS pending_cmd, parameter AS cmd_param FROM device_commands
      WHERE id_box = ? AND acknowledged_at IS NULL AND created_at >= NOW() - INTERVAL 10 MINUTE ORDER BY created_at, id LIMIT 1`, [idBox]);
    return rows[0] || null;
  },
  async clearPendingCommand(idBox, commandId) {
    const [result] = await pool.query('UPDATE device_commands SET acknowledged_at = COALESCE(acknowledged_at, NOW()) WHERE id_box = ? AND id = ?', [idBox, commandId]);
    return result.affectedRows > 0;
  }
};
export default CommandModel;
