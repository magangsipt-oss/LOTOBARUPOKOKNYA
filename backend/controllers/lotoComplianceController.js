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

// Nomor BLE per personel dari box: slot = urutan tap, mac = iTag yang diikat saat tap.
function parseSlots(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 20) fail('ble_slots harus berupa array maksimal 20 slot');
  const seen = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Slot BLE tidak valid');
    const slot = item.slot;
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > 20 || seen.has(slot)) fail('Nomor slot BLE tidak valid');
    seen.add(slot);
    for (const key of ['present', 'pending']) {
      if (item[key] !== undefined && typeof item[key] !== 'boolean') fail(`${key} slot BLE tidak valid`);
    }
    if (item.rssi != null && (!Number.isSafeInteger(item.rssi) || item.rssi < -127 || item.rssi > 20)) fail('RSSI slot BLE tidak valid');
    const sid = optionalText(item.sid, 50, 'SID slot BLE');
    const mac = item.mac == null || item.mac === '' ? null : normalizeMac(item.mac);
    const present = Boolean(mac && item.present);
    return {
      slot,
      sid: sid && !/^-+$/.test(sid) ? sid : null,
      uid: optionalText(item.uid, 50, 'UID slot BLE'),
      mac,
      present,
      pending: !mac && item.pending === true,
      rssi: present && item.rssi != null ? item.rssi : null
    };
  });
}

function parseJsonArray(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

// Bandingkan snapshot sebelumnya agar riwayat hanya mencatat perubahan.
function diffBleEvents(previous, slots, unknownMacs) {
  const events = [];
  const previousSlots = new Map(previous.slots.map(slot => [slot.slot, slot]));
  for (const slot of slots) {
    let before = previousSlots.get(slot.slot);
    if (before && before.sid !== slot.sid) before = null;
    if (slot.mac) {
      const newlyBound = !before || before.mac !== slot.mac;
      if (newlyBound) events.push([slot.slot, slot.sid, slot.mac, 'TAG_BOUND']);
      else if (slot.present && !before.present) events.push([slot.slot, slot.sid, slot.mac, 'TAG_DETECTED']);
      else if (!slot.present && before.present) events.push([slot.slot, slot.sid, slot.mac, 'TAG_LOST']);
    } else if (!slot.pending && (!before || before.pending)) {
      events.push([slot.slot, slot.sid, null, 'TAG_NOT_FOUND']);
    }
  }
  const previousUnknown = new Set(previous.unknownTags);
  for (const mac of unknownMacs) if (!previousUnknown.has(mac)) events.push([null, null, mac, 'UNKNOWN_TAG']);
  for (const mac of previousUnknown) if (!unknownMacs.includes(mac)) events.push([null, null, mac, 'UNKNOWN_TAG_GONE']);
  return events;
}

function tagId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) fail('ID tag tidak valid');
  return Number(value);
}

async function lockAssignedUser(connection, sid) {
  if (sid === null) return;
  const [users] = await connection.query('SELECT sid FROM users WHERE sid = ? FOR UPDATE', [sid]);
  if (!users.length) fail('SID pengguna tidak ditemukan');
}

async function ensureNoOtherActiveTag(connection, sid, excludeId = null) {
  if (sid === null) return;
  const [rows] = excludeId === null
    ? await connection.query(
      'SELECT id FROM ble_tags WHERE assigned_sid = ? AND is_active = 1 LIMIT 1 FOR UPDATE',
      [sid]
    )
    : await connection.query(
      'SELECT id FROM ble_tags WHERE assigned_sid = ? AND is_active = 1 AND id <> ? LIMIT 1 FOR UPDATE',
      [sid, excludeId]
    );
  if (rows.length) fail('Karyawan ini sudah memiliki BLE tag aktif', 409);
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

async function refreshComplianceForRecentPresence() {
  const [recentBoxes] = await pool.query(
    `SELECT DISTINCT id_box FROM ble_presence_log
     WHERE detected_at >= NOW() - INTERVAL 15 SECOND`
  );

  for (const { id_box: idBox } of recentBoxes) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [boxes] = await connection.query(
        'SELECT active_session_id FROM boxes WHERE id_box = ? FOR UPDATE',
        [idBox]
      );
      if (!boxes.length) {
        await connection.commit();
        continue;
      }

      const [tagRows] = await connection.query(
        `SELECT DISTINCT u.sid
         FROM ble_presence_log p
         JOIN ble_tags bt ON bt.mac_address = p.ble_mac AND bt.is_active = 1
         JOIN users u ON u.sid = bt.assigned_sid
         WHERE p.id_box = ? AND p.detected_at >= NOW() - INTERVAL 15 SECOND`,
        [idBox]
      );
      const detectedSids = [...new Set(tagRows.map(row => row.sid).filter(Boolean))];
      const sessionId = boxes[0].active_session_id;
      const [tappedRows] = sessionId == null ? [[]] : await connection.query(
        `SELECT DISTINCT COALESCE(card_user.sid, sid_user.sid) AS sid
         FROM queue q
         LEFT JOIN users card_user ON card_user.rfid_uid = q.rfid_uid
         LEFT JOIN users sid_user ON sid_user.sid = q.rfid_uid AND card_user.sid IS NULL
         WHERE q.id_box = ? AND q.session_id = ?`,
        [idBox, sessionId]
      );
      const tappedSids = [...new Set(tappedRows.map(row => row.sid).filter(Boolean))];
      const missingSids = detectedSids.filter(sid => !tappedSids.includes(sid));

      await connection.query(
        `INSERT INTO loto_compliance
           (id_box, ble_detected_count, loto_tapped_count, missing_count,
            detected_sids, tapped_sids, missing_sids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          idBox,
          detectedSids.length,
          tappedSids.length,
          missingSids.length,
          JSON.stringify(detectedSids),
          JSON.stringify(tappedSids),
          JSON.stringify(missingSids)
        ]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
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
      const slots = parseSlots(body.ble_slots);

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
        // iTag yang diikat saat tap mewakili personel pada slot tersebut.
        const slotSids = slots ? slots.map(slot => slot.sid).filter(Boolean) : [];
        const detectedSids = [...new Set([
          ...tagRows.map(r => r.assigned_sid).filter(Boolean),
          ...(slots ? slots.filter(slot => slot.present && slot.sid).map(slot => slot.sid) : [])
        ])];

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

        // Slot di box sudah berarti tap berhasil, walau antrean server belum tersinkron.
        const tappedSids = [...new Set([...tappedRows.map(r => r.sid).filter(Boolean), ...slotSids])];

        // Find SIDs that are missing (present via BLE but haven't tapped)
        const missingSids = detectedSids.filter(sid => !tappedSids.includes(sid));

        // iTag yang tidak terikat ke tap mana pun dan tidak terdaftar ke karyawan.
        const boundMacs = new Set([
          ...(slots ? slots.map(slot => slot.mac).filter(Boolean) : []),
          ...tagRows.map(r => r.mac_address)
        ]);
        const unknownMacs = slots ? macs.filter(mac => !boundMacs.has(mac)) : [];
        // Tanpa toleransi: personel yang tap tanpa iTag tidak boleh "menutupi" iTag orang yang belum tap.
        // Hanya berlaku saat sesi LOTO berjalan dan sudah ada yang tap; di luar sesi iTag bebas berada di area.
        const bindingPending = slots ? slots.some(slot => slot.pending) : false;
        const sessionRunning = session != null && Boolean(slots && slots.length);
        const unidentifiedCount = !sessionRunning || bindingPending ? 0 : unknownMacs.length;

        if (slots) {
          const [previousRows] = await connection.query(
            'SELECT session_id, slots, unknown_tags FROM loto_compliance WHERE id_box = ? AND slots IS NOT NULL ORDER BY id DESC LIMIT 1',
            [id_box]
          );
          const previousRow = previousRows[0];
          const previous = previousRow && previousRow.session_id === session
            ? { slots: parseJsonArray(previousRow.slots), unknownTags: parseJsonArray(previousRow.unknown_tags) }
            : { slots: [], unknownTags: [] };
          const events = diffBleEvents(previous, slots, unknownMacs);
          if (events.length) {
            await connection.query(
              'INSERT INTO ble_events (id_box, session_id, slot, sid, ble_mac, event) VALUES ?',
              [events.map(([slot, sid, mac, event]) => [id_box, session, slot, sid, mac, event])]
            );
          }
        }

        // Append a snapshot for the compliance history.
        await connection.query(
          `INSERT INTO loto_compliance (id_box, session_id, ble_detected_count, loto_tapped_count, missing_count, detected_sids, tapped_sids, missing_sids, slots, unknown_tags, unknown_tag_count, unidentified_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            id_box,
            session,
            detectedSids.length,
            tappedSids.length,
            missingSids.length,
            JSON.stringify(detectedSids),
            JSON.stringify(tappedSids),
            JSON.stringify(missingSids),
            slots ? JSON.stringify(slots) : null,
            JSON.stringify(unknownMacs),
            unknownMacs.length,
            unidentifiedCount
          ]
        );

        await connection.commit();

        return res.status(200).json({
          success: true,
          message: 'BLE presence & LOTO compliance updated',
          data: {
            id_box,
            received_tag_count: macs.length,
            registered_tag_count: tagRows.length,
            ble_detected_count: detectedSids.length,
            loto_tapped_count: tappedSids.length,
            missing_count: missingSids.length,
            detected_sids: detectedSids,
            tapped_sids: tappedSids,
            missing_sids: missingSids,
            slots,
            unknown_tags: unknownMacs,
            unknown_tag_count: unknownMacs.length,
            unidentified_count: unidentifiedCount
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
        // Box mengirim heartbeat BLE tiap 15 detik selama sesi; toleransi satu laporan tertunda.
        'SELECT *, (created_at < NOW() - INTERVAL 45 SECOND) AS stale FROM loto_compliance WHERE id_box = ? ORDER BY created_at DESC, id DESC LIMIT 1',
        [idBox]
      );

      const data = rows[0] || null;
      // Parse JSON fields
      if (data) {
        data.detected_sids = JSON.parse(data.detected_sids || '[]');
        data.tapped_sids = JSON.parse(data.tapped_sids || '[]');
        data.missing_sids = JSON.parse(data.missing_sids || '[]');
        data.slots = data.slots == null ? null : parseJsonArray(data.slots);
        data.unknown_tags = parseJsonArray(data.unknown_tags);
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
        missing_sids: JSON.parse(row.missing_sids || '[]'),
        slots: row.slots == null ? null : parseJsonArray(row.slots),
        unknown_tags: parseJsonArray(row.unknown_tags)
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
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await lockAssignedUser(connection, assigned_sid);
        await ensureNoOtherActiveTag(connection, assigned_sid);
        await connection.query(
          'INSERT INTO ble_tags (mac_address, tag_name, assigned_sid, is_active) VALUES (?, ?, ?, 1)',
          [cleanMac, tag_name, assigned_sid]
        );
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      if (assigned_sid) {
        try { await refreshComplianceForRecentPresence(); }
        catch (error) { console.error('BLE pairing snapshot refresh failed:', error.message); }
      }

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
      const connection = await pool.getConnection();
      let assignmentChanged = false;
      try {
        await connection.beginTransaction();
        const [existing] = await connection.query(
          'SELECT id, assigned_sid, is_active FROM ble_tags WHERE id = ? FOR UPDATE', [id]
        );
        if (!existing.length) fail('BLE tag tidak ditemukan', 404);
        const assignedSid = has(body, 'assigned_sid')
          ? optionalText(body.assigned_sid, 50, 'assigned_sid')
          : existing[0].assigned_sid;
        const isActive = has(body, 'is_active')
          ? Number(body.is_active)
          : Number(existing[0].is_active);
        if (has(body, 'assigned_sid') || (isActive === 1 && assignedSid !== null)) {
          await lockAssignedUser(connection, assignedSid);
        }
        if (isActive === 1) await ensureNoOtherActiveTag(connection, assignedSid, id);
        assignmentChanged = has(body, 'assigned_sid') || has(body, 'is_active');
        await connection.query(`UPDATE ble_tags SET ${updates.join(', ')} WHERE id = ?`, [...values, id]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
      if (assignmentChanged) {
        try { await refreshComplianceForRecentPresence(); }
        catch (error) { console.error('BLE pairing snapshot refresh failed:', error.message); }
      }

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
      // Presence expires quickly so stopped or disconnected tags disappear promptly.
      const [rows] = await pool.query(
        `SELECT DISTINCT ble_mac, MAX(detected_at) AS last_seen
         FROM ble_presence_log
         WHERE id_box = ? AND detected_at >= NOW() - INTERVAL 15 SECOND
         GROUP BY ble_mac
         ORDER BY last_seen DESC`,
        [idBox]
      );

      // Resolve to SIDs and names
      const macs = rows.map(r => r.ble_mac);
      let resolved = [];
      if (macs.length > 0) {
        const [tagRows] = await pool.query(
          `SELECT bt.id AS tag_id, bt.mac_address, bt.assigned_sid, bt.tag_name, u.nama, u.role
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
            tag_id: tag?.tag_id || null,
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
  },

  // Riwayat perubahan BLE per nomor slot (diikat, terdeteksi, hilang, iTag tanpa tap).
  getBleEvents: async (req, res) => {
    try {
      const idBox = requiredText(req.params.idBox, 50, 'idBox');
      const requestedLimit = req.query.limit === undefined ? 50 : Number(req.query.limit);
      if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || Array.isArray(req.query.limit)) {
        fail('limit harus berupa bilangan bulat positif');
      }
      const limit = Math.min(requestedLimit, 200);
      const [rows] = await pool.query(
        `SELECT e.id, e.id_box, e.session_id, e.slot, e.sid, e.ble_mac, e.event, e.created_at, u.nama
         FROM ble_events e
         LEFT JOIN users u ON u.sid = e.sid
         WHERE e.id_box = ?
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT ?`,
        [idBox, limit]
      );
      return res.status(200).json({ success: true, data: rows });
    } catch (error) {
      return errorResponse(res, error, 'Gagal mengambil riwayat BLE', 'getBleEvents');
    }
  },

  // Hapus riwayat BLE: satu baris (id) atau semua untuk boks terpilih.
  deleteBleEvents: async (req, res) => {
    try {
      const idBox = requiredText(req.params.idBox, 50, 'idBox');
      const id = req.params.id === undefined ? null : tagId(req.params.id);
      const [result] = id === null
        ? await pool.query('DELETE FROM ble_events WHERE id_box = ?', [idBox])
        : await pool.query('DELETE FROM ble_events WHERE id = ? AND id_box = ?', [id, idBox]);
      if (id !== null && result.affectedRows === 0) fail('Riwayat BLE tidak ditemukan', 404);
      return res.status(200).json({ success: true, message: 'Riwayat BLE dihapus', deleted: result.affectedRows });
    } catch (error) {
      return errorResponse(res, error, 'Gagal menghapus riwayat BLE', 'deleteBleEvents');
    }
  },

  deletePresenceHistory: async (req, res) => {
    try {
      const idBox = requiredText(req.params.idBox, 50, 'idBox');
      const id = req.params.id === undefined ? null : tagId(req.params.id);
      const [result] = id === null
        ? await pool.query('DELETE FROM ble_presence_log WHERE id_box = ?', [idBox])
        : await pool.query('DELETE FROM ble_presence_log WHERE id = ? AND id_box = ?', [id, idBox]);
      if (id !== null && result.affectedRows === 0) fail('Riwayat deteksi BLE tidak ditemukan', 404);
      return res.status(200).json({ success: true, message: 'Riwayat deteksi BLE dihapus', deleted: result.affectedRows });
    } catch (error) {
      return errorResponse(res, error, 'Gagal menghapus riwayat deteksi BLE', 'deletePresenceHistory');
    }
  },

  getPresenceHistory: async (req, res) => {
    try {
      const idBox = requiredText(req.params.idBox, 50, 'idBox');
      const requestedLimit = req.query.limit === undefined ? 100 : Number(req.query.limit);
      if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || Array.isArray(req.query.limit)) {
        fail('limit harus berupa bilangan bulat positif');
      }
      const limit = Math.min(requestedLimit, 200);
      const [rows] = await pool.query(
        `SELECT p.id, p.id_box, p.ble_mac, p.detected_at,
                bt.id AS tag_id, bt.tag_name, bt.assigned_sid,
                u.nama, u.role
         FROM ble_presence_log p
         LEFT JOIN ble_tags bt ON bt.mac_address = p.ble_mac AND bt.is_active = 1
         LEFT JOIN users u ON u.sid = bt.assigned_sid
         WHERE p.id_box = ?
         ORDER BY p.detected_at DESC, p.id DESC
         LIMIT ?`,
        [idBox, limit]
      );
      return res.status(200).json({ success: true, data: rows });
    } catch (error) {
      return errorResponse(res, error, 'Gagal mengambil riwayat deteksi BLE', 'getPresenceHistory');
    }
  }
};

export default lotoComplianceController;
