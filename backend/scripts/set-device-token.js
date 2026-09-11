import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import pool from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/**
 * Script untuk mengatur device_token untuk ESP32
 * Usage: node scripts/set-device-token.js <box_id> <token>
 * Example: node scripts/set-device-token.js "BOX ELOTO 1" "ESP32-ELOTO-BOX1-SECRET-TOKEN-2024"
 */

async function setDeviceToken() {
  const boxId = process.argv[2];
  const token = process.argv[3];

  if (!boxId || !token) {
    console.error('Usage: node scripts/set-device-token.js <box_id> <token>');
    console.error('Example: node scripts/set-device-token.js "BOX ELOTO 1" "ESP32-ELOTO-BOX1-SECRET-TOKEN-2024"');
    process.exit(1);
  }

  try {
    // Hash token dengan SHA-256
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    console.log('Box ID:', boxId);
    console.log('Token:', token);
    console.log('Token Hash:', tokenHash);

    // Update database
    const [result] = await pool.query(
      'UPDATE boxes SET device_token = ? WHERE id_box = ?',
      [tokenHash, boxId]
    );

    if (result.affectedRows === 0) {
      console.error(`Box dengan ID "${boxId}" tidak ditemukan di database.`);
      process.exit(1);
    }

    console.log(`✓ Device token berhasil diatur untuk box "${boxId}"`);
    console.log('');
    console.log('Konfigurasi ESP32 (config.txt di SD Card):');
    console.log(`TOKEN=${token}`);
    console.log('');
    console.log('Pastikan firmware ESP32 menggunakan token yang sama!');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setDeviceToken();
