'use strict';

// Daftar hadir sosialisasi digital (formulir F-HSE-105). Satu daftar per sesi box; daftar manual boleh banyak.
// Collation tabel disamakan dengan tabel boxes agar JOIN tidak gagal ("Illegal mix of collations").
module.exports = {
  async up(queryInterface, Sequelize) {
    const [[boxes]] = await queryInterface.sequelize.query(
      `SELECT t.TABLE_COLLATION AS collation_name, c.CHARACTER_SET_NAME AS charset_name
       FROM information_schema.TABLES t
       JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION
       WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_NAME = 'boxes'`);
    await queryInterface.createTable('briefing_attendance', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      id_box: { type: Sequelize.STRING(50), allowNull: true },
      session_id: { type: Sequelize.INTEGER, allowNull: true },
      briefing_date: { type: Sequelize.DATEONLY, allowNull: false },
      status: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'DRAFT' },
      payload: { type: Sequelize.JSON, allowNull: false },
      created_by: { type: Sequelize.STRING(50), allowNull: false },
      updated_by: { type: Sequelize.STRING(50), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: true }
    }, boxes ? { charset: boxes.charset_name, collate: boxes.collation_name } : {});
    await queryInterface.addIndex('briefing_attendance', ['id_box', 'session_id'], { unique: true });
    await queryInterface.addIndex('briefing_attendance', ['briefing_date', 'id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('briefing_attendance');
  }
};
