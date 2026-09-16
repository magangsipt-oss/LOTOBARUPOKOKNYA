import pool from '../config/database.js';

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
      const { id_box, ble_tags, session_id } = req.body;
      if (!id_box || !Array.isArray(ble_tags)) {
        return res.status(400).json({ success: false, message: 'id_box dan ble_tags (array) wajib diisi' });
      }

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Log each detected BLE tag
        for (const mac of ble_tags) {
          if (!mac || typeof mac !== 'string') continue;
          await connection.query(
            `INSERT INTO ble_presence_log (id_box, ble_mac, detected_at) VALUES (?, ?, NOW())`,
            [id_box, mac.toUpperCase()]
          );
        }

        // Resolve BLE MACs to SIDs
        const [tagRows] = await connection.query(
          'SELECT mac_address, assigned_sid FROM ble_tags WHERE mac_address IN (?) AND is_active = 1',
          [ble_tags.map(m => m.toUpperCase())]
        );
        const detectedSids = tagRows.map(r => r.assigned_sid).filter(Boolean);

        // Get current tapping session: who has tapped LOTO for this box
        const [tappedRows] = await connection.query(
          `SELECT DISTINCT rfid_uid FROM tapping_history
           WHERE id_box = ? AND event_type = 'IN'
           AND rfid_uid NOT IN (
             SELECT th2.rfid_uid FROM tapping_history th2
             WHERE th2.id_box = ? AND th2.event_type = 'OUT'
             AND th2.created_at > tapping_history.created_at
           )
           ORDER BY created_at DESC`,
          [id_box, id_box]
        );

        const tappedUids = tappedRows.map(r => r.rfid_uid).filter(Boolean);

        // Find SIDs that are missing (present via BLE but haven't tapped)
        const missingSids = detectedSids.filter(sid => !tappedUids.includes(sid));

        // Upsert compliance snapshot
        await connection.query(
          `INSERT INTO loto_compliance (id_box, ble_detected_count, loto_tapped_count, missing_count, detected_sids, tapped_sids, missing_sids, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             ble_detected_count = VALUES(ble_detected_count),
             loto_tapped_count = VALUES(loto_tapped_count),
             missing_count = VALUES(missing_count),
             detected_sids = VALUES(detected_sids),
             tapped_sids = VALUES(tapped_sids),
             missing_sids = VALUES(missing_sids),
             created_at = NOW()`,
          [
            id_box,
            detectedSids.length,
            tappedUids.length,
            missingSids.length,
            JSON.stringify(detectedSids),
            JSON.stringify(tappedUids),
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
            loto_tapped_count: tappedUids.length,
            missing_count: missingSids.length,
            detected_sids: detectedSids,
            tapped_sids: tappedUids,
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
      console.error('Error reportPresence:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal update BLE presence', error: 'REQUEST_FAILED' });
    }
  },

  // 2. Get latest compliance status for a box
  getLatestCompliance: async (req, res) => {
    try {
      const { idBox } = req.params;
      const [rows] = await pool.query(
        'SELECT *, (created_at < NOW() - INTERVAL 30 SECOND) AS stale FROM loto_compliance WHERE id_box = ? ORDER BY created_at DESC LIMIT 1',
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
      console.error('Error getLatestCompliance:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal mengambil data compliance', error: 'REQUEST_FAILED' });
    }
  },

  // 3. Get compliance history for a box
  getComplianceHistory: async (req, res) => {
    try {
      const { idBox } = req.params;
      const limit = parseInt(req.query.limit) || 20;
      const [rows] = await pool.query(
        'SELECT * FROM loto_compliance WHERE id_box = ? ORDER BY created_at DESC LIMIT ?',
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
      console.error('Error getComplianceHistory:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal mengambil riwayat compliance', error: 'REQUEST_FAILED' });
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
      const { mac_address, tag_name, assigned_sid } = req.body;
      if (!mac_address) {
        return res.status(400).json({ success: false, message: 'mac_address wajib diisi' });
      }

      const cleanMac = mac_address.toUpperCase().replace(/[^A-F0-9:]/g, '');

      // Check if already registered
      const [existing] = await pool.query('SELECT id FROM ble_tags WHERE mac_address = ?', [cleanMac]);
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: 'BLE tag dengan MAC ini sudah terdaftar' });
      }

      await pool.query(
        'INSERT INTO ble_tags (mac_address, tag_name, assigned_sid, is_active) VALUES (?, ?, ?, 1)',
        [cleanMac, tag_name || null, assigned_sid || null]
      );

      return res.status(201).json({
        success: true,
        message: 'BLE tag berhasil didaftarkan',
        data: { mac_address: cleanMac, tag_name, assigned_sid }
      });
    } catch (error) {
      console.error('Error registerTag:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal mendaftarkan BLE tag', error: 'REQUEST_FAILED' });
    }
  },

  updateTag: async (req, res) => {
    try {
      const { id } = req.params;
      const { tag_name, assigned_sid, is_active } = req.body;

      await pool.query(
        'UPDATE ble_tags SET tag_name = COALESCE(?, tag_name), assigned_sid = COALESCE(?, assigned_sid), is_active = COALESCE(?, is_active) WHERE id = ?',
        [tag_name, assigned_sid, is_active, id]
      );

      return res.status(200).json({ success: true, message: 'BLE tag berhasil diperbarui' });
    } catch (error) {
      console.error('Error updateTag:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal memperbarui BLE tag', error: 'REQUEST_FAILED' });
    }
  },

  deleteTag: async (req, res) => {
    try {
      const { id } = req.params;
      const [result] = await pool.query('DELETE FROM ble_tags WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: 'BLE tag tidak ditemukan' });
      }
      return res.status(200).json({ success: true, message: 'BLE tag berhasil dihapus' });
    } catch (error) {
      console.error('Error deleteTag:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal menghapus BLE tag', error: 'REQUEST_FAILED' });
    }
  },

  // 5. Get active BLE presence for a box (recent detections)
  getActivePresence: async (req, res) => {
    try {
      const { idBox } = req.params;
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
           WHERE bt.mac_address IN (?)`,
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
      console.error('Error getActivePresence:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal mengambil data presence aktif', error: 'REQUEST_FAILED' });
    }
  }
};

export default lotoComplianceController;
