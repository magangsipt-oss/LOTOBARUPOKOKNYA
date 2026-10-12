import pool from '../config/database.js';

const DOPPlanModel = {
  getAll: async () => {
    const [rows] = await pool.query(
      'SELECT id, payload, created_at FROM dop_plans ORDER BY plan_date DESC, id DESC LIMIT 1000'
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

  delete: async id => {
    const [result] = await pool.query('DELETE FROM dop_plans WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
};

export default DOPPlanModel;
