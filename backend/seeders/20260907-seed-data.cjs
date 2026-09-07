'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== '1') throw new Error('Demo seeding is disabled');
    const password = process.env.DEMO_PASSWORD;
    if (!password || password.length < 12 || Buffer.byteLength(password) > 72) throw new Error('Set a strong DEMO_PASSWORD');
    const hash = await require('bcryptjs').hash(password, 12);
    const now = new Date();

    // Users
    await queryInterface.bulkInsert('users', [
      { sid: 'Admin', nama: 'Master Administrator', role: 'ADMIN', rfid_uid: '0000', password: hash, foto: null, created_at: now },
      { sid: 'SPV001', nama: 'Budi Santoso', role: 'PENGAWAS', rfid_uid: '9D88FA1200', password: hash, foto: null, created_at: now },
      { sid: 'SPV002', nama: 'Eltha Putri', role: 'PENGAWAS', rfid_uid: '3C001E9494', password: hash, foto: null, created_at: now },
      { sid: 'MEK001', nama: 'Agus Prayitno', role: 'WORKER', rfid_uid: '1A2B3C4D5E', password: hash, foto: null, created_at: now },
      { sid: 'MEK002', nama: 'Rahmat Hidayat', role: 'WORKER', rfid_uid: 'F4E5D6C7B8', password: hash, foto: null, created_at: now },
      { sid: 'MEK003', nama: 'Joko Widodo', role: 'WORKER', rfid_uid: 'A1B2C3D4E5', password: hash, foto: null, created_at: now },
      { sid: 'MEK004', nama: 'Andi Saputra', role: 'WORKER', rfid_uid: '3E0028F54F', password: hash, foto: null, created_at: now },
      { sid: 'MEK005', nama: 'Rizki Pratama', role: 'WORKER', rfid_uid: '3D001266BB', password: hash, foto: null, created_at: now },
      { sid: 'FUL001', nama: 'Dedi Kurniawan', role: 'FUELMAN', rfid_uid: '3C00035095', password: hash, foto: null, created_at: now },
      { sid: 'FUL002', nama: 'Hendra Wijaya', role: 'FUELMAN', rfid_uid: '3E0027D5B2', password: hash, foto: null, created_at: now }
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
