import { createApp } from './app.js';
import pool, { testConnection } from './config/database.js';
import dgram from 'node:dgram';
import os from 'node:os';

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const ip = iface.address;
      if (/^(169\.254|100\.)/i.test(ip)) continue;
      candidates.push(ip);
    }
  }

  const preferredPatterns = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[0-1])\./];
  for (const pattern of preferredPatterns) {
    const match = candidates.find(ip => pattern.test(ip));
    if (match) return match;
  }

  return candidates[0] || '127.0.0.1';
}

function startDiscoveryService() {
  const UDP_PORT = Number(process.env.DISCOVERY_PORT) || 5003;
  const HTTP_PORT = Number(process.env.PORT) || 5002;
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', err => console.error('[DISCOVERY] UDP error:', err.message));
  sock.on('message', (msg, rinfo) => {
    const text = msg.toString().trim();
    if (text === 'ELOTO_DISCOVER') {
      const serverIp = process.env.SERVER_IP || getLocalIp();
      const reply = `ELOTO_SERVER|http://${serverIp}:${HTTP_PORT}`;
      sock.send(reply, rinfo.port, rinfo.address, () => {
        console.log(`[DISCOVERY] Replied to ${rinfo.address}:${rinfo.port} → ${reply}`);
      });
    }
  });
  sock.bind(UDP_PORT, () => {
    sock.setBroadcast(true);
    console.log(`[DISCOVERY] UDP listener on port ${UDP_PORT}`);
  });
}

async function start() {
  const app = createApp();
  if (!await testConnection()) throw new Error('Database unavailable; refusing to start');
  // Fail startup when required migrations have not been applied.
  await pool.query('SELECT token_hash FROM web_sessions LIMIT 0');
  await pool.query('SELECT id FROM device_commands LIMIT 0');
  const [migrations] = await pool.query('SELECT name FROM eloto_migrations WHERE name = ?', ['20260908-production-hardening.cjs']);
  if (!migrations.length) throw new Error('Production hardening migration is incomplete');
  // Check BLE LOTO compliance migration
  const [bleMigration] = await pool.query('SELECT name FROM eloto_migrations WHERE name = ?', ['20260915-ble-loto-compliance.cjs']);
  if (!bleMigration.length) throw new Error('BLE LOTO compliance migration is incomplete');
  const server = app.listen(Number(process.env.PORT) || 5002, process.env.HOST || '0.0.0.0', () => {
    console.log('E-LOTO backend ready on port ' + (Number(process.env.PORT) || 5002));
    startDiscoveryService();
  });
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
