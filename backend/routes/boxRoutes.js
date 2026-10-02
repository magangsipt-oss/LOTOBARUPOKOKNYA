import express from 'express';
import boxController from '../controllers/boxController.js';

const router = express.Router();

// 1. Rute untuk mengambil seluruh data box dan menambah box baru
router.route('/')
  .get(boxController.getAllBoxes)
  .post(boxController.createBox);

// 2. Probe GPS dari device ESP32 berdasarkan IP address ( HARUS sebelum /:idBox )
router.get('/probe/:ip', boxController.probeDevice);

// 3. Handshake khusus perangkat. Dipakai firmware sebelum mengirim telemetri.
router.get('/:idBox/device-handshake', boxController.deviceHandshake);

// 4. Rute untuk mengambil detail, memperbarui data, dan menghapus box berdasarkan ID Box
router.route('/:idBox')
  .get(boxController.getBoxById)
  .put(boxController.updateBox)
  .delete(boxController.deleteBox);

// 5. Rute khusus untuk memperbarui state box (IDLE / LOCKED / etc)
router.patch('/:idBox/state', boxController.updateBoxState);

// 6. Rute untuk menerima dan menyimpan telemetri/hardware status dari ESP32
router.post('/:idBox/telemetry', boxController.updateTelemetry);

export default router;
