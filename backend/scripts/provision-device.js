import pool from '../config/database.js';
import { hashToken } from '../security/session.js';
try {
  const id = process.env.ELOTO_BOX_ID;
  const token = process.env.ELOTO_DEVICE_TOKEN;
  if (!id || !token || token.length < 32 || token.length > 256) throw new Error('Set ELOTO_BOX_ID and a random ELOTO_DEVICE_TOKEN (32–256 characters)');
  const [existing] = await pool.query('SELECT id_box FROM boxes WHERE device_token = ? AND id_box <> ?', [hashToken(token), id]);
  if (existing.length) throw new Error('A device credential must not be shared by boxes');
  const [result] = await pool.query('UPDATE boxes SET device_token = ? WHERE id_box = ?', [hashToken(token), id]);
  if (!result.affectedRows) throw new Error('Box not found');
  console.log('Device credential configured. Install the same token in the device SD configuration and counting service.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
