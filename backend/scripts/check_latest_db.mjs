import pool from 'file:///d:/KULIAH%201-8/FOLDER%20ELOTO/htdocs/PROJECT_ELOTO_NEW/backend/config/database.js';

try {
  console.log("=== LATEST DEVICE EVENTS ===");
  const [deviceEvents] = await pool.query("SELECT * FROM device_events ORDER BY received_at DESC LIMIT 10");
  console.log(JSON.stringify(deviceEvents, null, 2));

  console.log("\n=== LATEST AUDIT LOGS ===");
  const [auditLogs] = await pool.query("SELECT * FROM audit_logs ORDER BY tanggal DESC LIMIT 10");
  console.log(JSON.stringify(auditLogs, null, 2));

  console.log("\n=== LATEST TAPPING HISTORY ===");
  const [tappingHistory] = await pool.query("SELECT * FROM tapping_history ORDER BY created_at DESC LIMIT 10");
  console.log(JSON.stringify(tappingHistory, null, 2));

  console.log("\n=== BOX STATUS ===");
  const [boxes] = await pool.query("SELECT id_box, state, active_session_id, session_counter FROM boxes WHERE id_box = 'BOX-CLIENT-001'");
  console.log(JSON.stringify(boxes, null, 2));

} catch (e) {
  console.error(e);
} finally {
  await pool.end();
}
