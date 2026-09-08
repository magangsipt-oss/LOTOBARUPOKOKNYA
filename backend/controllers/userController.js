import crypto from 'node:crypto';
import { createSession, destroySession, normalizeRole } from '../security/session.js';
import pool from '../config/database.js';
import bcrypt from 'bcryptjs';
import UserModel from '../models/userModel.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const userProfilesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads', 'user_profiles');

const normalizePhotoUid = (uid) => String(uid || '').replace(/[\s:-]/g, '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');

const saveJpegPhoto = async (input, uid) => {
  const filename = `${normalizePhotoUid(uid)}-${crypto.randomUUID()}.jpg`;
  const filePath = path.join(userProfilesDir, filename);
  await fs.mkdir(userProfilesDir, { recursive: true });
  await sharp(input, { limitInputPixels: 16000000 }).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(filePath);
  return `uploads/user_profiles/${filename}`;
};

const persistProfilePhoto = async (photo, sid) => {
  if (!photo) return undefined;
  if (!String(photo).startsWith('data:image/')) {
    if (photo === 'assets/default-avatar.png' || /^uploads\/user_profiles\/[A-Za-z0-9_-]+\.jpg$/.test(photo)) return photo;
    throw Object.assign(new Error('Foto harus diunggah sebagai gambar.'), { status: 400 });
  }

  const match = String(photo).match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if (!match) throw new Error('Format foto hasil crop tidak valid');

  return saveJpegPhoto(Buffer.from(match[2], 'base64'), sid);
};

const userController = {
  login: async (req, res) => {
    try {
      const { sid, password } = req.body || {};
      if (typeof sid !== 'string' || !sid.trim() || sid.length > 50 || typeof password !== 'string' || Buffer.byteLength(password) > 72) {
        return res.status(400).json({ success: false, message: 'SID dan kata sandi wajib diisi' });
      }

      const user = await UserModel.authenticate(String(sid).trim(), password);
      if (!user) {
        return res.status(401).json({ success: false, message: 'ID Karyawan (SID) atau Kata Sandi Salah!' });
      }

      if (!normalizeRole(user.role)) return res.status(403).json({ success: false, message: 'Peran akun tidak valid.' });
      const csrf = await createSession(req, res, user);
      return res.status(200).json({ success: true, message: 'Login berhasil', data: user, csrfToken: csrf });
    } catch (error) {
      console.error('Error login:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal memproses login', error: 'REQUEST_FAILED' });
    }
  },

  me: (req, res) => {
    if (req.auth.type !== 'user') return res.status(403).json({ success: false });
    return res.json({ success: true, data: req.auth.user, csrfToken: req.auth.csrf });
  },
  logout: async (req, res, next) => {
    try { await destroySession(req, res); res.json({ success: true }); } catch (error) { next(error); }
  },
  changePassword: async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length === 0 || Buffer.byteLength(newPassword) > 72) {
        return res.status(400).json({ success: false, message: 'Kata sandi baru wajib diisi dan maksimal 72 byte.' });
      }
      const user = await UserModel.authenticate(req.auth.user.sid, currentPassword);
      if (!user) return res.status(401).json({ success: false, message: 'Kata sandi lama salah.' });
      await UserModel.changePassword(user.sid, await bcrypt.hash(newPassword, 12));
      await destroySession(req, res);
      res.json({ success: true, message: 'Kata sandi diubah. Silakan login kembali.' });
    } catch (error) { next(error); }
  },

  // 1. Mengambil semua data pengguna
  getAllUsers: async (req, res) => {
    try {
      const users = await UserModel.getAll();
      return res.status(200).json({
        success: true,
        message: 'Data seluruh pengguna berhasil diambil',
        data: req.auth?.type === 'device' ? users.map(({ sid, nama, role, rfid_uid, fp_id }) => ({ sid, nama, role, rfid_uid, fp_id })) : users,
      });
    } catch (error) {
      console.error('Error getAllUsers:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil data pengguna',
        error: 'REQUEST_FAILED',
      });
    }
  },

  // 2. Mengambil satu data pengguna berdasarkan SID
  getUserBySid: async (req, res) => {
    try {
      const { sid } = req.params;
      const user = await UserModel.getBySid(sid);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: `Pengguna dengan SID ${sid} tidak ditemukan`,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Detail pengguna berhasil diambil',
        data: user,
      });
    } catch (error) {
      console.error('Error getUserBySid:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil detail pengguna',
        error: 'REQUEST_FAILED',
      });
    }
  },

  // 3. Memeriksa validitas kartu RFID (rfid_uid)
  checkCard: async (req, res) => {
    try {
      const { rfid_uid } = req.body;

      if (!rfid_uid) {
        return res.status(400).json({
          success: false,
          message: 'Nomor kartu RFID (rfid_uid) wajib disertakan!',
        });
      }

      const user = await UserModel.getByRfidUid(rfid_uid);

      if (!user) {
        return res.status(404).json({
          success: false,
          is_valid: false,
          message: 'Kartu tidak terdaftar dalam sistem E-LOTO',
        });
      }

      return res.status(200).json({
        success: true,
        is_valid: true,
        message: 'Kartu RFID terverifikasi',
        data: user,
      });
    } catch (error) {
      console.error('Error checkCard:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal memverifikasi kartu RFID',
        error: 'REQUEST_FAILED',
      });
    }
  },

  getPhoto: async (req, res) => {
    try {
      const uid = String(req.params.uid || '').trim();
      if (!uid) return res.status(400).send('UID wajib diisi');

      const normalizedUid = uid.replace(/[\s:-]/g, '').toUpperCase();
      const user = await UserModel.getByRfidUid(uid) ||
        await UserModel.getByRfidUid(normalizedUid) ||
        await UserModel.getBySid(uid);
      if (!user || !user.foto) return res.status(404).send('Foto tidak ditemukan');

      const photo = String(user.foto).trim();
      const dataUri = photo.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/s);
      if (dataUri) {
        const result = await saveJpegPhoto(Buffer.from(dataUri[2], 'base64'), user.rfid_uid || user.sid || uid);
        await pool.query('UPDATE users SET foto = ? WHERE sid = ?', [result, user.sid]);
        user.foto = result;
      }

      const filename = path.basename(String(user.foto).split('?')[0]);
      const filePath = path.join(userProfilesDir, filename);
      try { await fs.access(filePath); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const legacyRoot = path.join(userProfilesDir, '..', '..', 'legacy-uploads', 'user_profiles');
        const legacyPath = path.join(legacyRoot, filename);
        await fs.access(legacyPath);
        // Decode and re-encode legacy images; no arbitrary file content is served.
        const image = await sharp(legacyPath, { limitInputPixels: 16000000 }).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer();
        return res.type('jpeg').send(image);
      }
      res.setHeader('Content-Type', 'image/jpeg');
      return res.sendFile(filename, { root: userProfilesDir });
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).send('Foto tidak ditemukan');
      console.error('Error getPhoto:', error.message);
      return res.status(500).send('Gagal mengambil foto');
    }
  },

  // 4. Mengambil daftar supervisor
  getSupervisors: async (req, res) => {
    try {
      const supervisors = await UserModel.getByRole('PENGAWAS');
      const unique = supervisors.filter((item, index, arr) =>
        arr.findIndex((entry) => String(entry.sid) === String(item.sid)) === index
      );

      return res.status(200).json({
        success: true,
        message: 'Daftar supervisor berhasil diambil',
        data: unique,
      });
    } catch (error) {
      console.error('Error getSupervisors:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil data supervisor',
        error: 'REQUEST_FAILED',
      });
    }
  },

  // 5. Menambahkan pengguna baru
  createUser: async (req, res) => {
    try {
      const body = req.body || {};
      const sid = body.sid || body.username || body.name || `USER-${Date.now()}`;
      const nama = body.nama || body.name || body.username || 'New User';
      const rfidUid = body.rfid_uid ?? body.rfidUid ?? body.card_number ?? body.cardNumber ?? null;
      const role = body.role || 'WORKER';
      if (typeof sid !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(sid) || typeof nama !== 'string' || !nama.trim() || nama.length > 100 || typeof rfidUid !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(rfidUid) || !normalizeRole(role)) {
        return res.status(400).json({
          success: false,
          message: 'SID, nama, RFID dan peran harus valid.',
        });
      }


      const existingCard = await UserModel.getByRfidUid(rfidUid);
      if (existingCard) {
        return res.status(400).json({
          success: false,
          message: `Nomor kartu RFID ${rfidUid} sudah terdaftar atas nama ${existingCard.nama || existingCard.name}`,
        });
      }

      const profile_photo = req.file ? await saveJpegPhoto(req.file.buffer, rfidUid) : await persistProfilePhoto(body.foto || body.profile_photo, rfidUid || sid);

      const newId = await UserModel.create({
        sid,
        nama,
        role,
        rfidUid,
        foto: profile_photo,
      });

      return res.status(201).json({
        success: true,
        message: 'Pengguna baru berhasil didaftarkan',
        data: { id: newId, sid: newId, name: nama, nama, card_number: rfidUid, rfid_uid: rfidUid, role, profile_photo },
      });
    } catch (error) {
      console.error('Error createUser:', error.message);
      return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : error.status || 500).json({
        success: false,
        message: 'Gagal menambahkan pengguna baru',
        error: 'REQUEST_FAILED',
      });
    }
  },

  // 6. Memperbarui data pengguna
  updateUser: async (req, res) => {
    try {
      const { sid } = req.params;
      const body = req.body || {};
      const existing = await UserModel.getBySid(sid);
      if (!existing) return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan.' });
      const nama = body.nama ?? body.name ?? existing.nama;
      const rfidUid = body.rfid_uid ?? body.rfidUid ?? existing.rfid_uid;
      const role = body.role ?? existing.role;
      if (typeof nama !== 'string' || !nama.trim() || nama.length > 100 || !normalizeRole(role) || (rfidUid !== null && (typeof rfidUid !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(rfidUid)))) {
        return res.status(400).json({ success: false, message: 'Data pengguna tidak valid.' });
      }
      if (normalizeRole(existing.role) === 'admin' && normalizeRole(role) !== 'admin') {
        return res.status(409).json({ success: false, message: 'Perubahan peran administrator harus dilakukan melalui prosedur administrasi terpisah.' });
      }
      const profile_photo = req.file ? await saveJpegPhoto(req.file.buffer, rfidUid || sid) : await persistProfilePhoto(body.foto || body.profile_photo, rfidUid || sid);
      const isUpdated = await UserModel.update(sid, {
        nama,
        role,
        rfidUid,
        fpId: existing.fp_id,
        foto: profile_photo,
      });

      if (!isUpdated) {
        return res.status(404).json({
          success: false,
          message: `Gagal memperbarui, pengguna dengan SID ${sid} tidak ditemukan`,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Data pengguna berhasil diperbarui',
        data: { sid, profile_photo },
      });
    } catch (error) {
      console.error('Error updateUser:', error.message);
      return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : error.status || 500).json({
        success: false,
        message: 'Gagal memperbarui data pengguna',
        error: 'REQUEST_FAILED',
      });
    }
  },

  // 7. Menghapus data pengguna
  deleteUser: async (req, res) => {
    try {
      const { sid } = req.params;
      const isDeleted = await UserModel.delete(sid);

      if (!isDeleted) {
        return res.status(404).json({
          success: false,
          message: `Gagal menghapus, pengguna dengan SID ${sid} tidak ditemukan`,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Data pengguna berhasil dihapus dari sistem',
      });
    } catch (error) {
      console.error('Error deleteUser:', error.message);
      return res.status(error.status || 500).json({
        success: false,
        message: error.status === 409 ? error.message : 'Gagal menghapus pengguna',
        error: 'REQUEST_FAILED',
      });
    }
  },
};

export default userController;
