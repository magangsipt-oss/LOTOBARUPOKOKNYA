import pool from '../config/database.js';
import UserModel from '../models/userModel.js';
try {
  const sid = process.env.ELOTO_USER_SID;
  const password = process.env.ELOTO_NEW_PASSWORD;
  if (!sid || !/^[A-Za-z0-9_-]{1,50}$/.test(sid) || !password || password === sid || password.length < 12 || Buffer.byteLength(password) > 72) throw new Error('Set ELOTO_USER_SID and a strong ELOTO_NEW_PASSWORD');
  if (await UserModel.getBySid(sid)) throw new Error('User already exists; use reset-password instead');
  await UserModel.create({ sid, nama: process.env.ELOTO_USER_NAME || 'Administrator', role: 'ADMIN', password });
  console.log('Administrator created. No RFID badge is assigned automatically.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
