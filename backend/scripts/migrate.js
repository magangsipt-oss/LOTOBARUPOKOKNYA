import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { sequelize } from '../orm/models/index.js';

async function migrate() {
  console.log('Database:', process.env.DB_NAME);

  // Sync all models (create tables)
  await sequelize.sync({ force: true });
  console.log('All tables created');

  // Show tables
  const [tables] = await sequelize.query('SHOW TABLES');
  console.log('\nTables:');
  tables.forEach(t => console.log('  -', Object.values(t)[0]));

  await sequelize.close();
  console.log('\nMigration complete!');
}

migrate().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
