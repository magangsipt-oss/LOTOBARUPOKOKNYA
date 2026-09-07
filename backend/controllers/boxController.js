import BoxModel from '../models/boxModel.js';
import { validateTelemetry } from '../domain/telemetry.js';
import { recordTelemetry } from '../models/telemetryModel.js';

/**
 * Controller untuk mengelola alur data dan permintaan Box E-LOTO
 */
const boxController = {
  // 1. Mengambil semua data box
  getAllBoxes: async (req, res) => {
    try {
      const boxes = await BoxModel.getAll();
      return res.status(200).json({
        success: true,
        message: 'Data seluruh box berhasil diambil',
        data: boxes
      });
    } catch (error) {
      console.error('Error getAllBoxes:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil data box dari server',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 2. Mengambil satu data box berdasarkan ID Box
  getBoxById: async (req, res) => {
    try {
      const { idBox } = req.params;
      const box = await BoxModel.getByIdBox(idBox);

      if (!box) {
        return res.status(404).json({
          success: false,
          message: `Box dengan ID ${idBox} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Detail data box berhasil diambil',
        data: Object.fromEntries(Object.entries(box).filter(([key]) => key !== 'device_token'))
      });
    } catch (error) {
      console.error('Error getBoxById:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil detail box',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 3. Menambahkan unit box baru
  createBox: async (req, res) => {
    try {
      const { unit, ip, state, lat, lng, supervisorUid, rtsp_url } = req.body;
      const idBox = req.body.idBox ?? req.body.id_box;

      // Validasi: idBox dan unit wajib diisi
      if (!idBox || !unit) {
        return res.status(400).json({
          success: false,
          message: 'ID Box (idBox) dan unit wajib diisi!'
        });
      }

      const newIdBox = await BoxModel.create({
        idBox,
        unit,
        ip: ip || '0.0.0.0',
        state: 'STATE_IDLE',
        lat: lat || 0,
        lng: lng || 0,
        supervisorUid: supervisorUid || '',
        rtsp_url: rtsp_url || null
      });

      return res.status(201).json({
        success: true,
        message: 'Box baru berhasil didaftarkan ke sistem',
        data: { idBox: newIdBox, unit, state: 'STATE_IDLE' }
      });
    } catch (error) {
      console.error('Error createBox:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menambahkan box baru',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 4. Memperbarui informasi box
  updateBox: async (req, res) => {
    try {
      const { idBox } = req.params;
      const { unit, ip, lat, lng, supervisorUid, rtsp_url } = req.body;

      if (!unit) {
        return res.status(400).json({
          success: false,
          message: 'Unit wajib diisi!'
        });
      }

      const isUpdated = await BoxModel.update(idBox, {
        unit,
        ip,
        lat,
        lng,
        supervisorUid,
        rtsp_url: rtsp_url || null
      });

      if (!isUpdated) {
        return res.status(404).json({
          success: false,
          message: `Gagal memperbarui, box dengan ID ${idBox} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Informasi box berhasil diperbarui'
      });
    } catch (error) {
      console.error('Error updateBox:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal memperbarui data box',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 5. Menghapus data box
  deleteBox: async (req, res) => {
    try {
      const { idBox } = req.params;
      const isDeleted = await BoxModel.delete(idBox);

      if (!isDeleted) {
        return res.status(404).json({
          success: false,
          message: `Gagal menghapus, box dengan ID ${idBox} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Data box berhasil dihapus dari sistem'
      });
    } catch (error) {
      console.error('Error deleteBox:', error.message);
      return res.status(error.status || 500).json({
        success: false,
        message: error.status === 409 ? error.message : 'Gagal menghapus box',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 6. Mengubah state box (IDLE / LOCKED / etc)
  updateBoxState: async (req, res) => {
    try {
      const { idBox } = req.params;
      const { state } = req.body;

      if (!state) {
        return res.status(400).json({
          success: false,
          message: 'State baru wajib dicantumkan!'
        });
      }

      const isUpdated = await BoxModel.updateState(idBox, state);

      if (!isUpdated) {
        return res.status(404).json({
          success: false,
          message: `Box dengan ID ${idBox} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: `Status box ${idBox} berhasil diubah menjadi ${state}`,
        data: { idBox, state }
      });
    } catch (error) {
      console.error('Error updateBoxState:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengubah status box',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 7. Memperbarui telemetri/hardware status dari ESP32
  updateTelemetry: async (req, res, next) => {
    try {
      const body = validateTelemetry(req.body);
      const result = await recordTelemetry(req.params.idBox, body);
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }
};
export default boxController;
