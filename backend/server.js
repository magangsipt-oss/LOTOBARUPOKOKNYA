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
import { testConnection } from './config/database.js';
import authentication from './middleware/authentication.js';

// Inisialisasi konfigurasi environment variable (.env)
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Konfigurasi __dirname untuk modul ES (ES Modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: false // allow image serving from /uploads
}));

// CORS — izinkan frontend & ESP32
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (ESP32, curl, mobile apps)
    if (!origin) return callback(null, true);
    // Allow frontend URL
    if (origin === FRONTEND_URL) return callback(null, true);
    // Allow localhost origins (development)
    if (origin.match(/^http:\/\/localhost:\d+$/)) return callback(null, true);
    // Allow all in development
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-device-token', 'X-Device-Token'],
  credentials: true
}));

// Rate limiting — global
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 500, // max 500 request per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak request. Coba lagi dalam 15 menit.' }
});
app.use(globalLimiter);

// Rate limiting — login (lebih ketat)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, // max 15 login attempt per 15 menit per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }
});

// 2. Middleware Dasar
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 3. Middleware Static Folder untuk Foto Profil dan Dokumen
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, '..', 'api', 'uploads')));

// 4. Pendaftaran Endpoint API

// Login pakai rate limiting khusus
app.use('/api/users/login', loginLimiter, userRoutes);

// ESP32 device routes — pakai auth API key
app.use('/api/boxes', authentication, boxRoutes);
app.use('/api/commands', authentication, commandRoutes);
app.use('/api/events', authentication, eventRoutes);

// Web frontend routes — auth opsional (tergantung API_SECRET_KEY di .env)
app.use('/api/logs', logRoutes);
app.use('/api/users', userRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/refueling', refuelingRoutes);
app.use('/api/supervisor', supervisorRoutes);
app.use('/api/stream', streamRoutes);

// 5. Rute Pemeriksaan Kesehatan Server (Health Check)
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'Backend E-LOTO Industrial IoT Safety System berjalan dengan baik!',
    timestamp: new Date().toISOString()
  });
});

// 6. Menjalankan Server
const startServer = async () => {
  const databaseConnected = await testConnection();
  if (!databaseConnected) {
    console.error('⚠️ Server berjalan, tetapi sinkronisasi database belum tersedia.');
  }

  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` Server E-LOTO Backend aktif di: http://localhost:${PORT}`);
    console.log(` Sinkronisasi database: ${databaseConnected ? 'AKTIF' : 'GAGAL'}`);
    console.log(` CORS Origin: ${FRONTEND_URL}`);
    console.log(` API Key Auth: ${process.env.API_SECRET_KEY ? 'AKTIF' : 'DISABLED (dev mode)'}`);
    console.log(`==================================================`);
  });
};

startServer();
