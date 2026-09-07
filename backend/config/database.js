import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Membaca konfigurasi dari file .env
dotenv.config({ path: new URL('../.env', import.meta.url), quiet: true });

/**
 * Membuat Connection Pool ke Database MySQL E-LOTO
 */
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'eloto_db',
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10, // Maksimal 10 antrean koneksi aktif bersamaan
  queueLimit: 100,
  connectTimeout: 10000,
  timezone: '+08:00'
});

pool.pool.on('connection', connection => { connection.query("SET time_zone = '+08:00'"); });

// Fungsi pembantu untuk menguji apakah database berhasil terhubung
export const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Berhasil terhubung ke database MySQL E-LOTO!');
    connection.release(); // Kembalikan koneksi ke pool
    return true;
  } catch (error) {
    console.error('❌ Gagal terhubung ke database MySQL:', error.message);
    return false;
  }
};

export default pool;