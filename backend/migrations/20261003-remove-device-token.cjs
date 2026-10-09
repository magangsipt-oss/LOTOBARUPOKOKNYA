'use strict';

module.exports = {
  async up(queryInterface) {
    const columns = await queryInterface.describeTable('boxes');
    if (columns.device_token) await queryInterface.removeColumn('boxes', 'device_token');
  },

  async down() {
    throw new Error('Device token removal is irreversible; restore from a reviewed backup only if required.');
  }
};