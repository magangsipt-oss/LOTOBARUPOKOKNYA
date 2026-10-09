import sequelize from '../orm/sequelize.js';

const tables = [
  'device_events', 'device_commands', 'web_sessions', 'people_counting_latest',
  'people_counting', 'tapping_history', 'audit_logs', 'queue', 'rfid_buffer',
  'maintenance_logs', 'refueling_logs', 'supervisor_box_team', 'boxes', 'users'
];

if (process.env.NODE_ENV === 'production') throw new Error('Demo reset is disabled in production');

try {
  await sequelize.authenticate();
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of tables) {
    await sequelize.query(`TRUNCATE TABLE \`${table}\``);
    console.log(`Truncated ${table}`);
  }
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log('Database kosong. Jalankan seeder demo...');
} finally {
  await sequelize.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
  await sequelize.close();
}
