import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import pool from '../config/database.js';

export const hashToken = value => createHash('sha256').update(value).digest('hex');
export const csrfToken = token => hashToken(`csrf:${token}`);
export const secureEqual = (left, right) => typeof left === 'string' && typeof right === 'string' &&
  Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
export const cookieName = () => process.env.NODE_ENV === 'production' ? '__Host-eloto_session' : 'eloto_session';
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
export function readSessionToken(req) {
  const item = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName()}=`));
  const token = item?.slice(cookieName().length + 1);
  return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
}
export async function createSession(req, res, user) {
  const old = readSessionToken(req);
  if (old) await pool.query('DELETE FROM web_sessions WHERE token_hash = ?', [hashToken(old)]);
  const token = randomBytes(32).toString('hex');
  await pool.query('DELETE FROM web_sessions WHERE expires_at <= NOW()');
  await pool.query('INSERT INTO web_sessions (token_hash, sid, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 8 HOUR))', [hashToken(token), user.sid]);
  res.cookie(cookieName(), token, { ...cookieOptions(), maxAge: 8 * 60 * 60 * 1000 });
  return csrfToken(token);
}
export async function destroySession(req, res) {
  const token = readSessionToken(req);
  if (token) await pool.query('DELETE FROM web_sessions WHERE token_hash = ?', [hashToken(token)]);
  res.clearCookie(cookieName(), cookieOptions());
}
export function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'admin') return 'admin';
  if (/^(pengawas|supervisor|spv|k3)([ _-].*)?$/.test(role)) return 'pengawas';
  if (/^(fuelman|fuel|bbm|refuel)$/.test(role)) return 'fuelman';
  if (/^(worker|teknisi|mekanik|mechanic)([ _-].*)?$/.test(role)) return 'teknisi';
  return null;
}
