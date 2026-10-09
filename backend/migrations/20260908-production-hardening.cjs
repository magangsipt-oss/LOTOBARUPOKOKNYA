'use strict';
module.exports = {
  async up(q, S) {
    await q.createTable('web_sessions', {
      token_hash: { type: S.STRING(64), primaryKey: true },
      sid: { type: S.STRING(50), allowNull: false },
      expires_at: { type: S.DATE, allowNull: false }
    });
    await q.addIndex('web_sessions', ['sid']);
    await q.addIndex('web_sessions', ['expires_at']);
    await q.createTable('device_commands', {
      id: { type: S.STRING(36), primaryKey: true },
      id_box: { type: S.STRING(50), allowNull: false },
      command: { type: S.STRING(50), allowNull: false },
      parameter: { type: S.STRING(255), allowNull: false, defaultValue: '' },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal('CURRENT_TIMESTAMP') },
      acknowledged_at: { type: S.DATE, allowNull: true }
    });
    await q.addIndex('device_commands', ['id_box', 'acknowledged_at', 'created_at']);
    await q.createTable('device_events', {
      id_box: { type: S.STRING(50), primaryKey: true },
      event_id: { type: S.STRING(100), primaryKey: true },
      received_at: { type: S.DATE, defaultValue: S.literal('CURRENT_TIMESTAMP') }
    });
    await q.addColumn('boxes', 'session_counter', { type: S.INTEGER, allowNull: false, defaultValue: 0 });
    await q.addColumn('boxes', 'active_session_id', { type: S.INTEGER, allowNull: true });
    await q.sequelize.query(`UPDATE boxes b SET session_counter = (SELECT COALESCE(MAX(t.session_id), 0) FROM tapping_history t WHERE t.id_box = b.id_box)`);
    await q.changeColumn('boxes', 'lat', { type: S.DECIMAL(10, 6), allowNull: true });
    await q.changeColumn('boxes', 'lng', { type: S.DECIMAL(10, 6), allowNull: true });
    const columns = await q.describeTable('supervisor_box_team');
    if (!columns.maintenance_type) await q.addColumn('supervisor_box_team', 'maintenance_type', { type: S.STRING(30), allowNull: false, defaultValue: 'Mekanikal' });
    // Preserve historical rows; idle counting uses a separate latest-value table.
    await q.createTable('people_counting_latest', {
      id_box: { type: S.STRING(50), primaryKey: true },
      session_id: { type: S.INTEGER, allowNull: true },
      detected_count: { type: S.INTEGER, allowNull: false },
      registered_count: { type: S.INTEGER, allowNull: false },
      created_at: { type: S.DATE, allowNull: false }
    });
  },
  async down() { throw new Error('Use a reviewed recovery migration; automatic rollback would delete production data.'); }
};
