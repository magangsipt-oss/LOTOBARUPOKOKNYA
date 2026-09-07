'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    // Users
    await queryInterface.bulkInsert('users', [
      { sid: 'Admin', nama: 'Master Administrator', role: 'ADMIN', rfid_uid: '0000', password: 'Admin', foto: null, created_at: now },
      { sid: 'SPV001', nama: 'Budi Santoso', role: 'PENGAWAS', rfid_uid: '9D88FA1200', password: 'SPV001', foto: null, created_at: now },
      { sid: 'SPV002', nama: 'Eltha Putri', role: 'PENGAWAS', rfid_uid: '3C001E9494', password: 'SPV002', foto: null, created_at: now },
      { sid: 'MEK001', nama: 'Agus Prayitno', role: 'WORKER', rfid_uid: '1A2B3C4D5E', password: 'MEK001', foto: null, created_at: now },
      { sid: 'MEK002', nama: 'Rahmat Hidayat', role: 'WORKER', rfid_uid: 'F4E5D6C7B8', password: 'MEK002', foto: null, created_at: now },
      { sid: 'MEK003', nama: 'Joko Widodo', role: 'WORKER', rfid_uid: 'A1B2C3D4E5', password: 'MEK003', foto: null, created_at: now },
      { sid: 'MEK004', nama: 'Andi Saputra', role: 'WORKER', rfid_uid: '3E0028F54F', password: 'MEK004', foto: null, created_at: now },
      { sid: 'MEK005', nama: 'Rizki Pratama', role: 'WORKER', rfid_uid: '3D001266BB', password: 'MEK005', foto: null, created_at: now },
      { sid: 'FUL001', nama: 'Dedi Kurniawan', role: 'FUELMAN', rfid_uid: '3C00035095', password: 'FUL001', foto: null, created_at: now },
      { sid: 'FUL002', nama: 'Hendra Wijaya', role: 'FUELMAN', rfid_uid: '3E0027D5B2', password: 'FUL002', foto: null, created_at: now }
    ]);

    // Boxes
    await queryInterface.bulkInsert('boxes', [
      { id_box: 'BOX ELOTO 1', unit: 'Unit Excavator CAT 320', ip: '192.168.1.131', state: 'STATE_IDLE', lat: 2.144691, lng: 117.477526, lcd0: 'SISTEM READY', lcd1: 'TEKAN 1 UTK MULAI', relay_open: 0, supervisor_uid: '', last_event: 'HEARTBEAT_SYNC', last_uid: 'SYSTEM', uptime_ms: 0, is_online: 0 },
      { id_box: 'BOX ELOTO 2', unit: 'Unit Dozer D6T', ip: '192.168.1.132', state: 'STATE_WAIT_SPV_IN', lat: 2.145100, lng: 117.478000, lcd0: 'TUNGGU SPV', lcd1: 'TAP KARTU PENGAWAS', relay_open: 0, supervisor_uid: '', last_event: 'SUPERVISOR_LOCK_IN', last_uid: 'SYSTEM', uptime_ms: 0, is_online: 0 }
    ]);

    // Tapping History
    await queryInterface.bulkInsert('tapping_history', [
      { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: '9D88FA1200', nama: 'Budi Santoso', event_type: 'IN', event_text: 'SUPERVISOR_LOCK_IN', lat: 2.144691, lng: 117.477526, created_at: new Date(now - 3600000) },
      { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: '1A2B3C4D5E', nama: 'Agus Prayitno', event_type: 'IN', event_text: 'MECHANIC_LOG_IN', lat: 2.144691, lng: 117.477526, created_at: new Date(now - 3300000) },
      { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: 'F4E5D6C7B8', nama: 'Rahmat Hidayat', event_type: 'IN', event_text: 'MECHANIC_LOG_IN', lat: 2.144691, lng: 117.477526, created_at: new Date(now - 3000000) },
      { id_box: 'BOX ELOTO 1', session_id: 1, rfid_uid: 'A1B2C3D4E5', nama: 'Joko Widodo', event_type: 'IN', event_text: 'MECHANIC_LOG_IN', lat: 2.144691, lng: 117.477526, created_at: new Date(now - 2700000) },
      { id_box: 'BOX ELOTO 2', session_id: 1, rfid_uid: '3C001E9494', nama: 'Eltha Putri', event_type: 'IN', event_text: 'SUPERVISOR_LOCK_IN', lat: 2.145100, lng: 117.478000, created_at: new Date(now - 1800000) },
      { id_box: 'BOX ELOTO 2', session_id: 1, rfid_uid: '3E0028F54F', nama: 'Andi Saputra', event_type: 'IN', event_text: 'MECHANIC_LOG_IN', lat: 2.145100, lng: 117.478000, created_at: new Date(now - 1500000) }
    ]);

    // People Counting
    await queryInterface.bulkInsert('people_counting', [
      { id_box: 'BOX ELOTO 1', session_id: 1, detected_count: 4, registered_count: 4, created_at: new Date(now - 300000) },
      { id_box: 'BOX ELOTO 1', session_id: 1, detected_count: 5, registered_count: 4, created_at: new Date(now - 240000) },
      { id_box: 'BOX ELOTO 1', session_id: 1, detected_count: 4, registered_count: 4, created_at: new Date(now - 180000) },
      { id_box: 'BOX ELOTO 1', session_id: 1, detected_count: 3, registered_count: 4, created_at: new Date(now - 120000) },
      { id_box: 'BOX ELOTO 1', session_id: 1, detected_count: 4, registered_count: 4, created_at: new Date(now - 60000) },
      { id_box: 'BOX ELOTO 2', session_id: 1, detected_count: 2, registered_count: 2, created_at: new Date(now - 180000) },
      { id_box: 'BOX ELOTO 2', session_id: 1, detected_count: 2, registered_count: 2, created_at: new Date(now - 60000) }
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('people_counting', null, {});
    await queryInterface.bulkDelete('tapping_history', null, {});
    await queryInterface.bulkDelete('boxes', null, {});
    await queryInterface.bulkDelete('users', null, {});
  }
};
