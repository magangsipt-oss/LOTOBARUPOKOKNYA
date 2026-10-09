import pool from '../config/database.js';

/**
 * Model untuk mengelola tabel maintenance_logs
 */
const MaintenanceModel = {
  // 1. Mengambil semua maintenance logs
  getAll: async () => {
    const query = `
      SELECT id, waktu, id_box, mesin, jenis, estimasi, teknisi, pengawas, deskripsi, status, foto 
      FROM maintenance_logs ORDER BY waktu DESC LIMIT 1000
    `;
    const [rows] = await pool.query(query);
    return rows;
  },

  // 2. Mengambil maintenance logs untuk box tertentu
  getByIdBox: async (idBox) => {
    const query = `
      SELECT id, waktu, id_box, mesin, jenis, estimasi, teknisi, pengawas, deskripsi, status, foto 
      FROM maintenance_logs WHERE id_box = ? ORDER BY waktu DESC LIMIT 1000
    `;
    const [rows] = await pool.query(query, [idBox]);
    return rows;
  },

  // 3. Mengambil satu maintenance log berdasarkan ID
  getById: async (id) => {
    const query = `
      SELECT id, waktu, id_box, mesin, jenis, estimasi, teknisi, pengawas, deskripsi, status, foto 
      FROM maintenance_logs WHERE id = ?
    `;
    const [rows] = await pool.query(query, [id]);
    return rows[0] || null;
  },

  // 4. Menambahkan maintenance log baru
  create: async (maintenanceData) => {
    const { idBox, mesin, jenis, estimasi, teknisi, pengawas, deskripsi, status, foto } = maintenanceData;
    const query = `
      INSERT INTO maintenance_logs (waktu, id_box, mesin, jenis, estimasi, teknisi, pengawas, deskripsi, status, foto)
      VALUES (NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await pool.query(query, [
      idBox,
      mesin || null,
      jenis,
      estimasi,
      teknisi,
      pengawas,
      deskripsi,
      status || 'pending',
      foto || null
    ]);
    return result.insertId;
  },

  // 5. Memperbarui maintenance log
  update: async (id, maintenanceData) => {
    const { mesin, jenis, estimasi, teknisi, pengawas, deskripsi, status, foto } = maintenanceData;
    const query = `
      UPDATE maintenance_logs 
      SET mesin = ?, jenis = ?, estimasi = ?, teknisi = ?, pengawas = ?, 
          deskripsi = ?, status = ?, foto = ?
      WHERE id = ?
    `;
    const [result] = await pool.query(query, [
      mesin || null,
      jenis,
      estimasi,
      teknisi,
      pengawas,
      deskripsi,
      status,
      foto || null,
      id
    ]);
    return result.affectedRows > 0;
  },

  // 6. Menghapus maintenance log
  delete: async (id) => {
    const query = 'DELETE FROM maintenance_logs WHERE id = ?';
    const [result] = await pool.query(query, [id]);
    return result.affectedRows > 0;
  }
};

export default MaintenanceModel;
