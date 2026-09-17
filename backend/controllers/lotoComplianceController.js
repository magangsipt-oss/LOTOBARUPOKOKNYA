import pool from '../config/database.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

function requestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Payload tidak valid');
  return body;
}

function requiredText(value, max, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${field} tidak valid`);
  return value.trim();
}

function optionalText(value, max, field) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim().length > max) fail(`${field} tidak valid`);
  return value.trim() || null;
}

function normalizeMac(value) {
  const mac = requiredText(value, 17, 'MAC address').toUpperCase();
  if (!/^(?:[A-F0-9]{2}:){5}[A-F0-9]{2}$/.test(mac)) fail('Format MAC address tidak valid');
  return mac;
}

function tagId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail('ID tag tidak valid');
  return Number(value);
}

async function validateAssignment(sid) {
  if (sid === null) return;
  const [users] = await pool.query('SELECT sid FROM users WHERE sid = ?', [sid]);
  if (!users.length) fail('SID pengguna tidak ditemukan');
}

function errorResponse(res, error, message, operation) {
  const status = error.code === 'ER_DUP_ENTRY' ? 409 : [400, 404, 409].includes(error.status) ? error.status : 500;
  if (status === 500) console.error(`Error ${operation}:`, error.message);
  return res.status(status).json({
    success: false,
    message: error.code === 'ER_DUP_ENTRY' ? 'BLE tag dengan MAC ini sudah terdaftar' : status === 500 ? message : error.message,
    ...(status === 500 ? { error: 'REQUEST_FAILED' } : {})
  });
}

/**
 * Controller untuk BLE LOTO Compliance Monitoring
 * - BLE Smart Tag presence detection
 * - RFID SID card tap compliance tracking
 * - Comparison: who's present vs who has applied LOTO
 */

const lotoComplianceController = {
  // 1. BLE Scanner mengirim hasil scan (daftar tag MAC yang terdeteksi)
  reportPresence: async (req, res) => {
    try {
      const body = requestBody(req.body);
      const id_box = requiredText(body.id_box, 50, 'id_box');
      if (!Array.isArray(body.ble_tags) || body.ble_tags.length > 100) fail('ble_tags harus berupa array maksimal 100 MAC');
      const macs = [...new Set(body.ble_tags.map(normalizeMac))];
      if (has(body, 'session_id') && body.session_id !== null && (!Number.isSafeInteger(body.session_id) || body.session_id < 1)) fail('session_id tidak valid');

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Serialize with telemetry so the session and queue belong to one snapshot.
        const [boxes] = await connection.query('SELECT active_session_id FROM boxes WHERE id_box = ? FOR UPDATE', [id_box]);
        if (!boxes.length) fail('Box tidak ditemukan', 404);
        const session = boxes[0].active_session_id;
        if (has(body, 'session_id') && body.session_id !== session) fail('Sesi BLE tidak sesuai sesi aktif box', 409);

        // Log each detected BLE tag
        for (const mac of macs) {
          await connection.query(
            `INSERT INTO ble_presence_log (id_box, ble_mac, detected_at) VALUES (?, ?, NOW())`,
            [id_box, mac]
          );
        }

        // Resolve BLE MACs to SIDs
        const [tagRows] = macs.length ? await connection.query(
          `SELECT bt.mac_address, u.sid AS assigned_sid FROM ble_tags bt
           JOIN users u ON u.sid = bt.assigned_sid
           WHERE bt.mac_address IN (?) AND bt.is_active = 1`,
          [macs]
        ) : [[]];
        const detectedSids = [...new Set(tagRows.map(r => r.assigned_sid).filter(Boolean))];

        // The live LOTO queue excludes fuel-only taps, old sessions and offline replay.
        // Prefer the RFID owner; a SID fallback supports cards carrying the SID itself.
        const [tappedRows] = session == null ? [[]] : await connection.query(
          `SELECT DISTINCT COALESCE(card_user.sid, sid_user.sid) AS sid
           FROM queue q
           LEFT JOIN users card_user ON card_user.rfid_uid = q.rfid_uid
           LEFT JOIN users sid_user ON sid_user.sid = q.rfid_uid AND card_user.sid IS NULL
           WHERE q.id_box = ? AND q.session_id = ?`,
          [id_box, session]
        );

        const tappedSids = [...new Set(tappedRows.map(r => r.sid).filter(Boolean))];

        // Find SIDs that are missing (present via BLE but haven't tapped)
        const missingSids = detectedSids.filter(sid => !tappedSids.includes(sid));

        // Append a snapshot for the compliance history.
        await connection.query(
          `INSERT INTO loto_compliance (id_box, ble_detected_count, loto_tapped_count, missing_count, detected_sids, tapped_sids, missing_sids, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            id_box,
            detectedSids.length,
            tappedSids.length,
            missingSids.length,
            JSON.stringify(detectedSids),
            JSON.stringify(tappedSids),
            JSON.stringify(missingSids)
          ]
        );

        await connection.commit();

        return res.status(200).json({
          success: true,
          message: 'BLE presence & LOTO compliance updated',
          data: {
            id_box,
            ble_detected_count: detectedSids.length,
            loto_tapped_count: tappedSids.length,
            missing_count: missingSids.length,
            detected_sids: detectedSids,
            tapped_sids: tappedSids,
            missing_sids: missingSids
          }
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      return errorResponse(res, error, 'Gagal update BLE presence', 'reportPresence');
    }
  },

  // 2. Get latest compliance status for a box
  getLatestCompliance: async (req, res) => {
    try {
      const idBox = requiredText(req.params.idBox, 50, 'idBox');
      const [rows] = await pool.query(
        'SELECT *, (created_at < NOW() - INTERVAL 30 SECOND) AS stale FROM loto_compliance WHERE id_box = ? ORDER BY created_at DESC, id DESC LIMIT 1',
        [idBox]
      );

      const data = rows[0] || null;
      // Parse JSON fields
      if (data) {
        data.detected_sids = JSON.parse(data.detected_sids || '[]');
        data.tapped_sids = JSON.parse(data.tapped_sids || '[]');
        data.missing_sids = JSON.parse(data.missing_sids || '[]');
      }

      return res.status(200).json({ success: true, data });
    } catch (error) {
      return errorResponse(res, error, 'Gagal mengambil data compliance', 'getLatestCompliance');
    }
  },

  // 3. Get compliance history for a box
  getComplianceHistory: async (req, res) => {
    try {
      const idBox = requiredText(req.params.idBox, 50, 'idBox');
      const requestedLimit = req.query.limit === undefined ? 20 : Number(req.query.limit);
      if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || Array.isArray(req.query.limit)) fail('limit harus berupa bilangan bulat positif');
      const limit = Math.min(requestedLimit, 200);
      const [rows] = await pool.query(
        'SELECT * FROM loto_compliance WHERE id_box = ? ORDER BY created_at DESC, id DESC LIMIT ?',
        [idBox, limit]
      );

      // Parse JSON fields for each row
      const parsed = rows.map(row => ({
        ...row,
        detected_sids: JSON.parse(row.detected_sids || '[]'),
        tapped_sids: JSON.parse(row.tapped_sids || '[]'),
        missing_sids: JSON.parse(row.missing_sids || '[]')
      }));

      return res.status(200).json({ success: true, data: parsed });
    } catch (error) {
      return errorResponse(res, error, 'Gagal mengambil riwayat compliance', 'getComplianceHistory');
    }
  },

  // 4. BLE tag management
  getAllTags: async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT bt.*, u.nama AS assigned_name, u.role AS assigned_role
         FROM ble_tags bt
         LEFT JOIN users u ON bt.assigned_sid = u.sid
         ORDER BY bt.created_at DESC`
      );
      return res.status(200).json({ success: true, data: rows });
    } catch (error) {
      console.error('Error getAllTags:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal mengambil data BLE tags', error: 'REQUEST_FAILED' });
    }
  },

  registerTag: async (req, res) => {
    try {
      const body = requestBody(req.body);
      const cleanMac = normalizeMac(body.mac_address);
      const tag_name = optionalText(body.tag_name, 100, 'tag_name');
      const assigned_sid = optionalText(body.assigned_sid, 50, 'assigned_sid');

      // Check if already registered
      const [existing] = await pool.query('SELECT id FROM ble_tags WHERE mac_address = ?', [cleanMac]);
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: 'BLE tag dengan MAC ini sudah terdaftar' });
      }

      await validateAssignment(assigned_sid);

      await pool.query(
        'INSERT INTO ble_tags (mac_address, tag_name, assigned_sid, is_active) VALUES (?, ?, ?, 1)',
        [cleanMac, tag_name, assigned_sid]
      );

      return res.status(201).json({
        success: true,
        message: 'BLE tag berhasil didaftarkan',
        data: { mac_address: cleanMac, tag_name, assigned_sid }
      });
    } catch (error) {
      return errorResponse(res, error, 'Gagal mendaftarkan BLE tag', 'registerTag');
    }
  },

  updateTag: async (req, res) => {
    try {
      const id = tagId(req.params.id);
      const body = requestBody(req.body);
      const updates = [];
      const values = [];
      for (const [field, max] of [['tag_name', 100], ['assigned_sid', 50]]) {
        if (!has(body, field)) continue;
        const value = optionalText(body[field], max, field);
        updates.push(`${field} = ?`);
        values.push(value);
      }
      if (has(body, 'is_active')) {
        if (![true, false, 0, 1].includes(body.is_active)) fail('is_active tidak valid');
        updates.push('is_active = ?');
        values.push(Number(body.is_active));
      }
      if (!updates.length) fail('Tidak ada data tag yang diperbarui');
      if (has(body, 'assigned_sid')) await validateAssignment(optionalText(body.assigned_sid, 50, 'assigned_sid'));
      const [result] = await pool.query(`UPDATE ble_tags SET ${updates.join(', ')} WHERE id = ?`, [...values, id]);
      if (result.affectedRows === 0) fail('BLE tag tidak ditemukan', 404);

      return res.status(200).json({ success: true, message: 'BLE tag berhasil diperbarui' });
    } catch (error) {
      return errorResponse(res, error, 'Gagal memperbarui BLE tag', 'updateTag');
    }
  },

  deleteTag: async (req, res) => {
    try {
      const id = tagId(req.params.id);
      const [result] = await pool.query('DELETE FROM ble_tags WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'BLE tag tidak ditemukan' });
      }
      return res.status(200).json({ success: true, message: 'BLE tag berhasil dihapus' });
    } catch (error) {
      return errorResponse(res, error, 'Gagal menghapus BLE tag', 'deleteTag');
    }
  },

  // 5. Get active BLE presence for a box (recent detections)
  getActivePresence: async (req, res) => {
    try {
      const idBox = requiredText(req.params.idBox, 50, 'idBox');
      // Get distinct tags detected in the last 60 seconds
      const [rows] = await pool.query(
        `SELECT DISTINCT ble_mac, MAX(detected_at) AS last_seen
         FROM ble_presence_log
         WHERE id_box = ? AND detected_at >= NOW() - INTERVAL 60 SECOND
         GROUP BY ble_mac
         ORDER BY last_seen DESC`,
        [idBox]
      );

      // Resolve to SIDs and names
      const macs = rows.map(r => r.ble_mac);
      let resolved = [];
      if (macs.length > 0) {
        const [tagRows] = await pool.query(
          `SELECT bt.mac_address, bt.assigned_sid, bt.tag_name, u.nama, u.role
           FROM ble_tags bt
           LEFT JOIN users u ON bt.assigned_sid = u.sid
           WHERE bt.mac_address IN (?) AND bt.is_active = 1`,
          [macs]
        );
        const tagMap = new Map(tagRows.map(t => [t.mac_address, t]));
        resolved = rows.map(r => {
          const tag = tagMap.get(r.ble_mac);
          return {
            ble_mac: r.ble_mac,
            last_seen: r.last_seen,
            assigned_sid: tag?.assigned_sid || null,
            nama: tag?.nama || 'Unknown',
            role: tag?.role || '—',
            tag_name: tag?.tag_name || null,
            is_registered: Boolean(tag?.assigned_sid)
          };
        });
      }

      return res.status(200).json({ success: true, data: resolved });
    } catch (error) {
      return errorResponse(res, error, 'Gagal mengambil data presence aktif', 'getActivePresence');
    }
  }
};

export default lotoComplianceController;
