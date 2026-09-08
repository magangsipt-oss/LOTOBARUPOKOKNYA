import pool from '../config/database.js';
import UserModel from '../models/userModel.js';
try {
  const sid = process.env.ELOTO_USER_SID;
  if (!sid || !/^[A-Za-z0-9_-]{1,50}$/.test(sid)) throw new Error('Set ELOTO_USER_SID (1–50 letters, numbers, _ or -)');
  if (await UserModel.getBySid(sid)) throw new Error('User already exists; use reset-password instead');
  await UserModel.create({ sid, nama: process.env.ELOTO_USER_NAME || 'Administrator', role: 'ADMIN', password: sid });
  console.log('Administrator created with SID as the initial password. Change it from the profile page.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
