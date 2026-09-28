import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import pool from '../config/database.js';
import { validDeviceCredential } from '../security/deviceCredential.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/**
 * Script untuk mengatur device_token untuk ESP32
 * Deprecated compatibility entrypoint. Prefer: pnpm --filter backend run provision-device
 */

async function setDeviceToken() {
  const boxId = process.env.ELOTO_BOX_ID;
  const token = process.env.ELOTO_DEVICE_TOKEN;

  if (!boxId || !validDeviceCredential(token)) {
    console.error('Set ELOTO_BOX_ID and ELOTO_DEVICE_TOKEN (32–256 characters).');
    process.exit(1);
  }

  try {
    // Hash token dengan SHA-256
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    console.log('Box ID:', boxId);

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
    console.log('Credential disimpan. Salin token dari secret manager ke SD tanpa mencetaknya di terminal.');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setDeviceToken();
