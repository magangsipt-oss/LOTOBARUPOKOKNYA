import EventModel from '../models/eventModel.js';

/**
 * Controller untuk mengelola RFID Buffer & Audit Logs
 */
const eventController = {
  // ===== RFID BUFFER =====

  // 1. Ambil semua RFID buffer
  getAllRfidBuffer: async (req, res) => {
    try {
      const buffer = await EventModel.getAllRfidBuffer();
      return res.status(200).json({
        success: true,
        message: 'Data RFID buffer berhasil diambil',
        data: buffer
      });
    } catch (error) {
      console.error('Error getAllRfidBuffer:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil RFID buffer',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 2. Ambil RFID buffer untuk box tertentu
  getBufferByBox: async (req, res) => {
    try {
      const { idBox } = req.params;

      if (!idBox) {
        return res.status(400).json({
          success: false,
          message: 'Parameter idBox wajib disertakan!'
        });
      }

      const buffer = await EventModel.getBufferByBox(idBox);
      return res.status(200).json({
        success: true,
        message: `RFID buffer untuk box ${idBox} berhasil diambil`,
        data: buffer
      });
    } catch (error) {
      console.error('Error getBufferByBox:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil RFID buffer',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 3. Tambah kartu ke RFID buffer
  addToBuffer: async (req, res) => {
    try {
      const { idBox, rfidUid } = req.body;

      if (!idBox || !rfidUid) {
        return res.status(400).json({
          success: false,
          message: 'idBox dan rfidUid wajib disertakan!'
        });
      }

      const bufferId = await EventModel.addToBuffer(idBox, rfidUid);

      return res.status(201).json({
        success: true,
        message: 'Kartu berhasil ditambahkan ke RFID buffer',
        data: { id: bufferId, idBox, rfidUid }
      });
    } catch (error) {
      console.error('Error addToBuffer:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menambahkan ke RFID buffer',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 4. Hapus dari RFID buffer
  removeFromBuffer: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Parameter id wajib disertakan!'
        });
      }

      const isRemoved = await EventModel.removeFromBuffer(id);

      if (!isRemoved) {
        return res.status(404).json({
          success: false,
          message: `RFID buffer dengan id ${id} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Kartu berhasil dihapus dari RFID buffer'
      });
    } catch (error) {
      console.error('Error removeFromBuffer:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menghapus dari RFID buffer',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 5. Clear semua buffer untuk box
  clearBufferByBox: async (req, res) => {
    try {
      const { idBox } = req.params;

      if (!idBox) {
        return res.status(400).json({
          success: false,
          message: 'Parameter idBox wajib disertakan!'
        });
      }

      const deletedCount = await EventModel.clearBufferByBox(idBox);

      return res.status(200).json({
        success: true,
        message: `${deletedCount} kartu(s) berhasil dihapus dari RFID buffer`,
        data: { idBox, deletedCount }
      });
    } catch (error) {
      console.error('Error clearBufferByBox:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal membersihkan RFID buffer',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // ===== AUDIT LOGS =====

  // 6. Ambil semua audit logs
  getAllAuditLogs: async (req, res) => {
    try {
      const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 1000));
      const logs = await EventModel.getAllAuditLogs(limit);
      return res.status(200).json({
        success: true,
        message: 'Data audit logs berhasil diambil',
        data: logs
      });
    } catch (error) {
      console.error('Error getAllAuditLogs:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil audit logs',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 7. Ambil audit logs untuk box tertentu
  getAuditLogsByBox: async (req, res) => {
    try {
      const { idBox } = req.params;
      const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 500));

      if (!idBox) {
        return res.status(400).json({
          success: false,
          message: 'Parameter idBox wajib disertakan!'
        });
      }

      const logs = await EventModel.getAuditLogsByBox(idBox, limit);
      return res.status(200).json({
        success: true,
        message: `Audit logs untuk box ${idBox} berhasil diambil`,
        data: logs
      });
    } catch (error) {
      console.error('Error getAuditLogsByBox:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil audit logs',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 8. Catat event baru
  createAuditLog: async (req, res) => {
    try {
      const { idBox, event, rfidUid, lat, lng } = req.body;

      if (!idBox || !event) {
        return res.status(400).json({
          success: false,
          message: 'idBox dan event wajib disertakan!'
        });
      }

      const logId = await EventModel.createAuditLog(idBox, event, rfidUid || '', lat, lng);

      return res.status(201).json({
        success: true,
        message: 'Event berhasil dicatat',
        data: { id: logId, idBox, event, rfidUid, lat, lng }
      });
    } catch (error) {
      console.error('Error createAuditLog:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mencatat event',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 9. Hapus audit log
  deleteAuditLog: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Parameter id wajib disertakan!'
        });
      }

      const isDeleted = await EventModel.deleteAuditLog(id);

      if (!isDeleted) {
        return res.status(404).json({
          success: false,
          message: `Audit log dengan id ${id} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Audit log berhasil dihapus'
      });
    } catch (error) {
      console.error('Error deleteAuditLog:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menghapus audit log',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 10. Clear old audit logs
  deleteOldAuditLogs: async (req, res) => {
    try {
      const days = parseInt(req.query.days) || 30;
      const deletedCount = await EventModel.deleteOldAuditLogs(days);

      return res.status(200).json({
        success: true,
        message: `${deletedCount} audit log(s) lebih lama dari ${days} hari berhasil dihapus`,
        data: { deletedCount, days }
      });
    } catch (error) {
      console.error('Error deleteOldAuditLogs:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menghapus old audit logs',
        error: 'REQUEST_FAILED'
      });
    }
  }
};

export default eventController;
