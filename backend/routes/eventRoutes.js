import express from 'express';
import eventController from '../controllers/eventController.js';

const router = express.Router();

// ===== RFID BUFFER ROUTES =====

// 1. Rute untuk ambil semua RFID buffer
router.get('/buffer', eventController.getAllRfidBuffer);

// 2. Rute untuk ambil RFID buffer by box
router.get('/buffer/box/:idBox', eventController.getBufferByBox);

// 3. Rute untuk tambah ke RFID buffer
router.post('/buffer', eventController.addToBuffer);

// 4. Rute untuk hapus dari RFID buffer
router.delete('/buffer/:id', eventController.removeFromBuffer);

// 5. Rute untuk clear semua buffer for box
router.delete('/buffer/box/:idBox/clear', eventController.clearBufferByBox);

// ===== AUDIT LOGS ROUTES =====

// 6. Rute untuk ambil semua audit logs
router.get('/logs', eventController.getAllAuditLogs);

// 7. Rute untuk ambil audit logs by box
router.get('/logs/box/:idBox', eventController.getAuditLogsByBox);

// 8. Rute untuk catat event baru
router.post('/logs', eventController.createAuditLog);

// 9. Rute untuk hapus audit log
router.delete('/logs/:id', eventController.deleteAuditLog);

// 10. Rute untuk hapus old audit logs
router.delete('/logs/old/cleanup', eventController.deleteOldAuditLogs);

export default router;
