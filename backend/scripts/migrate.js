import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Sequelize } from 'sequelize';
import sequelize from '../orm/sequelize.js';
const require = createRequire(import.meta.url);
async function migrate() {
  const connection = await sequelize.connectionManager.getConnection();
  // All migration statements run on the same connection as the advisory lock.
  const query = sequelize.query.bind(sequelize);
  sequelize.query = (sql, options = {}) => query(sql, { ...options, transaction: { connection } });
  try {
    const [[lock]] = await sequelize.query("SELECT GET_LOCK('eloto_schema_migration', 10) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another migration is running');
    await sequelize.query('CREATE TABLE IF NOT EXISTS eloto_migrations (name VARCHAR(255) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const [done] = await sequelize.query('SELECT name FROM eloto_migrations');
    const applied = new Set(done.map(row => row.name));
    const names = (await fs.readdir(new URL('../migrations/', import.meta.url))).filter(n => n.endsWith('.cjs')).sort();
    const q = sequelize.getQueryInterface();
    const addColumn = q.addColumn.bind(q);
    q.addColumn = async (table, name, definition, options) => {
      if (!(await q.describeTable(table))[name]) await addColumn(table, name, definition, options);
    };
    const addIndex = q.addIndex.bind(q);
    q.addIndex = async (table, fields, options = {}) => {
      const existing = await q.showIndex(table);
      if (!existing.some(index => Boolean(index.unique) === Boolean(options.unique) && index.fields.map(f => f.attribute).join(',') === fields.join(','))) {
        await addIndex(table, fields, options);
      }
    };
    if (process.argv.includes('--baseline-existing')) {
      if (applied.size) throw new Error('Baseline is only allowed before any migration has been recorded');
      // Verify baseline columns without changing any user data.
      const definitions = [];
      await require('../migrations/' + names[0]).up({ createTable: async (name, fields) => definitions.push([name, fields]), addIndex: async () => {} }, Sequelize);
      for (const [name, fields] of definitions) {
        const existing = await q.describeTable(name);
        for (const key of Object.keys(fields)) if (!existing[key]) throw new Error(`Missing baseline column ${name}.${key}; reconcile schema first`);
      }
      await sequelize.query('INSERT INTO eloto_migrations (name) VALUES (?)', { replacements: [names[0]] });
      applied.add(names[0]);
    }
    for (const name of names) {
      if (applied.has(name)) continue;
      console.log('Applying', name);
      await require('../migrations/' + name).up(q, Sequelize);
      await sequelize.query('INSERT INTO eloto_migrations (name) VALUES (?)', { replacements: [name] });
    }
  } finally {
    await sequelize.query("SELECT RELEASE_LOCK('eloto_schema_migration')").catch(() => {});
    await sequelize.connectionManager.releaseConnection(connection);
  }
}
migrate().catch(error => { console.error('Migration failed:', error.message); process.exitCode = 1; }).finally(() => sequelize.close());
