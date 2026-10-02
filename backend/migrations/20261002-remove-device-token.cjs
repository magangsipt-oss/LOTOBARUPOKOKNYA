'use strict';

module.exports = {
  async up(queryInterface) {
    // Device identity now comes from the IP registered for each box.
    // Removing this column intentionally deletes the obsolete credential hashes.
    const columns = await queryInterface.describeTable('boxes');
    if (columns.device_token) await queryInterface.removeColumn('boxes', 'device_token');
  },

  async down(queryInterface, Sequelize) {
    // The old hashes are intentionally not recoverable after removal.
    const columns = await queryInterface.describeTable('boxes');
    if (!columns.device_token) {
      await queryInterface.addColumn('boxes', 'device_token', {
        type: Sequelize.STRING(64),
        allowNull: true
      });
    }
  }
};
