import pool from '../config/database.js';
import UserModel from '../models/userModel.js';
import { passwordValidationError } from '../security/password.js';
try {
  const seed = process.argv.includes('--seed');
  const sid = process.env.ELOTO_USER_SID ?? (seed ? 'Admin' : undefined);
  if (!sid || !/^[A-Za-z0-9_-]{1,50}$/.test(sid)) throw new Error('Set ELOTO_USER_SID (1–50 letters, numbers, _ or -)');
  const existing = await UserModel.getBySid(sid);
  if (existing) {
    if (!seed) throw new Error('User already exists; use reset-password instead');
    if (String(existing.role).trim().toUpperCase() !== 'ADMIN') throw new Error('SID already belongs to a non-admin user; choose another ELOTO_USER_SID');
    console.log(`Administrator ${existing.sid} already exists; skipped.`);
  } else {
    const password = process.env.ELOTO_NEW_PASSWORD;
    const passwordError = passwordValidationError(password, sid);
    if (passwordError) throw new Error(`Set ELOTO_NEW_PASSWORD: ${passwordError}`);
    await UserModel.create({ sid, nama: process.env.ELOTO_USER_NAME || 'Administrator', role: 'ADMIN', password });
    console.log('Administrator created. Password was not printed.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
