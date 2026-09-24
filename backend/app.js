import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import rute-rute aplikasi
import boxRoutes from './routes/boxRoutes.js';
import logRoutes from './routes/logRoutes.js';
import userRoutes from './routes/userRoutes.js';
import maintenanceRoutes from './routes/maintenanceRoutes.js';
import refuelingRoutes from './routes/refuelingRoutes.js';
import supervisorRoutes from './routes/supervisorRoutes.js';
import commandRoutes from './routes/commandRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import streamRoutes from './routes/streamRoutes.js';
import lotoComplianceRoutes from './routes/lotoComplianceRoutes.js';
import { testConnection } from './config/database.js';
import authentication from './middleware/authentication.js';
import authorization from './middleware/authorization.js';
import userController from './controllers/userController.js';


dotenv.config({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });
export function createApp() {
  const app = express();
  const production = process.env.NODE_ENV === 'production';
  const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
  const devOrigins = production ? [] : [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5173'
  ];
  if (production && !frontend.startsWith('https://')) throw new Error('FRONTEND_URL must use HTTPS in production');
  if (production && (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER || process.env.DB_USER === 'root' || !process.env.DB_PASSWORD)) throw new Error('Configure a dedicated database account before production startup');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY.split(',').map(s => s.trim()));
  const streamPorts = JSON.parse(process.env.MJPEG_PORTS || '{}');
  if (!streamPorts || Array.isArray(streamPorts) || typeof streamPorts !== 'object' || Object.values(streamPorts).some(p => !Number.isInteger(p) || p < 1024 || p > 65535)) throw new Error('MJPEG_PORTS must map box IDs to valid local ports');
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin === frontend || devOrigins.includes(origin)) return cb(null, true);
      cb(Object.assign(new Error('Origin tidak diizinkan.'), { status: 403 }));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Device-Token', 'User-Agent'],
    credentials: true
  }));
  app.use((req, res, next) => {
    // Allow device requests without Origin header (ESP32 telemetry)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== frontend && !devOrigins.includes(req.headers.origin)) {
      return res.status(403).json({ success: false, message: 'Origin tidak diizinkan.' });
    }
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false, limit: '8mb' }));
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false });
  app.post('/api/users/login', loginLimiter, userController.login);
  app.get('/health/live', (_req, res) => res.json({ success: true }));
  app.get('/health/ready', async (_req, res) => {
    const ready = await testConnection();
    res.status(ready ? 200 : 503).json({ success: ready });
  });
  app.get('/', (_req, res) => res.json({ success: true, service: 'E-LOTO' }));

  // Diagnostic endpoint for ESP32 connectivity check
  app.get('/api/diagnostic/device', (req, res) => {
    const deviceToken = req.headers['x-device-token'];
    res.json({
      success: true,
      message: 'Backend reachable',
      server_time: new Date().toISOString(),
      has_device_token: Boolean(deviceToken),
      device_token_length: deviceToken ? deviceToken.length : 0,
      client_ip: req.ip || req.connection?.remoteAddress || 'unknown',
      headers: {
        origin: req.headers.origin || 'none',
        host: req.headers.host || 'none'
      }
    });
  });
  app.use('/api', authentication);
  // Independent budgets per authenticated principal; polling clients behind one NAT do not share a quota.
  app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300,
    keyGenerator: req => req.auth.type === 'device' ? `device:${req.auth.boxId}` : `user:${req.auth.user.sid}`,
    standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api', authorization);
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const root = path.dirname(fileURLToPath(import.meta.url));
  app.use('/api/uploads', express.static(path.join(root, 'uploads'), { dotfiles: 'deny' }));
  app.use('/api/legacy-uploads', express.static(path.join(root, 'legacy-uploads'), { dotfiles: 'deny' }));
  app.use('/api/boxes', boxRoutes);
  app.use('/api/commands', commandRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/logs', logRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/maintenance', maintenanceRoutes);
  app.use('/api/refueling', refuelingRoutes);
  app.use('/api/supervisor', supervisorRoutes);
  app.use('/api/stream', streamRoutes);
  app.use('/api/loto', lotoComplianceRoutes);
  app.use((_req, res) => res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.' }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.destroy();
    console.error('Request failed:', error.code || error.name);
    const status = error.code === 'LIMIT_FILE_SIZE' || error.type === 'entity.too.large' ? 413 :
      error.status >= 400 && error.status < 500 ? error.status : 500;
    res.status(status).json({ success: false, message: status === 500 ? 'Terjadi kesalahan server.' : 'Permintaan tidak valid.' });
  });
  return app;
}
