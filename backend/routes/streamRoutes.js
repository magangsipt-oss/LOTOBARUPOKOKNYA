import express from 'express';
import http from 'http';
import pool from '../config/database.js';

const router = express.Router();

// Default MJPEG ports per box (people counting script runs on these ports)
const DEFAULT_MJPEG_PORTS = {
  'BOX ELOTO 1': 8081,
  'BOX ELOTO 2': 8082
};

// ===== ESP32 PROXY — frontend tidak perlu probe langsung =====

// GET /api/stream/proxy/:idBox — proxy status JSON dari ESP32
router.get('/proxy/:idBox', async (req, res) => {
  const { idBox } = req.params;
  const decodedId = decodeURIComponent(idBox);

  try {
    // Ambil IP dari database
    const [rows] = await pool.query('SELECT ip FROM boxes WHERE id_box = ?', [decodedId]);
    if (rows.length === 0 || !rows[0].ip) {
      return res.status(404).json({ success: false, message: `Box '${decodedId}' tidak ditemukan atau IP belum dikonfigurasi` });
    }

    const ip = rows[0].ip;
    if (!ip || ip === '0.0.0.0' || ip === '192.168.1.100') {
      return res.status(400).json({ success: false, message: `IP address box '${decodedId}' belum dikonfigurasi` });
    }

    const targetUrl = ip.startsWith('http') ? ip : `http://${ip}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const proxyReq = http.get(`${targetUrl}/status`, { signal: controller.signal, timeout: 3000 }, (proxyRes) => {
      let data = '';
      proxyRes.on('data', (chunk) => { data += chunk; });
      proxyRes.on('end', () => {
        clearTimeout(timeoutId);
        try {
          const parsed = JSON.parse(data);
          // Tambahkan metadata
          parsed._proxy = { box_id: decodedId, source_ip: ip, proxied: true };
          res.json(parsed);
        } catch (e) {
          res.status(502).json({ success: false, message: 'Response dari ESP32 tidak valid' });
        }
      });
    });

    proxyReq.on('error', (err) => {
      clearTimeout(timeoutId);
      res.status(503).json({ success: false, message: `ESP32 '${decodedId}' offline atau tidak terjangkau`, ip });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      res.status(504).json({ success: false, message: `Timeout menghubungi ESP32 '${decodedId}'` });
    });
  } catch (e) {
    console.error('[StreamProxy] Error:', e.message);
    res.status(500).json({ success: false, message: 'Gagal memproksi status ESP32' });
  }
});

// GET /api/stream/:idBox — Proxy MJPEG dari people counting script
router.get('/:idBox', async (req, res) => {
  const { idBox } = req.params;
  const decodedId = decodeURIComponent(idBox);

  // Get MJPEG port from database or default
  let mjpegPort = DEFAULT_MJPEG_PORTS[decodedId] || 8081;
  try {
    const [rows] = await pool.query('SELECT rtsp_url FROM boxes WHERE id_box = ?', [decodedId]);
    if (rows.length === 0 || !rows[0].rtsp_url) {
      return res.status(404).json({ success: false, message: `RTSP belum dikonfigurasi untuk '${decodedId}'` });
    }
  } catch (e) {
    console.error('[Stream] DB error:', e.message);
  }

  // Proxy MJPEG dari people counting script
  const proxyReq = http.get(`http://127.0.0.1:${mjpegPort}/stream`, { timeout: 5000 }, (proxyRes) => {
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      return res.status(503).json({
        success: false,
        message: `People counting script belum jalan untuk '${decodedId}'`,
        hint: `Jalankan: python3 people_counting.py (port ${mjpegPort})`
      });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ success: false, message: 'Stream timeout' });
    }
  });

  req.on('close', () => {
    proxyReq.destroy();
  });
});

// GET /api/stream — list all boxes
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id_box, rtsp_url FROM boxes');
    const streams = rows.map(r => ({
      id: r.id_box,
      configured: Boolean(r.rtsp_url),
      mjpeg_port: DEFAULT_MJPEG_PORTS[r.id_box] || 8081,
      endpoint: `/api/stream/${encodeURIComponent(r.id_box)}`
    }));
    return res.json({ success: true, data: streams });
  } catch (e) {
    return res.json({ success: true, data: [] });
  }
});

export default router;
