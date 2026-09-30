'use strict';

// Older backend builds wrote valid RFID tap events to audit_logs but did not
// mirror them to tapping_history. Restore only rows that are demonstrably
// missing; the exact audit timestamp makes this migration idempotent.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
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
    `);
  },
  async down() {
    throw new Error('Historical tapping repair is intentionally non-reversible.');
  }
};
