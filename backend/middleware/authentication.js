import { isIP } from 'node:net';
import pool from '../config/database.js';
import { readSessionToken, hashToken, csrfToken, secureEqual, normalizeRole } from '../security/session.js';

export default async function authentication(req, res, next) {
  try {
    const token = readSessionToken(req);
    if (token) {
      const [rows] = await pool.query(`SELECT u.sid, u.nama, u.role, u.rfid_uid, u.foto
        FROM web_sessions s JOIN users u ON u.sid = s.sid
        WHERE s.token_hash = ? AND s.expires_at > NOW()`, [hashToken(token)]);
      if (rows[0] && normalizeRole(rows[0].role)) {
        req.auth = { type: 'user', user: rows[0], role: normalizeRole(rows[0].role), csrf: csrfToken(token) };
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !secureEqual(req.headers['x-csrf-token'], req.auth.csrf)) {
          return res.status(403).json({ success: false, message: 'Token CSRF tidak valid.' });
        }
        return next();
      }
    }
    const deviceIp = String(req.headers['x-device-ip'] || '').trim().replace(/^::ffff:/i, '');
    if (isIP(deviceIp) === 4) {
      const [rows] = await pool.query('SELECT id_box FROM boxes WHERE ip = ? LIMIT 2', [deviceIp]);
      if (rows.length === 1) {
        req.auth = { type: 'device', boxId: rows[0].id_box };
        return next();
      }
    }
    return res.status(401).json({ success: false, message: 'Silakan login atau kirim IP ESP32 yang sudah didaftarkan.' });
  } catch (error) { next(error); }
}
