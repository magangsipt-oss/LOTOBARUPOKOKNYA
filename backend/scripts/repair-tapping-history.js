import pool from '../config/database.js';

// Safe to run repeatedly.  Some earlier backend versions saved valid RFID
// events only in audit_logs, so mirror only the entries that are still absent
// from the history consumed by the web UI.
const repairQuery = `
  INSERT INTO tapping_history
    (id_box, session_id, rfid_uid, nama, event_type, event_text, lat, lng, created_at)
  SELECT
    a.id_box,
    NULL,
    a.rfid_uid,
    u.nama,
    CASE
      WHEN a.event IN ('SUPERVISOR_LOCK_IN', 'SUPERVISOR_EXTRA_LOCK_IN', 'MECHANIC_LOG_IN', 'REFUEL_START') THEN 'IN'
      ELSE 'OUT'
    END,
    a.event,
    a.lat,
    a.lng,
    a.tanggal
  FROM audit_logs a
  LEFT JOIN users u ON u.rfid_uid = a.rfid_uid OR u.sid = a.rfid_uid
  WHERE a.event IN (
    'SUPERVISOR_LOCK_IN', 'SUPERVISOR_EXTRA_LOCK_IN', 'MECHANIC_LOG_IN', 'REFUEL_START',
    'SUPERVISOR_LOG_OUT', 'SUPERVISOR_EXTRA_LOG_OUT', 'MECHANIC_LOG_OUT', 'REFUEL_END'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM tapping_history t
    WHERE t.id_box = a.id_box
      AND t.rfid_uid = a.rfid_uid
      AND t.event_text = a.event
      AND t.created_at = a.tanggal
  )
`;

try {
  const [result] = await pool.query(repairQuery);
  console.log(`Tapping-history repair complete: ${result.affectedRows} row(s) restored.`);
} catch (error) {
  console.error('Tapping-history repair failed:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
