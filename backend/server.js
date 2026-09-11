import { createApp } from './app.js';
import pool, { testConnection } from './config/database.js';

async function start() {
  const app = createApp();
  if (!await testConnection()) throw new Error('Database unavailable; refusing to start');
  // Fail startup when required migrations have not been applied.
  await pool.query('SELECT token_hash FROM web_sessions LIMIT 0');
  await pool.query('SELECT id FROM device_commands LIMIT 0');
  const [migrations] = await pool.query('SELECT name FROM eloto_migrations WHERE name = ?', ['20260908-production-hardening.cjs']);
  if (!migrations.length) throw new Error('Production hardening migration is incomplete');
  const server = app.listen(Number(process.env.PORT) || 5002, process.env.HOST || '0.0.0.0', () => console.log('E-LOTO backend ready on port ' + (Number(process.env.PORT) || 5002)));
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => { await pool.end(); clearTimeout(timer); process.exit(0); });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  server.on('error', error => { console.error(error.code); shutdown(); });
}
start().catch(async error => { console.error(error.message); await pool.end(); process.exitCode = 1; });
