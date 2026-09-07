import pool from '../config/database.js';

/**
 * Model untuk mengelola command queue dan device commands
 */
const CommandModel = {
  // 1. Set/Queue command untuk box
  setCommand: async (idBox, command, parameter) => {
    const query = `
      UPDATE boxes 
      SET pending_cmd = ?, cmd_param = ?, updated_at = NOW()
      WHERE id_box = ?
    `;
    const [result] = await pool.query(query, [command, parameter || '', idBox]);
    return result.affectedRows > 0;
  },

  // 2. Ambil pending command untuk box (used by device sync)
  getPendingCommand: async (idBox) => {
    const query = `
      SELECT pending_cmd, cmd_param FROM boxes WHERE id_box = ? LIMIT 1
    `;
    const [rows] = await pool.query(query, [idBox]);
    return rows[0] || { pending_cmd: '', cmd_param: '' };
  },

  // 3. Clear/consume command setelah device mengambilnya
  clearPendingCommand: async (idBox) => {
    const query = `
      UPDATE boxes 
      SET pending_cmd = '', cmd_param = '', updated_at = NOW()
      WHERE id_box = ?
    `;
    const [result] = await pool.query(query, [idBox]);
    return result.affectedRows > 0;
  }
};

export default CommandModel;
