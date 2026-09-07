import express from 'express';
import cors from 'cors';
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
import { testConnection } from './config/database.js';

// Inisialisasi konfigurasi environment variable (.env)
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

// Konfigurasi __dirname untuk modul ES (ES Modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Middleware Dasar
app.use(cors()); // Mengizinkan akses dari frontend (Cross-Origin Resource Sharing)
app.use(express.json()); // Membaca data berformat JSON dari body request
app.use(express.urlencoded({ extended: true })); // Membaca data form-urlencoded

// 2. Middleware Static Folder untuk Foto Profil dan Dokumen
// Ini memungkinkan frontend menampilkan gambar via: http://localhost:5000/uploads/nama_file.jpg
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, '..', 'api', 'uploads')));

// 3. Pendaftaran Endpoint API
app.use('/api/boxes', boxRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/users', userRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/refueling', refuelingRoutes);
app.use('/api/supervisor', supervisorRoutes);
app.use('/api/commands', commandRoutes);
app.use('/api/events', eventRoutes);

// 4. Rute Pemeriksaan Kesehatan Server (Health Check)
app.get('/', (req, res) => {
  res.json({
    status: 'success',
    message: 'Backend E-LOTO Industrial IoT Safety System berjalan dengan baik!',
    timestamp: new Date().toISOString()
  });
});

// 5. Menjalankan Server
const startServer = async () => {
  const databaseConnected = await testConnection();
  if (!databaseConnected) {
    console.error('⚠️ Server berjalan, tetapi sinkronisasi database belum tersedia.');
  }

  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(` Server E-LOTO Backend aktif di: http://localhost:${PORT}`);
    console.log(` Sinkronisasi database: ${databaseConnected ? 'AKTIF' : 'GAGAL'}`);
    console.log(`==================================================`);
  });
};

startServer();