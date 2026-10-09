'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. BLE Tag registry
    await queryInterface.createTable('ble_tags', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      mac_address: { type: Sequelize.STRING(17), allowNull: false, unique: true, comment: 'BLE MAC address AA:BB:CC:DD:EE:FF' },
      tag_name: { type: Sequelize.STRING(100), allowNull: true },
      assigned_sid: { type: Sequelize.STRING(50), allowNull: true, comment: 'references users.sid' },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ble_tags', ['mac_address'], { unique: true });
    await queryInterface.addIndex('ble_tags', ['assigned_sid']);

    // 2. BLE Presence log (who was detected when)
    await queryInterface.createTable('ble_presence_log', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      id_box: { type: Sequelize.STRING(50), allowNull: false },
      ble_mac: { type: Sequelize.STRING(17), allowNull: false },
      detected_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('ble_presence_log', ['id_box', 'detected_at']);

    // 3. LOTO Compliance snapshots
    await queryInterface.createTable('loto_compliance', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      id_box: { type: Sequelize.STRING(50), allowNull: false },
      ble_detected_count: { type: Sequelize.INTEGER, defaultValue: 0 },
      loto_tapped_count: { type: Sequelize.INTEGER, defaultValue: 0 },
      missing_count: { type: Sequelize.INTEGER, defaultValue: 0 },
      detected_sids: { type: Sequelize.TEXT, comment: 'JSON array of SIDs detected via BLE' },
      tapped_sids: { type: Sequelize.TEXT, comment: 'JSON array of SIDs who tapped LOTO' },
      missing_sids: { type: Sequelize.TEXT, comment: 'JSON array of SIDs present but not tapped' },
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('loto_compliance', ['id_box', 'created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('loto_compliance');
    await queryInterface.dropTable('ble_presence_log');
    await queryInterface.dropTable('ble_tags');
  }
};
