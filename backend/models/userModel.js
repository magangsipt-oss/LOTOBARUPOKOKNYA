import pool from '../config/database.js';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/**
 * Model untuk mengelola tabel users di database MySQL
 * Database actual: sid (PK), nama, role, rfid_uid (UNIQUE), fp_id, password, foto, created_at
 */
const UserModel = {
  // 1. Mengambil seluruh data pengguna
  getAll: async () => {
    const query = 'SELECT sid, nama, role, rfid_uid, fp_id, foto, created_at FROM users ORDER BY sid DESC';
    const [rows] = await pool.query(query);
    return rows;
  },

  // 2. Mengambil satu pengguna berdasarkan SID
  getBySid: async (sid) => {
    const query = 'SELECT sid, nama, role, rfid_uid, fp_id, foto, created_at FROM users WHERE sid = ?';
    const [rows] = await pool.query(query, [sid]);
    return rows[0] || null;
  },

  authenticate: async (sid, password) => {
    // 1. Cari user berdasarkan sid
    const [rows] = await pool.query(
      'SELECT sid, nama, role, rfid_uid, fp_id, password, foto, created_at FROM users WHERE sid = ?',
      [sid]
    );
    const user = rows[0];
    if (!user) return null;

    // 2. Coba bcrypt compare dulu
    const storedPassword = user.password || '';
    if (storedPassword.startsWith('$2')) {
      // Password di-hash dengan bcrypt
      const match = await bcrypt.compare(String(password), storedPassword);
      if (!match) return null;
    } else {
      // Legacy: password plaintext — cocokkan langsung
      if (storedPassword !== String(password)) return null;
    }

    // 3. Return tanpa field password
    const { password: _, ...safeUser } = user;
    return safeUser;
  },

  // 3. Mengambil pengguna berdasarkan nomor kartu RFID (rfid_uid)
  getByRfidUid: async (rfidUid) => {
    const query = 'SELECT sid, nama, role, rfid_uid, fp_id, foto, created_at FROM users WHERE rfid_uid = ?';
    const [rows] = await pool.query(query, [rfidUid]);
    return rows[0] || null;
  },

  // 4. Mengambil daftar pengguna berdasarkan peran/role
  getByRole: async (role) => {
    const normalized = String(role || '').trim();
    if (!normalized) {
      return [];
    }

    const roleUpper = normalized.toUpperCase();
    const query = `
      SELECT sid, nama, role, rfid_uid, fp_id, foto, created_at
      FROM users
      WHERE UPPER(role) = ?
         OR UPPER(role) LIKE ?
         OR UPPER(role) LIKE ?
         OR UPPER(role) LIKE ?
      ORDER BY nama ASC
    `;
    const [rows] = await pool.query(query, [
      roleUpper,
      `%${roleUpper}%`,
      `%SUPERVISOR%`,
      `%PENGAWAS%`,
    ]);
    return rows;
  },

  // 5. Menambahkan pengguna baru
  create: async (userData) => {
    const {
      sid,
      nama,
      name,
      role,
      rfidUid,
      rfid_uid,
      fpId,
      password,
      foto,
      profile_photo,
    } = userData;

    const finalSid = sid || name || `USER-${Date.now()}`;
    const finalNama = nama || name || 'New User';
    const finalRole = role || 'WORKER';
    const finalRfid = rfidUid || rfid_uid || null;
    const finalPassword = password || finalSid;
    const hashedPassword = await bcrypt.hash(String(finalPassword), SALT_ROUNDS);
    const finalFoto = foto || profile_photo || null;

    const query = `
      INSERT INTO users (sid, nama, role, rfid_uid, fp_id, password, foto, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await pool.query(query, [
      finalSid,
      finalNama,
      finalRole,
      finalRfid,
      fpId || null,
      hashedPassword,
      finalFoto
    ]);
    return finalSid;
  },

  // 6. Memperbarui data pengguna
  update: async (sid, userData) => {
    const {
      nama,
      name,
      role,
      rfidUid,
      rfid_uid,
      fpId,
      foto,
      profile_photo,
    } = userData;

    const finalNama = nama || name;
    const finalRole = role;
    const finalRfid = rfidUid || rfid_uid || null;
    const finalFoto = foto || profile_photo;

    if (finalFoto) {
      const query = `
        UPDATE users 
        SET nama = ?, role = ?, rfid_uid = ?, fp_id = ?, foto = ?
        WHERE sid = ?
      `;
      const [result] = await pool.query(query, [finalNama, finalRole, finalRfid, fpId || null, finalFoto, sid]);
      return result.affectedRows > 0;
    }

    const query = `
      UPDATE users 
      SET nama = ?, role = ?, rfid_uid = ?, fp_id = ?
      WHERE sid = ?
    `;
    const [result] = await pool.query(query, [finalNama, finalRole, finalRfid, fpId || null, sid]);
    return result.affectedRows > 0;
  },

  // 7. Menghapus data pengguna
  delete: async (sid) => {
    const query = 'DELETE FROM users WHERE sid = ?';
    const [result] = await pool.query(query, [sid]);
    return result.affectedRows > 0;
  }
};

export default UserModel;