'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Nomor BLE mengikuti urutan tap; iTag diikat ke personel saat tap di box.
    await queryInterface.addColumn('loto_compliance', 'session_id', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('loto_compliance', 'slots', { type: Sequelize.TEXT, allowNull: true, comment: 'JSON nomor BLE per personel dari box' });
    await queryInterface.addColumn('loto_compliance', 'unknown_tags', { type: Sequelize.TEXT, allowNull: true, comment: 'JSON MAC iTag yang tidak terikat ke tap' });
    await queryInterface.addColumn('loto_compliance', 'unknown_tag_count', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await queryInterface.addColumn('loto_compliance', 'unidentified_count', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });

    // Riwayat perubahan BLE (diikat, terdeteksi, hilang, iTag tanpa tap).
    await queryInterface.createTable('ble_events', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      id_box: { type: Sequelize.STRING(50), allowNull: false },
      session_id: { type: Sequelize.INTEGER, allowNull: true },
      slot: { type: Sequelize.INTEGER, allowNull: true, comment: 'Nomor BLE (urutan tap)' },
      sid: { type: Sequelize.STRING(50), allowNull: true },
      ble_mac: { type: Sequelize.STRING(17), allowNull: true },
      event: { type: Sequelize.STRING(30), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });
    await queryInterface.addIndex('ble_events', ['id_box', 'created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ble_events');
    for (const column of ['unidentified_count', 'unknown_tag_count', 'unknown_tags', 'slots', 'session_id']) {
      await queryInterface.removeColumn('loto_compliance', column);
    }
  }
};
