'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Draft DOP dibuat otomatis saat sesi maintenance LOTO dimulai di box, lalu dilengkapi pengawas.
    await queryInterface.addColumn('dop_plans', 'status', { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'FINAL' });
    await queryInterface.addColumn('dop_plans', 'id_box', { type: Sequelize.STRING(50), allowNull: true });
    await queryInterface.addColumn('dop_plans', 'session_id', { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('dop_plans', 'updated_at', { type: Sequelize.DATE, allowNull: true });
    // Satu draft per sesi box; DOP manual (id_box NULL) tidak terpengaruh.
    await queryInterface.addIndex('dop_plans', ['id_box', 'session_id'], { unique: true, name: 'dop_plans_box_session' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('dop_plans', 'dop_plans_box_session');
    for (const column of ['updated_at', 'session_id', 'id_box', 'status']) {
      await queryInterface.removeColumn('dop_plans', column);
    }
  }
};
