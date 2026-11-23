'use strict';

// Izin LOTO digital (formulir F-PLT-116). Satu izin per sesi box; izin manual tanpa box boleh banyak.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('loto_permits', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      id_box: { type: Sequelize.STRING(50), allowNull: true },
      session_id: { type: Sequelize.INTEGER, allowNull: true },
      permit_date: { type: Sequelize.DATEONLY, allowNull: false },
      status: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'DRAFT' },
      payload: { type: Sequelize.JSON, allowNull: false },
      created_by: { type: Sequelize.STRING(50), allowNull: false },
      updated_by: { type: Sequelize.STRING(50), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: true }
    });
    // MySQL mengizinkan banyak NULL pada indeks unik, jadi izin manual (tanpa box) tidak bentrok.
    await queryInterface.addIndex('loto_permits', ['id_box', 'session_id'], { unique: true });
    await queryInterface.addIndex('loto_permits', ['permit_date', 'id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('loto_permits');
  }
};
