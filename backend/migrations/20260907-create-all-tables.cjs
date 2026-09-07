'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Users
    await queryInterface.createTable('users', {
      sid: { type: Sequelize.STRING(50), primaryKey: true, allowNull: false },
      nama: { type: Sequelize.STRING(100), allowNull: false },
      role: { type: Sequelize.STRING(50), allowNull: false },
      rfid_uid: { type: Sequelize.STRING(50), unique: true, allowNull: true },
      fp_id: { type: Sequelize.STRING(20), allowNull: true },
      password: { type: Sequelize.STRING(255), allowNull: false },
      foto: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });

    // Boxes
    await queryInterface.createTable('boxes', {
      id_box: { type: Sequelize.STRING(50), primaryKey: true, allowNull: false },
      unit: { type: Sequelize.STRING(100), allowNull: false },
      ip: { type: Sequelize.STRING(50), allowNull: false, defaultValue: '0.0.0.0' },
      rtsp_url: { type: Sequelize.STRING(255), allowNull: true },
      ssid: { type: Sequelize.STRING(100), allowNull: true },
      lat: { type: Sequelize.DECIMAL(10, 6), allowNull: false, defaultValue: 0 },
      lng: { type: Sequelize.DECIMAL(10, 6), allowNull: false, defaultValue: 0 },
      state: { type: Sequelize.STRING(50), allowNull: false, defaultValue: 'STATE_IDLE' },
      lcd0: { type: Sequelize.STRING(100), allowNull: false, defaultValue: '' },
      lcd1: { type: Sequelize.STRING(100), allowNull: false, defaultValue: '' },
      relay_open: { type: Sequelize.TINYINT, allowNull: false, defaultValue: 0 },
      supervisor_uid: { type: Sequelize.STRING(50), allowNull: false, defaultValue: '' },
      active_fuelman: { type: Sequelize.STRING(100), allowNull: true },
      last_event: { type: Sequelize.STRING(100), allowNull: false, defaultValue: 'HEARTBEAT_SYNC' },
      last_uid: { type: Sequelize.STRING(50), allowNull: false, defaultValue: 'SYSTEM' },
      uptime_ms: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      hw_data: { type: Sequelize.TEXT('long'), allowNull: true },
      is_online: { type: Sequelize.TINYINT, allowNull: false, defaultValue: 0 },
      last_ping: { type: Sequelize.DATE, allowNull: true },
      pending_cmd: { type: Sequelize.STRING(50), allowNull: true },
      cmd_param: { type: Sequelize.STRING(50), allowNull: true },
      device_token: { type: Sequelize.STRING(64), allowNull: true },
      updated_at: { type: Sequelize.DATE, allowNull: true }
    });

    // Tapping History
    await queryInterface.createTable('tapping_history', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      id_box: { type: Sequelize.STRING(100), allowNull: false },
      session_id: { type: Sequelize.INTEGER, allowNull: true },
      rfid_uid: { type: Sequelize.STRING(50), allowNull: true },
      nama: { type: Sequelize.STRING(255), allowNull: true },
      event_type: { type: Sequelize.ENUM('IN', 'OUT', 'CHECK'), allowNull: false },
      event_text: { type: Sequelize.STRING(255), allowNull: true },
      lat: { type: Sequelize.DOUBLE, allowNull: true },
      lng: { type: Sequelize.DOUBLE, allowNull: true },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });
    await queryInterface.addIndex('tapping_history', ['id_box']);
    await queryInterface.addIndex('tapping_history', ['rfid_uid']);
    await queryInterface.addIndex('tapping_history', ['session_id']);

    // Audit Logs
    await queryInterface.createTable('audit_logs', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      id_box: { type: Sequelize.STRING(50), allowNull: false },
      event: { type: Sequelize.STRING(100), allowNull: false },
      rfid_uid: { type: Sequelize.STRING(50), allowNull: false },
      lat: { type: Sequelize.DECIMAL(10, 6), allowNull: false, defaultValue: 0 },
      lng: { type: Sequelize.DECIMAL(10, 6), allowNull: false, defaultValue: 0 },
      tanggal: { type: Sequelize.DATE, allowNull: true }
    });
    await queryInterface.addIndex('audit_logs', ['id_box']);

    // People Counting
    await queryInterface.createTable('people_counting', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      id_box: { type: Sequelize.STRING(50), allowNull: false },
      session_id: { type: Sequelize.INTEGER, allowNull: true },
      detected_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      registered_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });
    await queryInterface.addIndex('people_counting', ['id_box']);
    await queryInterface.addIndex('people_counting', ['id_box', 'session_id'], { unique: true });

    // Queue
    await queryInterface.createTable('queue', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      id_box: { type: Sequelize.STRING(50), allowNull: false },
      session_id: { type: Sequelize.INTEGER, allowNull: true },
      rfid_uid: { type: Sequelize.STRING(50), allowNull: false },
      joined_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });
    await queryInterface.addIndex('queue', ['id_box']);
    await queryInterface.addIndex('queue', ['rfid_uid']);

    // RFID Buffer
    await queryInterface.createTable('rfid_buffer', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      id_box: { type: Sequelize.STRING(50), allowNull: true },
      rfid_uid: { type: Sequelize.STRING(50), allowNull: false },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });
    await queryInterface.addIndex('rfid_buffer', ['id_box']);

    // Maintenance Logs
    await queryInterface.createTable('maintenance_logs', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      waktu: { type: Sequelize.DATE, allowNull: false },
      id_box: { type: Sequelize.STRING(50), allowNull: false },
      mesin: { type: Sequelize.STRING(100), allowNull: true },
      jenis: { type: Sequelize.STRING(50), allowNull: false },
      estimasi: { type: Sequelize.STRING(50), allowNull: false },
      teknisi: { type: Sequelize.STRING(100), allowNull: false },
      pengawas: { type: Sequelize.STRING(100), allowNull: false },
      deskripsi: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false },
      foto: { type: Sequelize.TEXT, allowNull: true }
    });
    await queryInterface.addIndex('maintenance_logs', ['id_box']);

    // Refueling Logs
    await queryInterface.createTable('refueling_logs', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      id_box: { type: Sequelize.STRING(50), allowNull: false },
      fuelman_uid: { type: Sequelize.STRING(50), allowNull: false },
      fuelman_name: { type: Sequelize.STRING(100), allowNull: true },
      start_time: { type: Sequelize.DATE, allowNull: false },
      end_time: { type: Sequelize.DATE, allowNull: true },
      duration_seconds: { type: Sequelize.INTEGER, allowNull: true },
      latitude: { type: Sequelize.DECIMAL(10, 6), allowNull: true },
      longitude: { type: Sequelize.DECIMAL(10, 6), allowNull: true },
      is_loto_active: { type: Sequelize.TINYINT, allowNull: true }
    });
    await queryInterface.addIndex('refueling_logs', ['id_box']);

    // Supervisor Box Team
    await queryInterface.createTable('supervisor_box_team', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      supervisor_sid: { type: Sequelize.STRING(100), allowNull: false },
      id_box: { type: Sequelize.STRING(100), allowNull: false },
      mechanic_sid: { type: Sequelize.STRING(100), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false }
    });
    await queryInterface.addIndex('supervisor_box_team', ['supervisor_sid']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('supervisor_box_team');
    await queryInterface.dropTable('refueling_logs');
    await queryInterface.dropTable('maintenance_logs');
    await queryInterface.dropTable('rfid_buffer');
    await queryInterface.dropTable('queue');
    await queryInterface.dropTable('people_counting');
    await queryInterface.dropTable('audit_logs');
    await queryInterface.dropTable('tapping_history');
    await queryInterface.dropTable('boxes');
    await queryInterface.dropTable('users');
  }
};
