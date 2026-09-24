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

    const storedPassword = user.password || '';
    if (storedPassword.startsWith('$2')) {
      const match = await bcrypt.compare(String(password), storedPassword);
      if (!match) return null;
    } else if (storedPassword && String(password) === storedPassword) {
      const migratedHash = await bcrypt.hash(String(password), SALT_ROUNDS);
      await pool.query('UPDATE users SET password = ? WHERE sid = ?', [migratedHash, sid]);
    } else {
      return null;
    }

    const { password: _, ...safeUser } = user;
    return safeUser;
  },

  // 3. Mengambil pengguna berdasarkan nomor kartu RFID (rfid_uid)
  getByRfidUid: async (rfidUid) => {
    const query = 'SELECT sid, nama, role, rfid_uid, fp_id, foto, created_at FROM users WHERE rfid_uid = ?';
    const [rows] = await pool.query(query, [rfidUid]);
    return rows[0] || null;
  },

  // 3b. Flexible match: cari rfid_uid yang mengandung cleanUid (handles leading zeros / format beda)
  getByRfidUidLike: async (rfidUid) => {
    const clean = String(rfidUid || '').replace(/[\s.\-:]/g, '').toUpperCase();
    if (!clean) return null;
    const query = `SELECT sid, nama, role, rfid_uid, fp_id, foto, created_at
      FROM users WHERE REPLACE(REPLACE(REPLACE(REPLACE(UPPER(rfid_uid), ' ', ''), '.', ''), '-', ''), ':', '') = ?`;
    const [rows] = await pool.query(query, [clean]);
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
    const finalPassword = String(finalSid);
    if (!finalPassword || Buffer.byteLength(finalPassword) > 72) throw new Error('Invalid SID');
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
        SET nama = ?, role = ?, rfid_uid = ?, fp_id = COALESCE(?, fp_id), foto = ?
        WHERE sid = ?
      `;
      const [result] = await pool.query(query, [finalNama, finalRole, finalRfid, fpId || null, finalFoto, sid]);
      return result.affectedRows > 0;
    }

    const query = `
      UPDATE users 
      SET nama = ?, role = ?, rfid_uid = ?, fp_id = COALESCE(?, fp_id)
      WHERE sid = ?
    `;
    const [result] = await pool.query(query, [finalNama, finalRole, finalRfid, fpId || null, sid]);
    return result.affectedRows > 0;
  },

  changePassword: async (sid, hash) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('UPDATE users SET password = ? WHERE sid = ?', [hash, sid]);
      await connection.query('DELETE FROM web_sessions WHERE sid = ?', [sid]);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  },

  // 7. Menghapus data pengguna
  delete: async (sid) => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [admins] = await c.query("SELECT sid FROM users WHERE UPPER(role) = 'ADMIN' FOR UPDATE");
      const [users] = await c.query('SELECT sid, rfid_uid, role FROM users WHERE sid = ? FOR UPDATE', [sid]);
      if (!users.length) { await c.rollback(); return false; }
      if (String(users[0].role).toUpperCase() === 'ADMIN' && admins.length <= 1) throw Object.assign(new Error('Administrator terakhir tidak boleh dihapus'), { status: 409 });
      const uid = users[0].rfid_uid;
      const [active] = await c.query('SELECT id FROM queue WHERE rfid_uid = ? LIMIT 1', [uid]);
      const [supervisor] = await c.query('SELECT id_box FROM boxes WHERE active_session_id IS NOT NULL AND supervisor_uid = ? LIMIT 1', [uid]);
      if (active.length || supervisor.length) throw Object.assign(new Error('Personel masih tercatat dalam sesi aktif'), { status: 409 });
      await c.query('DELETE FROM web_sessions WHERE sid = ?', [sid]);
      await c.query('DELETE FROM supervisor_box_team WHERE supervisor_sid = ? OR mechanic_sid = ?', [sid, sid]);
      await c.query('DELETE FROM users WHERE sid = ?', [sid]);
      await c.commit();
      return true;
    } catch (error) { await c.rollback(); throw error; }
    finally { c.release(); }
  }
};
export default UserModel;
