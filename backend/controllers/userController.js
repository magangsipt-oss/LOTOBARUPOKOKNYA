import UserModel from '../models/userModel.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const userProfilesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads', 'user_profiles');

const normalizePhotoUid = (uid) => String(uid || '').replace(/[\s:-]/g, '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');

const saveJpegPhoto = async (input, uid) => {
  const filename = `${normalizePhotoUid(uid)}.jpg`;
  const filePath = path.join(userProfilesDir, filename);
  await fs.mkdir(userProfilesDir, { recursive: true });
  await sharp(input).jpeg({ quality: 82 }).toFile(filePath);
  return `uploads/user_profiles/${filename}`;
};

const persistProfilePhoto = async (photo, sid) => {
  if (!photo || !String(photo).startsWith('data:image/')) return photo;

  const match = String(photo).match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if (!match) throw new Error('Format foto hasil crop tidak valid');

  return saveJpegPhoto(Buffer.from(match[2], 'base64'), sid);
};

const userController = {
  login: async (req, res) => {
    try {
      const { sid, password } = req.body || {};
      if (!sid || !password) {
        return res.status(400).json({ success: false, message: 'SID dan kata sandi wajib diisi' });
      }

      const user = await UserModel.authenticate(String(sid).trim(), password);
      if (!user) {
        return res.status(401).json({ success: false, message: 'ID Karyawan (SID) atau Kata Sandi Salah!' });
      }

      return res.status(200).json({ success: true, message: 'Login berhasil', data: user });
    } catch (error) {
      console.error('Error login:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal memproses login', error: error.message });
    }
  },

  // 1. Mengambil semua data pengguna
  getAllUsers: async (req, res) => {
    try {
      const users = await UserModel.getAll();
      return res.status(200).json({
        success: true,
        message: 'Data seluruh pengguna berhasil diambil',
        data: users,
      });
    } catch (error) {
      console.error('Error getAllUsers:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil data pengguna',
        error: error.message,
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
        error: error.message,
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
        error: error.message,
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
        await saveJpegPhoto(Buffer.from(dataUri[2], 'base64'), user.rfid_uid || user.sid || uid);
      }

      const filename = dataUri ? `${normalizePhotoUid(user.rfid_uid || user.sid || uid)}.jpg` : path.basename(photo.split('?')[0]);
      const filePath = path.join(userProfilesDir, filename);
      await fs.access(filePath);
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
        error: error.message,
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
      const password = body.password || sid;

      if (!nama || !rfidUid) {
        return res.status(400).json({
          success: false,
          message: 'Nama lengkap dan nomor kartu RFID wajib diisi!',
        });
      }

      const profile_photo = req.file ? await saveJpegPhoto(req.file.path, rfidUid) : await persistProfilePhoto(body.foto || body.profile_photo, rfidUid || sid);
      if (req.file) await fs.unlink(req.file.path).catch(() => {});

      const existingCard = await UserModel.getByRfidUid(rfidUid);
      if (existingCard) {
        return res.status(400).json({
          success: false,
          message: `Nomor kartu RFID ${rfidUid} sudah terdaftar atas nama ${existingCard.nama || existingCard.name}`,
        });
      }

      const newId = await UserModel.create({
        sid,
        nama,
        role,
        rfidUid,
        password,
        foto: profile_photo,
      });

      return res.status(201).json({
        success: true,
        message: 'Pengguna baru berhasil didaftarkan',
        data: { id: newId, sid: newId, name: nama, nama, card_number: rfidUid, rfid_uid: rfidUid, role, profile_photo },
      });
    } catch (error) {
      console.error('Error createUser:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menambahkan pengguna baru',
        error: error.message,
      });
    }
  },

  // 6. Memperbarui data pengguna
  updateUser: async (req, res) => {
    try {
      const { sid } = req.params;
      const body = req.body || {};
      const nama = body.nama || body.name || body.username || 'Updated User';
      const rfidUid = body.rfid_uid ?? body.rfidUid ?? body.card_number ?? body.cardNumber ?? null;
      const role = body.role || 'WORKER';

      if (!nama || !rfidUid) {
        return res.status(400).json({
          success: false,
          message: 'Nama lengkap dan nomor kartu RFID wajib diisi!',
        });
      }

      const profile_photo = req.file ? await saveJpegPhoto(req.file.path, rfidUid) : await persistProfilePhoto(body.foto || body.profile_photo, rfidUid || sid);
      if (req.file) await fs.unlink(req.file.path).catch(() => {});

      const isUpdated = await UserModel.update(sid, {
        nama,
        role,
        rfidUid,
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
      return res.status(500).json({
        success: false,
        message: 'Gagal memperbarui data pengguna',
        error: error.message,
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
      return res.status(500).json({
        success: false,
        message: 'Gagal menghapus pengguna',
        error: error.message,
      });
    }
  },
};

export default userController;