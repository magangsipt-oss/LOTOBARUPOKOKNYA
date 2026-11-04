import pool from '../config/database.js';
import { normalizeState, eventType, isTap, replayOccurredAt } from '../domain/telemetry.js';
import { syncSessionDraft } from './dopPlanModel.js';

// Tap masuk BBM ganda dalam jeda ini dihitung satu kali (box baru juga menolak tap keluar secepat ini).
export const REFUEL_DOUBLE_TAP_SECONDS = 60;

async function fuelmanName(c, uid) {
  const [rows] = await c.query('SELECT nama FROM users WHERE rfid_uid = ? OR sid = ? LIMIT 1', [uid, uid]);
  return rows[0]?.nama || null;
}

// Tap BBM langsung: masuk membuka satu baris, keluar menutup baris milik kartu yang sama.
async function recordLiveRefuel(c, { idBox, event, uid, lat, lng, session }) {
  if (event === 'REFUEL_START') {
    const [open] = await c.query(
      `SELECT id, TIMESTAMPDIFF(SECOND, start_time, NOW()) AS age_seconds FROM refueling_logs
       WHERE id_box = ? AND fuelman_uid = ? AND end_time IS NULL ORDER BY start_time DESC, id DESC LIMIT 1`, [idBox, uid]);
    if (open.length && Number(open[0].age_seconds) < REFUEL_DOUBLE_TAP_SECONDS) return;
    // Box hanya mengirim tap masuk bila kartu ini tidak sedang mengisi; baris yang masih terbuka
    // adalah sisa (mis. tap keluar hilang) dan ditutup dulu agar tidak dobel.
    if (open.length) {
      await c.query(
        `UPDATE refueling_logs SET end_time = NOW(), duration_seconds = TIMESTAMPDIFF(SECOND, start_time, NOW())
         WHERE id_box = ? AND fuelman_uid = ? AND end_time IS NULL`, [idBox, uid]);
    }
    await c.query(
      `INSERT INTO refueling_logs (id_box, fuelman_uid, fuelman_name, start_time, latitude, longitude, is_loto_active)
       VALUES (?, ?, ?, NOW(), ?, ?, ?)`,
      [idBox, uid, await fuelmanName(c, uid), lat, lng, session ? 1 : 0]);
    await c.query('UPDATE boxes SET active_fuelman = ? WHERE id_box = ?', [uid, idBox]);
    return;
  }
  const [open] = await c.query(
    `SELECT id FROM refueling_logs WHERE id_box = ? AND fuelman_uid = ? AND end_time IS NULL
     ORDER BY start_time DESC, id DESC LIMIT 1`, [idBox, uid]);
  if (open.length) {
    await c.query(
      `UPDATE refueling_logs SET end_time = NOW(), duration_seconds = TIMESTAMPDIFF(SECOND, start_time, NOW())
       WHERE id = ?`, [open[0].id]);
  }
  await c.query('UPDATE boxes SET active_fuelman = \'\', last_event = ? WHERE id_box = ?', [event, idBox]);
}

// Tap BBM offline yang dikirim ulang. Hanya dari firmware yang memasangkan masuk/keluar dan hanya
// dengan waktu tap asli, supaya baris ditempatkan tepat dan pengisian yang sedang berjalan aman.
async function recordReplayRefuel(c, { idBox, event, uid, lat, lng, occurredAt }) {
  if (occurredAt == null) return;
  if (event === 'REFUEL_START') {
    const [open] = await c.query(
      `SELECT id, UNIX_TIMESTAMP(start_time) AS start_epoch FROM refueling_logs
       WHERE id_box = ? AND fuelman_uid = ? AND end_time IS NULL AND start_time <= FROM_UNIXTIME(?)
       ORDER BY start_time DESC, id DESC LIMIT 1`, [idBox, uid, occurredAt]);
    if (open.length && occurredAt - Number(open[0].start_epoch) < REFUEL_DOUBLE_TAP_SECONDS) return;
    if (open.length) {
      await c.query(
        `UPDATE refueling_logs SET end_time = FROM_UNIXTIME(?), duration_seconds = TIMESTAMPDIFF(SECOND, start_time, FROM_UNIXTIME(?))
         WHERE id_box = ? AND fuelman_uid = ? AND end_time IS NULL AND start_time <= FROM_UNIXTIME(?)`,
        [occurredAt, occurredAt, idBox, uid, occurredAt]);
    }
    // Tap keluar yang lebih dulu sampai secara live menjadi akhir pengisian ini.
    const [next] = await c.query(
      `SELECT event_text, UNIX_TIMESTAMP(created_at) AS at_epoch FROM tapping_history
       WHERE id_box = ? AND rfid_uid = ? AND event_text IN ('REFUEL_START', 'REFUEL_END') AND created_at > FROM_UNIXTIME(?)
       ORDER BY created_at, id LIMIT 1`, [idBox, uid, occurredAt]);
    const endEpoch = next[0]?.event_text === 'REFUEL_END' ? Number(next[0].at_epoch) : null;
    await c.query(
      `INSERT INTO refueling_logs (id_box, fuelman_uid, fuelman_name, start_time, end_time, duration_seconds, latitude, longitude, is_loto_active)
       VALUES (?, ?, ?, FROM_UNIXTIME(?), FROM_UNIXTIME(?), ?, ?, ?, NULL)`,
      [idBox, uid, await fuelmanName(c, uid), occurredAt, endEpoch, endEpoch == null ? null : endEpoch - occurredAt, lat, lng]);
    return;
  }
  // Tap keluar asli mengakhiri pengisian yang mencakup waktunya, termasuk yang sempat ditutup
  // otomatis lebih lambat (mis. oleh penutupan sesi LOTO sebelum replay ini sampai).
  const [rows] = await c.query(
    `SELECT id FROM refueling_logs WHERE id_box = ? AND fuelman_uid = ? AND start_time <= FROM_UNIXTIME(?)
     AND (end_time IS NULL OR end_time > FROM_UNIXTIME(?)) ORDER BY start_time DESC, id DESC LIMIT 1`,
    [idBox, uid, occurredAt, occurredAt]);
  if (rows.length) {
    await c.query(
      `UPDATE refueling_logs SET end_time = FROM_UNIXTIME(?), duration_seconds = TIMESTAMPDIFF(SECOND, start_time, FROM_UNIXTIME(?))
       WHERE id = ?`, [occurredAt, occurredAt, rows[0].id]);
  }
}

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
    // The ESP32 emits upper-case event names, but normalize here as well so an
    // older firmware or manual retry cannot silently skip tapping_history.
    const event = String(body.event || 'HEARTBEAT_SYNC').trim().toUpperCase();
    const uid = body.uid || 'SYSTEM';
    let session = box.active_session_id;
    // Replayed records retain their event identity and never replace current hardware state.
    // A repeated supervisor tap while a session is open belongs to that session.
    if (event === 'SUPERVISOR_LOCK_IN' && !body.replay && session == null) {
      session = Number(box.session_counter) + 1;
      await c.query('UPDATE boxes SET session_counter = ?, active_session_id = ? WHERE id_box = ?', [session, session, idBox]);
    }
    const lat = body.gps_fix ? body.lat ?? null : null;
    const lng = body.gps_fix ? body.lng ?? null : null;
    if (!body.replay) {
      const state = body.state ? normalizeState(body.state) : box.state;
      const snapshot = {
        state,
        queue: body.queue || [],
        gps_fix: Boolean(body.gps_fix),
        sd_card_ok: body.sd_card_ok == null ? null : Boolean(body.sd_card_ok),
        sd_sync_ok: body.sd_sync_ok == null ? null : Boolean(body.sd_sync_ok),
        sd_user_count: body.sd_user_count ?? null,
        ble_scan_ok: body.ble_scan_ok == null ? null : Boolean(body.ble_scan_ok),
        ble_tag_count: body.ble_tag_count ?? null,
        mechanics_tapped: body.mechanics_tapped ?? null,
        session_active: body.session_active == null ? undefined : Boolean(body.session_active),
        session_elapsed_ms: body.session_elapsed_ms ?? undefined,
        supervisor_uid: body.supervisor_uid ?? box.supervisor_uid,
        active_fuelman: body.active_fuelman ?? box.active_fuelman
      };
      await c.query(`UPDATE boxes SET state = ?, last_event = IF(? = 'HEARTBEAT_SYNC', last_event, ?),
        last_uid = IF(? = 'HEARTBEAT_SYNC', last_uid, ?), lat = COALESCE(?, lat), lng = COALESCE(?, lng),
        lcd0 = ?, lcd1 = ?, relay_open = ?, uptime_ms = ?, hw_data = ?, is_online = 1, ssid = ?, ip = ?,
        supervisor_uid = ?, active_fuelman = ?, last_ping = NOW(), updated_at = NOW() WHERE id_box = ?`,
      [state, event, event, event, uid, lat, lng, body.lcd0 ?? box.lcd0, body.lcd1 ?? box.lcd1, body.relay_open == null ? box.relay_open : Number(Boolean(body.relay_open)),
        body.uptime_ms ?? box.uptime_ms, JSON.stringify(snapshot), body.ssid ?? box.ssid, body.ip ?? box.ip, snapshot.supervisor_uid, snapshot.active_fuelman, idBox]);
      if (body.queue) {
        await c.query('DELETE FROM queue WHERE id_box = ?', [idBox]);
        for (const worker of body.queue) await c.query('INSERT INTO queue (id_box, session_id, rfid_uid) VALUES (?, ?, ?)', [idBox, session, worker.uid]);
        if (session != null) {
          // Draft DOP otomatis tidak boleh menggagalkan telemetri box (mis. migrasi belum dijalankan).
          await c.query('SAVEPOINT dop_draft');
          try { await syncSessionDraft(c, { idBox, session, unit: box.unit }); }
          catch (error) {
            await c.query('ROLLBACK TO SAVEPOINT dop_draft');
            console.error('DOP draft sync failed:', error.code || error.message);
          }
        }
      }
    }
    // Replay offline memakai waktu tap asli dari box; selain itu tetap waktu terima server.
    const occurredAt = replayOccurredAt(body);
    if (event !== 'HEARTBEAT_SYNC') await c.query('INSERT INTO audit_logs (id_box, event, rfid_uid, lat, lng, tanggal) VALUES (?, ?, ?, ?, ?, COALESCE(FROM_UNIXTIME(?), NOW()))', [idBox, event, uid, lat ?? 0, lng ?? 0, occurredAt]);
    if (isTap(event)) {
      // Offline events with no trustworthy session remain explicitly unassigned.
      const [users] = await c.query('SELECT nama FROM users WHERE rfid_uid = ? OR sid = ? LIMIT 1', [uid, uid]);
      await c.query(`INSERT INTO tapping_history (id_box, session_id, rfid_uid, nama, event_type, event_text, lat, lng, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(FROM_UNIXTIME(?), NOW()))`, [idBox, body.replay ? null : session, uid, users[0]?.nama || null, eventType(event), event, lat, lng, occurredAt]);
    }
    // Only scans explicitly made in the card-registration screen enter this queue.
    if (event === 'REGISTER_NEW_CARD') {
      const [buffer] = await c.query('SELECT id FROM rfid_buffer WHERE id_box = ? AND rfid_uid = ? LIMIT 1', [idBox, uid]);
      if (!buffer.length) await c.query('INSERT INTO rfid_buffer (id_box, rfid_uid) VALUES (?, ?)', [idBox, uid]);
    }
    // ===== REFUELING: tap masuk (REFUEL_START) / tap keluar (REFUEL_END) per kartu petugas BBM =====
    if (event === 'REFUEL_START' || event === 'REFUEL_END') {
      if (!body.replay) await recordLiveRefuel(c, { idBox, event, uid, lat, lng, session });
      else if (body.refuel_toggle === true) await recordReplayRefuel(c, { idBox, event, uid, lat, lng, occurredAt });
    }
    if (!body.replay && ['SUPERVISOR_LOG_OUT', 'SESSION_CLOSED_NORMAL'].includes(event)) {
      await c.query('UPDATE boxes SET active_session_id = NULL WHERE id_box = ?', [idBox]);
      // Firmware lama menutup pengisian BBM bersama sesi LOTO. Firmware baru tetap melaporkan petugas
      // BBM yang belum tap keluar (active_fuelman); pengisian miliknya dibiarkan berjalan.
      const stillRefueling = typeof body.active_fuelman === 'string' ? body.active_fuelman.trim() : '';
      await c.query(
        `UPDATE refueling_logs SET end_time = NOW(),
         duration_seconds = TIMESTAMPDIFF(SECOND, start_time, NOW())
         WHERE id_box = ? AND end_time IS NULL AND fuelman_uid <> ?`, [idBox, stillRefueling]);
      await c.query('UPDATE boxes SET active_fuelman = ?, last_event = ? WHERE id_box = ?', [stillRefueling, event, idBox]);
    }
    await c.commit();
    return { duplicate: false, session_id: session };
  } catch (error) { await c.rollback(); throw error; }
  finally { c.release(); }
}
