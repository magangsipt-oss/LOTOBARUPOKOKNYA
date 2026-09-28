import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';
import { validDeviceCredential } from '../security/deviceCredential.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const esp32Token = process.env.ELOTO_DEVICE_TOKEN;
if (!validDeviceCredential(esp32Token)) {
  console.error('Set ELOTO_DEVICE_TOKEN (32–256 characters).');
  process.exit(1);
}
const esp32Hash = crypto.createHash('sha256').update(esp32Token).digest('hex');

console.log('=== Device Token Verification ===');
console.log('Credential loaded; plaintext and hash will not be printed.');

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
    console.log('Provision ulang dengan ELOTO_BOX_ID dan ELOTO_DEVICE_TOKEN.');
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
