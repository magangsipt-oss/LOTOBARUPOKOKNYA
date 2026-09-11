import pool from '../config/database.js';
import UserModel from '../models/userModel.js';
import bcrypt from 'bcryptjs';
try {
  const sid = process.env.ELOTO_USER_SID;
  const password = process.env.ELOTO_NEW_PASSWORD;
  if (!sid || typeof password !== 'string' || Buffer.byteLength(password) > 72) throw new Error('Set ELOTO_USER_SID and ELOTO_NEW_PASSWORD (max 72 bytes)');
  if (!await UserModel.getBySid(sid)) throw new Error('User not found');
  await UserModel.changePassword(sid, await bcrypt.hash(password, 12));
  console.log('Password changed and existing sessions revoked.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
