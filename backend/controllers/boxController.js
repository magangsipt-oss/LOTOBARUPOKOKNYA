import BoxModel from '../models/boxModel.js';
import LogModel from '../models/logModel.js';

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
        error: error.message
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
        data: box
      });
    } catch (error) {
      console.error('Error getBoxById:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil detail box',
        error: error.message
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
        state: state || 'IDLE',
        lat: lat || 0,
        lng: lng || 0,
        supervisorUid: supervisorUid || '',
        rtsp_url: rtsp_url || null
      });

      return res.status(201).json({
        success: true,
        message: 'Box baru berhasil didaftarkan ke sistem',
        data: { idBox: newIdBox, unit, state: state || 'IDLE' }
      });
    } catch (error) {
      console.error('Error createBox:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menambahkan box baru',
        error: error.message
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
        error: error.message
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
      return res.status(500).json({
        success: false,
        message: 'Gagal menghapus box',
        error: error.message
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
        error: error.message
      });
    }
  },

  // 7. Memperbarui telemetri/hardware status dari ESP32
  updateTelemetry: async (req, res) => {
    try {
      const { idBox } = req.params;
      const body = req.body || {};
      const state = body.state || 'STATE_IDLE';
      const lastEvent = body.event ?? body.lastEvent ?? 'HEARTBEAT_SYNC';
      const lastUid = body.uid ?? body.lastUid ?? 'SYSTEM';
      const gpsFix = body.gps_fix ?? body.gpsFix ?? false;
      const latitude = body.lat === null || body.lat === undefined ? null : Number(body.lat);
      const longitude = body.lng === null || body.lng === undefined ? null : Number(body.lng);
      const hasGpsFix = gpsFix === true || gpsFix === 1 || gpsFix === '1';
      const isOnlineValue = body.is_online ?? body.isOnline ?? false;

      if (!idBox) {
        return res.status(400).json({
          success: false,
          message: 'Parameter idBox wajib disertakan!'
        });
      }

      const isUpdated = await BoxModel.updateTelemetry(idBox, {
        state,
        lastEvent,
        lastUid,
        lat: hasGpsFix && Number.isFinite(latitude) ? latitude : null,
        lng: hasGpsFix && Number.isFinite(longitude) ? longitude : null,
        lcdZero: body.lcd0 ?? body.lcdZero ?? '',
        lcdOne: body.lcd1 ?? body.lcdOne ?? '',
        relayOpen: (body.relay_open ?? body.relayOpen) ? 1 : 0,
        uptimeMs: body.uptime_ms ?? body.uptimeMs ?? 0,
        hwData: body.hw_data ?? body.hwData ?? null,
        isOnline: isOnlineValue === true || isOnlineValue === 1 || isOnlineValue === '1' ? 1 : 0,
        ssid: body.ssid ?? null,
        ip: body.ip ?? null
      });

      if (!isUpdated && !(await BoxModel.getByIdBox(idBox))) {
        return res.status(404).json({
          success: false,
          message: `Box dengan ID ${idBox} tidak ditemukan`
        });
      }

      // Auto-create tapping_history jika event adalah tap (IN/OUT)
      const isTap = body.is_tap === true || body.is_tap === 1 || body.is_tap === '1';
      const tapEventsIn = ['SUPERVISOR_LOCK_IN', 'MECHANIC_LOG_IN', 'REFUEL_START'];
      const tapEventsOut = ['SUPERVISOR_LOG_OUT', 'MECHANIC_LOG_OUT', 'REFUEL_END'];

      if (isTap && lastUid && lastUid !== 'SYSTEM') {
        let eventType = 'CHECK';
        if (tapEventsIn.includes(lastEvent)) eventType = 'IN';
        else if (tapEventsOut.includes(lastEvent)) eventType = 'OUT';

        // Generate session_id: new session saat state berubah dari IDLE ke WAIT_SPV_IN
        let sessionId = body.session_id || null;
        if (!sessionId && state === 'WAIT_SPV_IN') {
          sessionId = await LogModel.getNextSessionId(idBox);
        }

        await LogModel.createTappingHistory({
          idBox,
          rfidUid: lastUid,
          nama: null,
          eventType,
          eventText: lastEvent,
          lat: hasGpsFix && Number.isFinite(latitude) ? latitude : null,
          lng: hasGpsFix && Number.isFinite(longitude) ? longitude : null,
          sessionId
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Telemetri box berhasil diperbarui',
        data: { id_box: idBox, state, last_event: lastEvent, is_online: isOnlineValue }
      });
    } catch (error) {
      console.error('Error updateTelemetry:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal memperbarui telemetri box',
        error: error.message
      });
    }
  }
};

export default boxController;