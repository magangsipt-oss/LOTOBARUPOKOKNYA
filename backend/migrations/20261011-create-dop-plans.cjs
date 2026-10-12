'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('dop_plans', {
      id: { type: Sequelize.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
      plan_date: { type: Sequelize.DATEONLY, allowNull: false },
      shift: { type: Sequelize.STRING(10), allowNull: false },
      payload: { type: Sequelize.JSON, allowNull: false },
      created_by: { type: Sequelize.STRING(50), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });
    await queryInterface.addIndex('dop_plans', ['plan_date', 'id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('dop_plans');
  }
};
