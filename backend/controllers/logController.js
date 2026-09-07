import LogModel from '../models/logModel.js';

/**
 * Controller untuk mengelola Log Aktivitas & Riwayat Tap RFID E-LOTO
 */
const logController = {
  // 1. Mengambil semua riwayat log aktivitas
  getAllLogs: async (req, res) => {
    try {
      const logs = await LogModel.getAll();
      return res.status(200).json({
        success: true,
        message: 'Data seluruh log aktivitas berhasil diambil',
        data: logs
      });
    } catch (error) {
      console.error('Error getAllLogs:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil data log aktivitas',
        error: error.message
      });
    }
  },

  // 2. Mencatat aktivitas log baru
  createLog: async (req, res) => {
    try {
      const { box_id, user_id, action, status_before, status_after, notes } = req.body;

      if (!box_id || !user_id || !action) {
        return res.status(400).json({
          success: false,
          message: 'box_id, user_id, dan action wajib disertakan!'
        });
      }

      const newId = await LogModel.create({
        box_id,
        user_id,
        action,
        status_before,
        status_after,
        notes
      });

      return res.status(201).json({
        success: true,
        message: 'Aktivitas log berhasil dicatat',
        data: { id: newId, box_id, user_id, action, status_before, status_after, notes }
      });
    } catch (error) {
      console.error('Error createLog:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mencatat log aktivitas',
        error: error.message
      });
    }
  },

  // 3. Menghapus satu baris log berdasarkan ID
  deleteLog: async (req, res) => {
    try {
      const { id } = req.params;
      const isDeleted = await LogModel.delete(id);

      if (!isDeleted) {
        return res.status(404).json({
          success: false,
          message: `Log dengan ID ${id} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Log aktivitas berhasil dihapus'
      });
    } catch (error) {
      console.error('Error deleteLog:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menghapus log aktivitas',
        error: error.message
      });
    }
  },

  // 4. Menghapus seluruh riwayat log aktivitas (Clear Logs)
  clearAllLogs: async (req, res) => {
    try {
      await LogModel.clearAll();
      return res.status(200).json({
        success: true,
        message: 'Seluruh riwayat log aktivitas berhasil dibersihkan'
      });
    } catch (error) {
      console.error('Error clearAllLogs:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal membersihkan log aktivitas',
        error: error.message
      });
    }
  },

  // 5. Mengambil riwayat tap kartu RFID
  getTappingHistory: async (req, res) => {
    try {
      const history = await LogModel.getAllTappingHistory();
      return res.status(200).json({
        success: true,
        message: 'Riwayat tap kartu RFID berhasil diambil',
        data: history
      });
    } catch (error) {
      console.error('Error getTappingHistory:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil riwayat tap kartu',
        error: error.message
      });
    }
  },

  // 6. Mencatat tap kartu RFID baru (dari perangkat IoT)
  createTapping: async (req, res) => {
    try {
      const body = req.body || {};
      const cardNumber = body.card_number || body.rfid_uid || body.rfidUid;
      const boxId = body.box_id || body.id_box || body.idBox || null;
      const eventType = String(body.event_type || body.eventType || (String(body.status || '').toUpperCase() === 'OUT' ? 'OUT' : 'IN')).toUpperCase();
      const eventTypeValid = ['IN', 'OUT', 'CHECK'].includes(eventType) ? eventType : 'CHECK';

      if (!cardNumber || !boxId) {
        return res.status(400).json({
          success: false,
          message: 'Nomor kartu RFID dan ID boks wajib disertakan!'
        });
      }

      const newId = await LogModel.createTappingHistory({
        idBox: boxId,
        rfidUid: cardNumber,
        nama: body.nama || body.name,
        eventType: eventTypeValid,
        eventText: body.event_text || body.eventText || body.status || null,
        lat: body.lat ?? body.latitude,
        lng: body.lng ?? body.longitude
      });

      return res.status(201).json({
        success: true,
        message: 'Riwayat tap kartu berhasil dicatat',
        data: { id: newId, rfid_uid: cardNumber, id_box: boxId, event_type: eventTypeValid }
      });
    } catch (error) {
      console.error('Error createTapping:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mencatat tap kartu',
        error: error.message
      });
    }
  },

  deleteTappingById: async (req, res) => {
    try {
      const requestedIds = Array.isArray(req.body?.event_ids) ? req.body.event_ids : [req.params.id];
      const deleted = await LogModel.deleteTappingHistoryByIds(requestedIds);
      if (!deleted) return res.status(404).json({ success: false, message: 'Riwayat tapping tidak ditemukan' });
      return res.status(200).json({ success: true, message: 'Riwayat tapping berhasil dihapus' });
    } catch (error) {
      console.error('Error deleteTappingById:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal menghapus riwayat tapping', error: error.message });
    }
  },

  // 7. Menghapus seluruh riwayat tap kartu RFID
  clearTappingHistory: async (req, res) => {
    try {
      await LogModel.clearTappingHistory();
      return res.status(200).json({
        success: true,
        message: 'Seluruh riwayat tap kartu berhasil dibersihkan'
      });
    } catch (error) {
      console.error('Error clearTappingHistory:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal membersihkan riwayat tap kartu',
        error: error.message
      });
    }
  }
};

export default logController;