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
        error: 'REQUEST_FAILED'
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
        error: 'REQUEST_FAILED'
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
        error: 'REQUEST_FAILED'
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
        error: 'REQUEST_FAILED'
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
        error: 'REQUEST_FAILED'
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
      const sessionId = body.session_id || body.sessionId || null;

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
        lng: body.lng ?? body.longitude,
        sessionId: sessionId
      });

      return res.status(201).json({
        success: true,
        message: 'Riwayat tap kartu berhasil dicatat',
        data: { id: newId, rfid_uid: cardNumber, id_box: boxId, event_type: eventTypeValid, session_id: sessionId }
      });
    } catch (error) {
      console.error('Error createTapping:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mencatat tap kartu',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 6b. Mengambil statistik tapping per session
  getTappingStats: async (req, res) => {
    try {
      const idBox = req.query.id_box || req.query.idBox;
      const stats = await LogModel.getTappingStats(idBox || null, req.auth?.type === 'device');
      return res.status(200).json({
        success: true,
        message: 'Statistik tapping berhasil diambil',
        data: stats
      });
    } catch (error) {
      console.error('Error getTappingStats:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil statistik tapping',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 6c. Auto-generate session_id untuk box
  generateSessionId: async (req, res) => {
    try {
      const { idBox } = req.params;
      if (!idBox) return res.status(400).json({ success: false, message: 'idBox wajib disertakan' });
      const nextId = await LogModel.getNextSessionId(idBox);
      return res.status(200).json({ success: true, data: { session_id: nextId } });
    } catch (error) {
      console.error('Error generateSessionId:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal generate session_id', error: 'REQUEST_FAILED' });
    }
  },

  // People Counting endpoints
  upsertPeopleCount: async (req, res) => {
    try {
      const { id_box, session_id, detected_count, registered_count } = req.body;
      if (typeof id_box !== 'string' || !id_box || !Number.isInteger(detected_count) || detected_count < 0 || detected_count > 10000 || (registered_count != null && (!Number.isInteger(registered_count) || registered_count < 0 || registered_count > 10000)) || (session_id != null && (!Number.isInteger(session_id) || session_id < 1))) {
        return res.status(400).json({ success: false, message: 'id_box dan detected_count wajib disertakan' });
      }
      await LogModel.upsertPeopleCount({
        idBox: id_box,
        sessionId: session_id,
        detectedCount: detected_count,
        registeredCount: registered_count || 0
      });
      return res.status(200).json({ success: true, message: 'People count updated' });
    } catch (error) {
      console.error('Error upsertPeopleCount:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal update people count', error: 'REQUEST_FAILED' });
    }
  },

  getLatestPeopleCount: async (req, res) => {
    try {
      const { idBox } = req.params;
      const data = await LogModel.getLatestPeopleCount(idBox);
      return res.status(200).json({ success: true, data: data ? { ...data, stale: Boolean(data.stale) } : { detected_count: null, registered_count: null, stale: true } });
    } catch (error) {
      console.error('Error getLatestPeopleCount:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal mengambil people count', error: 'REQUEST_FAILED' });
    }
  },

  getPeopleCountHistory: async (req, res) => {
    try {
      const { idBox } = req.params;
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
      const data = await LogModel.getPeopleCountHistory(idBox, limit);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('Error getPeopleCountHistory:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal mengambil riwayat people count', error: 'REQUEST_FAILED' });
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
      return res.status(500).json({ success: false, message: 'Gagal menghapus riwayat tapping', error: 'REQUEST_FAILED' });
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
        error: 'REQUEST_FAILED'
      });
    }
  },

  // ===== RFID BUFFER =====
  getAllBuffer: async (req, res) => {
    try {
      const buffer = await LogModel.getAllBuffer();
      return res.status(200).json({ success: true, data: buffer });
    } catch (error) {
      console.error('Error getAllBuffer:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal mengambil buffer', error: 'REQUEST_FAILED' });
    }
  },

  deleteBuffer: async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await LogModel.deleteBuffer(id);
      if (!deleted) return res.status(404).json({ success: false, message: 'Buffer tidak ditemukan' });
      return res.status(200).json({ success: true, message: 'Buffer berhasil dihapus' });
    } catch (error) {
      console.error('Error deleteBuffer:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal menghapus buffer', error: 'REQUEST_FAILED' });
    }
  }
};

export default logController;