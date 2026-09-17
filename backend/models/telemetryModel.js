import pool from '../config/database.js';
import { normalizeState, eventType, isTap } from '../domain/telemetry.js';

export async function recordTelemetry(idBox, body) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await c.query('SELECT * FROM boxes WHERE id_box = ? FOR UPDATE', [idBox]);
    if (!rows.length) throw Object.assign(new Error('Box not found'), { status: 404 });
    const box = rows[0];
    const [seen] = await c.query('SELECT event_id FROM device_events WHERE id_box = ? AND event_id = ?', [idBox, body.event_id]);
    if (seen.length) { await c.commit(); return { duplicate: true }; }
    await c.query('INSERT INTO device_events (id_box, event_id) VALUES (?, ?)', [idBox, body.event_id]);
    const event = body.event || 'HEARTBEAT_SYNC';
    const uid = body.uid || 'SYSTEM';
    let session = box.active_session_id;
    // Replayed records retain their event identity and never replace current hardware state.
    // Always create a fresh session on SUPERVISOR_LOCK_IN so the timer starts correctly.
    if (event === 'SUPERVISOR_LOCK_IN' && !body.replay) {
      session = Number(box.session_counter) + 1;
      await c.query('UPDATE boxes SET session_counter = ?, active_session_id = ? WHERE id_box = ?', [session, session, idBox]);
    }
    const lat = body.gps_fix ? body.lat ?? null : null;
    const lng = body.gps_fix ? body.lng ?? null : null;
    if (!body.replay) {
      const state = body.state ? normalizeState(body.state) : box.state;
      const snapshot = { state, queue: body.queue || [], gps_fix: Boolean(body.gps_fix), supervisor_uid: body.supervisor_uid ?? box.supervisor_uid, active_fuelman: body.active_fuelman ?? box.active_fuelman };
      await c.query(`UPDATE boxes SET state = ?, last_event = ?, last_uid = ?, lat = COALESCE(?, lat), lng = COALESCE(?, lng),
        lcd0 = ?, lcd1 = ?, relay_open = ?, uptime_ms = ?, hw_data = ?, is_online = 1, ssid = ?, ip = ?,
        supervisor_uid = ?, active_fuelman = ?, last_ping = NOW(), updated_at = NOW() WHERE id_box = ?`,
      [state, event, uid, lat, lng, body.lcd0 ?? box.lcd0, body.lcd1 ?? box.lcd1, body.relay_open == null ? box.relay_open : Number(Boolean(body.relay_open)),
        body.uptime_ms ?? box.uptime_ms, JSON.stringify(snapshot), body.ssid ?? box.ssid, body.ip ?? box.ip, snapshot.supervisor_uid, snapshot.active_fuelman, idBox]);
      if (body.queue) {
        await c.query('DELETE FROM queue WHERE id_box = ?', [idBox]);
        for (const worker of body.queue) await c.query('INSERT INTO queue (id_box, session_id, rfid_uid) VALUES (?, ?, ?)', [idBox, session, worker.uid]);
      }
    }
    if (event !== 'HEARTBEAT_SYNC') await c.query('INSERT INTO audit_logs (id_box, event, rfid_uid, lat, lng, tanggal) VALUES (?, ?, ?, ?, ?, NOW())', [idBox, event, uid, lat ?? 0, lng ?? 0]);
    if (isTap(event)) {
      // Offline events with no trustworthy session remain explicitly unassigned.
      const [users] = await c.query('SELECT nama FROM users WHERE rfid_uid = ? OR sid = ? LIMIT 1', [uid, uid]);
      await c.query(`INSERT INTO tapping_history (id_box, session_id, rfid_uid, nama, event_type, event_text, lat, lng, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`, [idBox, body.replay ? null : session, uid, users[0]?.nama || null, eventType(event), event, lat, lng]);
    }
    if (event === 'REGISTER_NEW_CARD') {
      const [buffer] = await c.query('SELECT id FROM rfid_buffer WHERE id_box = ? AND rfid_uid = ? LIMIT 1', [idBox, uid]);
      if (!buffer.length) await c.query('INSERT INTO rfid_buffer (id_box, rfid_uid) VALUES (?, ?)', [idBox, uid]);
    }
    // ===== REFUELING: Auto-create & end refueling_logs =====
    if (!body.replay && event === 'REFUEL_START') {
      const [fuelUser] = await c.query('SELECT nama FROM users WHERE rfid_uid = ? OR sid = ? LIMIT 1', [uid, uid]);
      const fuelName = fuelUser[0]?.nama || null;
      const [refResult] = await c.query(
        `INSERT INTO refueling_logs (id_box, fuelman_uid, fuelman_name, start_time, latitude, longitude, is_loto_active)
         VALUES (?, ?, ?, NOW(), ?, ?, ?)`,
        [idBox, uid, fuelName, lat, lng, session ? 1 : 0]
      );
      // Store refueling_log_id in active_fuelman so we can end it later
      await c.query('UPDATE boxes SET active_fuelman = ? WHERE id_box = ?',
        [`${uid}|${refResult.insertId}`, idBox]);
    }
    if (!body.replay && event === 'REFUEL_END') {
      // Find active refueling session for this box and end it
      const [activeRefuel] = await c.query(
        'SELECT id FROM refueling_logs WHERE id_box = ? AND end_time IS NULL ORDER BY id DESC LIMIT 1', [idBox]);
      if (activeRefuel.length) {
        await c.query(
          `UPDATE refueling_logs SET end_time = NOW(),
           duration_seconds = TIMESTAMPDIFF(SECOND, start_time, NOW())
           WHERE id = ?`, [activeRefuel[0].id]);
      }
      // Clear active_fuelman
      await c.query('UPDATE boxes SET active_fuelman = \'\', last_event = ? WHERE id_box = ?', [event, idBox]);
    }
    if (!body.replay && ['SUPERVISOR_LOG_OUT', 'SESSION_CLOSED_NORMAL'].includes(event)) {
      await c.query('UPDATE boxes SET active_session_id = NULL WHERE id_box = ?', [idBox]);
      // End any active refueling session when LOTO session closes
      await c.query(
        `UPDATE refueling_logs SET end_time = NOW(),
         duration_seconds = TIMESTAMPDIFF(SECOND, start_time, NOW())
         WHERE id_box = ? AND end_time IS NULL`, [idBox]);
      await c.query('UPDATE boxes SET active_fuelman = \'\', last_event = ? WHERE id_box = ?', [event, idBox]);
    }
    await c.commit();
    return { duplicate: false, session_id: session };
  } catch (error) { await c.rollback(); throw error; }
  finally { c.release(); }
}
