import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Token yang dipakai ESP32 (dari config.txt atau default)
const esp32Token = process.argv[2] || 'ESP32-ELOTO-BOX1-SECRET-TOKEN-2024';
const esp32Hash = crypto.createHash('sha256').update(esp32Token).digest('hex');

console.log('=== Device Token Verification ===');
console.log('ESP32 Token:', esp32Token);
console.log('ESP32 Hash: ', esp32Hash);
console.log('');

try {
  // Cek semua boxes
  const [boxes] = await pool.query('SELECT id_box, device_token FROM boxes');
  console.log(`Found ${boxes.length} box(es):`);

  let matchFound = false;
  for (const box of boxes) {
    const dbToken = box.device_token || '(NULL)';
    const match = box.device_token === esp32Hash;
    console.log(`  ${box.id_box}: token=${dbToken.substring(0, 20)}... ${match ? '✓ MATCH' : '✗ NO MATCH'}`);
    if (match) matchFound = true;
  }

  if (!matchFound) {
    console.log('');
    console.log('⚠️  TIDAK ADA BOX YANG COCOK!');
    console.log('Jalankan: node scripts/set-device-token.js "' + boxes[0]?.id_box + '" "' + esp32Token + '"');
  } else {
    console.log('');
    console.log('✓ Device token sudah benar. Foto harusnya bisa diakses.');
  }

  // Test photo endpoint langsung
  console.log('');
  console.log('=== Testing Photo Lookup ===');
  const [users] = await pool.query('SELECT sid, nama, rfid_uid, foto FROM users WHERE rfid_uid IS NOT NULL LIMIT 3');
  for (const u of users) {
    const hasPhoto = u.foto && u.foto.length > 0;
    console.log(`  ${u.nama} (${u.rfid_uid}): foto=${hasPhoto ? u.foto.substring(0, 40) + '...' : 'TIDAK ADA'}`);
  }

} catch (error) {
  console.error('Error:', error.message);
} finally {
  await pool.end();
}
