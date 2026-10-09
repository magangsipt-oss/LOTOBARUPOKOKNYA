import express from 'express';
import http from 'node:http';
import BoxModel from '../models/boxModel.js';
const router = express.Router();
const ports = () => JSON.parse(process.env.MJPEG_PORTS || '{}');
// Report the authenticated telemetry snapshot, never fetch arbitrary database URLs.
router.get('/proxy/:idBox', async (req, res, next) => {
  try {
    const box = (await BoxModel.getAll()).find(b => b.id_box === req.params.idBox);
    if (!box) return res.status(404).json({ success: false });
    const hw = box.hw_data ? JSON.parse(box.hw_data) : {};
    res.json({ ...hw, ...box });
  } catch (error) { next(error); }
});
router.get('/', async (_req, res, next) => {
  try { res.json({ success: true, data: (await BoxModel.getAll()).map(b => ({ id: b.id_box, configured: Boolean(ports()[b.id_box]), endpoint: `/api/stream/${encodeURIComponent(b.id_box)}` })) }); }
  catch (error) { next(error); }
});
router.get('/:idBox', async (req, res, next) => {
  try {
    const port = ports()[req.params.idBox];
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return res.status(404).json({ success: false, message: 'Stream belum dikonfigurasi.' });
    const upstream = http.get({ hostname: '127.0.0.1', port, path: '/stream', timeout: 10000 }, response => {
      if (response.statusCode !== 200) { response.resume(); return res.status(502).end(); }
      res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => { if (!res.headersSent) res.status(503).json({ success: false, message: 'Stream tidak tersedia.' }); else res.destroy(); });
    res.on('close', () => upstream.destroy());
  } catch (error) { next(error); }
});
export default router;
