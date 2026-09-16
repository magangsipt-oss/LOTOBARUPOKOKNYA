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
    const deviceToken = req.headers['x-device-token'];
    if (typeof deviceToken === 'string' && deviceToken.length >= 32 && deviceToken.length <= 256) {
      const tokenHash = hashToken(deviceToken);
      const [rows] = await pool.query('SELECT id_box FROM boxes WHERE device_token = ?', [tokenHash]);
      if (rows.length === 1) {
        req.auth = { type: 'device', boxId: rows[0].id_box };
        return next();
      }
      // Auto-claim: if box exists but has no token yet, assign this device's token
      if (rows.length === 0) {
        let claimedBoxId = null;

        // Method 1: Match by URL path
        const pathParts = decodeURIComponent(req.path).split('/').filter(Boolean);
        const urlBoxId = pathParts[0] === 'boxes' ? pathParts[1] : null;
        if (urlBoxId) {
          const [unconfigured] = await pool.query('SELECT id_box FROM boxes WHERE id_box = ? AND device_token IS NULL', [urlBoxId]);
          if (unconfigured.length === 1) claimedBoxId = urlBoxId;
        }

        // Method 2: Match by id_box from request body (telemetry payload from ESP32)
        if (!claimedBoxId && req.body && req.body.id_box) {
          const bodyBoxId = req.body.id_box;
          const [unconfigured] = await pool.query('SELECT id_box FROM boxes WHERE id_box = ? AND device_token IS NULL', [bodyBoxId]);
          if (unconfigured.length === 1) claimedBoxId = bodyBoxId;
        }

        // Method 3: Match by IP address from request body (ESP32 reports its own IP)
        if (!claimedBoxId && req.body && req.body.ip) {
          const deviceIp = req.body.ip;
          const [unconfigured] = await pool.query('SELECT id_box FROM boxes WHERE ip = ? AND device_token IS NULL', [deviceIp]);
          if (unconfigured.length === 1) claimedBoxId = unconfigured[0].id_box;
        }

        if (claimedBoxId) {
          // Update token AND IP (ESP32 may have changed IP)
          const updateIp = req.body && req.body.ip ? req.body.ip : null;
          if (updateIp) {
            await pool.query('UPDATE boxes SET device_token = ?, ip = ? WHERE id_box = ?', [tokenHash, updateIp, claimedBoxId]);
          } else {
            await pool.query('UPDATE boxes SET device_token = ? WHERE id_box = ?', [tokenHash, claimedBoxId]);
          }
          console.log(`[AUTH] Auto-assigned device token to box: ${claimedBoxId}${updateIp ? ` (ip→${updateIp})` : ''}`);
          req.auth = { type: 'device', boxId: claimedBoxId };
          return next();
        }

        // Auto-register: box baru dari ESP32 yang belum ada di database
        if (!claimedBoxId && req.body && req.body.id_box) {
          const newBoxId = req.body.id_box;
          const [exists] = await pool.query('SELECT id_box FROM boxes WHERE id_box = ?', [newBoxId]);
          if (exists.length === 0) {
            const newIp = req.body.ip || '0.0.0.0';
            const unit = req.body.ssid || newBoxId;
            await pool.query(
              'INSERT INTO boxes (id_box, unit, ip, device_token, state, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [newBoxId, unit, newIp, tokenHash, 'STATE_WELCOME', 0, 0]
            );
            console.log(`[AUTH] Auto-registered new box: ${newBoxId} (ip: ${newIp})`);
            req.auth = { type: 'device', boxId: newBoxId };
            return next();
          }
        }
      }
    }
    return res.status(401).json({ success: false, message: 'Silakan login atau gunakan kredensial perangkat yang valid.' });
  } catch (error) { next(error); }
}
