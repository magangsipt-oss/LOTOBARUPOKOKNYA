import { isIP } from 'node:net';
import crypto from 'node:crypto';
import BoxModel from '../models/boxModel.js';
import pool from '../config/database.js';
import { TELEMETRY_ONLINE_WINDOW_SECONDS, validateTelemetry } from '../domain/telemetry.js';
import { recordTelemetry } from '../models/telemetryModel.js';
import { validDeviceCredential } from '../security/deviceCredential.js';

/**
 * Controller untuk mengelola alur data dan permintaan Box E-LOTO
 */

function generateDeviceToken() {
  return 'ELOTO-' + crypto.randomBytes(16).toString('hex').toUpperCase();
}

const MAX_DEVICE_STATUS_BYTES = 64 * 1024;

function isPrivateIpv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function databaseProbeData(box) {
  let hardware = {};
  try { hardware = JSON.parse(box.hw_data || '{}') || {}; } catch { /* Invalid snapshots have no trusted GPS fix. */ }
  const online = Number(box.is_online) === 1;
  const gpsFix = online && hardware.gps_fix === true && box.lat != null && box.lng != null &&
    Number.isFinite(Number(box.lat)) && Math.abs(Number(box.lat)) <= 90 &&
    Number.isFinite(Number(box.lng)) && Math.abs(Number(box.lng)) <= 180;
  return {
    id_box: box.id_box, ip: box.ip, is_online: online ? 1 : 0, last_ping: box.last_ping,
    lat: gpsFix ? Number(box.lat) : null, lng: gpsFix ? Number(box.lng) : null,
    gps_fix: gpsFix, state: online ? box.state : null, wifi_connected: online,
    telemetry_online: online ? 1 : 0, telemetry_last_ping: box.last_ping,
    stale: !online, source: 'database'
  };
}

async function readRegisteredDeviceStatus(box) {
  const response = await fetch(`http://${box.ip}/status`, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) throw new Error(`Device status HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_DEVICE_STATUS_BYTES) {
    throw new Error('Device status is too large');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_DEVICE_STATUS_BYTES) throw new Error('Device status is too large');
  const status = JSON.parse(text);
  if (!status || typeof status !== 'object' || Array.isArray(status) || status.id_box !== box.id_box) {
    throw new Error('Device identity mismatch');
  }

  const latitude = Number(status.lat);
  const longitude = Number(status.lng ?? status.lon);
  const gpsFix = status.gps_fix === true && Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
    Number.isFinite(longitude) && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0);
  const state = typeof status.state === 'string' && status.state.length <= 50 ? status.state : box.state;
  const lcd0 = typeof status.lcd0 === 'string' ? status.lcd0.slice(0, 100) : '';
  const lcd1 = typeof status.lcd1 === 'string' ? status.lcd1.slice(0, 100) : '';
  const uptime = Number.isFinite(Number(status.uptime_ms)) && Number(status.uptime_ms) >= 0 ? Number(status.uptime_ms) : 0;
  let previousHardware = {};
  try { previousHardware = JSON.parse(box.hw_data || '{}') || {}; } catch { /* Ignore malformed saved telemetry. */ }
  const hardware = JSON.stringify({ ...previousHardware, ...status });

    if (status.last_uid && typeof status.last_uid === 'string' && status.last_uid.length >= 8 && status.last_uid !== '---') {
      if (true) {
        pool.query('SELECT id FROM rfid_buffer WHERE id_box = ? AND rfid_uid = ? LIMIT 1', [box.id_box, status.last_uid]).then(([bufferCheck]) => {
          if (!bufferCheck.length) {
            pool.query('INSERT INTO rfid_buffer (id_box, rfid_uid) VALUES (?, ?)', [box.id_box, status.last_uid]);
            console.log('[PULL WORKAROUND] Inserted new card into buffer: ' + status.last_uid);
          }
        });
      }
    }

  await pool.query(`UPDATE boxes SET state = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng),
    lcd0 = ?, lcd1 = ?, relay_open = ?, uptime_ms = ?, hw_data = ?, updated_at = NOW()
    WHERE id_box = ? AND ip = ?`,
  [state, gpsFix ? latitude : null, gpsFix ? longitude : null, lcd0, lcd1,
    Number(Boolean(status.relay_open)), uptime, hardware, box.id_box, box.ip]);

  return {
    id_box: box.id_box, ip: box.ip, is_online: 1, last_ping: box.last_ping,
    lat: gpsFix ? latitude : null, lng: gpsFix ? longitude : null, gps_fix: gpsFix,
    state, wifi_connected: true, telemetry_online: Number(box.is_online) === 1 ? 1 : 0,
    telemetry_last_ping: box.last_ping, device_checked_at: new Date().toISOString(),
    stale: Number(box.is_online) !== 1, source: 'device', hw_data: hardware
  };
}

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
      const { unit, ip, state, lat, lng, supervisorUid, rtsp_url, device_token } = req.body;
      const idBox = req.body.idBox ?? req.body.id_box;
      const latitude = lat == null || (typeof lat === 'string' && !lat.trim()) ? null : Number(lat);
      const longitude = lng == null || (typeof lng === 'string' && !lng.trim()) ? null : Number(lng);

      // Validasi: idBox dan unit wajib diisi
      if (!idBox || !unit) {
        return res.status(400).json({
          success: false,
          message: 'ID Box (idBox) dan unit wajib diisi!'
        });
      }

      if ([lat, lng].some(value => value != null && !['string', 'number'].includes(typeof value)) ||
          (latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) ||
          (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180))) {
        return res.status(400).json({ success: false, message: 'Koordinat tidak valid.' });
      }

      if (device_token !== undefined && device_token !== null &&
          !validDeviceCredential(device_token)) {
        return res.status(400).json({ success: false, message: 'Token perangkat tidak valid.' });
      }

      // Hash device_token jika disediakan, atau generate otomatis
      let plainToken = null;
      let hashedToken = null;
      if (device_token && typeof device_token === 'string' && device_token.trim()) {
        plainToken = device_token.trim();
        hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
      } else {
        plainToken = generateDeviceToken();
        hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
      }

      const newIdBox = await BoxModel.create({
        idBox,
        unit,
        ip: ip || '0.0.0.0',
        state: 'STATE_IDLE',
        lat: latitude,
        lng: longitude,
        supervisorUid: supervisorUid || '',
        rtsp_url: rtsp_url || null,
        device_token: hashedToken
      });


      return res.status(201).json({
        success: true,
        message: 'Box baru berhasil didaftarkan; menunggu telemetri perangkat.',
        data: {
          idBox: newIdBox, unit,
          state: 'STATE_IDLE',
          is_online: 0,
          lat: latitude,
          lng: longitude,
          device_token: plainToken,
        }
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
      const boxId = req.auth.boxId;
      const result = await recordTelemetry(boxId, body);
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  },

  // Firmware verifies this authenticated response before trusting a discovered
  // host as its backend. Authorization has already bound the URL to boxId.
  deviceHandshake: (req, res) => {
    const idBox = req.auth?.boxId;
    return res.json({
      success: true,
      data: {
        contract: 'eloto-device-v1',
        id_box: idBox,
        telemetry_endpoint: `/api/boxes/${encodeURIComponent(idBox)}/telemetry`
      }
    });
  },

  // Pull a registered private-LAN device, falling back to its authenticated telemetry snapshot.
  probeDevice: async (req, res, next) => {
    try {
      const ip = String(req.params.ip || '').trim();
      if (!isIP(ip)) return res.status(400).json({ success: false, message: 'IP address tidak valid.' });
      if (!isPrivateIpv4(ip)) return res.status(400).json({ success: false, message: 'IP boks harus berada di jaringan private.' });
      const [rows] = await pool.query(`SELECT id_box, ip, state, lat, lng, hw_data, last_ping,
        CASE WHEN is_online = 1 AND last_ping >= NOW() - INTERVAL ${TELEMETRY_ONLINE_WINDOW_SECONDS} SECOND THEN 1 ELSE 0 END AS is_online
        FROM boxes WHERE ip = ? LIMIT 2`, [ip]);
      if (!rows.length) {
        return res.json({
          success: true,
          data: {
            id_box: null,
            ip,
            is_online: 0,
            last_ping: null,
            lat: null,
            lng: null,
            gps_fix: false,
            state: null,
            wifi_connected: false,
            stale: true,
            source: 'database',
            message: 'Belum ada telemetri untuk IP ini.'
          }
        });
      }
      if (rows.length > 1) return res.status(409).json({ success: false, message: 'IP dipakai lebih dari satu boks.' });
      const box = rows[0];
      try {
        return res.json({ success: true, data: await readRegisteredDeviceStatus(box) });
      } catch {
        return res.json({ success: true, data: databaseProbeData(box) });
      }
    } catch (error) { next(error); }
  },

  regenerateToken: async (req, res, next) => {
    try {
      const { idBox } = req.params;
      const plainToken = generateDeviceToken();
      const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
      const pool = (await import('../config/database.js')).default;
      const [result] = await pool.query('UPDATE boxes SET device_token = ? WHERE id_box = ?', [hashedToken, idBox]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'Box tidak ditemukan' });
      }
      return res.json({ success: true, message: 'Token baru berhasil digenerate', data: { device_token: plainToken } });
    } catch (error) { next(error); }
  }
};
export default boxController;
