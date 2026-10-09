import pool from '../config/database.js';
import UserModel from '../models/userModel.js';
import bcrypt from 'bcryptjs';
import { passwordValidationError } from '../security/password.js';
try {
  const sid = process.env.ELOTO_USER_SID;
  const password = process.env.ELOTO_NEW_PASSWORD;
  const passwordError = passwordValidationError(password, sid);
  if (!sid || passwordError) throw new Error(`Set ELOTO_USER_SID and ELOTO_NEW_PASSWORD: ${passwordError || 'SID wajib diisi.'}`);
  if (!await UserModel.getBySid(sid)) throw new Error('User not found');
  await UserModel.changePassword(sid, await bcrypt.hash(password, 12));
  console.log('Password changed and existing sessions revoked.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await pool.end(); }
