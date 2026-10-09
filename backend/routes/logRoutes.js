import express from 'express';
import logController from '../controllers/logController.js';

const router = express.Router();

// 1. Rute Khusus Riwayat Tap RFID (diletakkan di atas agar tidak bertabrakan dengan parameter :id)
router.route('/tapping-history')
  .get(logController.getTappingHistory);

router.get('/tapping-history/stats', logController.getTappingStats);
router.get('/tapping-history/session-id/:idBox', logController.generateSessionId);
router.delete('/tapping-history/clear', logController.clearTappingHistory);

// People Counting
router.post('/people-counting', logController.upsertPeopleCount);
router.get('/people-counting/:idBox', logController.getLatestPeopleCount);
router.get('/people-counting/:idBox/history', logController.getPeopleCountHistory);
router.delete('/tapping-history/:id', logController.deleteTappingById);
router.post('/tapping', logController.createTapping);

// 2. Rute Pembersihan Seluruh Log Aktivitas
router.delete('/clear', logController.clearAllLogs);

// RFID Buffer
router.get('/buffer', logController.getAllBuffer);
router.delete('/buffer/:id', logController.deleteBuffer);

// 3. Rute Utama Log Aktivitas (Ambil semua log & Tambah log baru)
router.route('/')
  .get(logController.getAllLogs)
  .post(logController.createLog);

// 4. Rute Hapus Satu Baris Log Berdasarkan ID
router.delete('/:id', logController.deleteLog);

export default router;