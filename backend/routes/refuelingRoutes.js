import express from 'express';
import refuelingController from '../controllers/refuelingController.js';

const router = express.Router();

// 1. Rute Utama Refueling Logs (Ambil semua)
router.get('/', refuelingController.getAllRefueling);

// 2. Rute Refueling Logs untuk box tertentu
router.get('/box/:idBox', refuelingController.getRefuelingByBox);

// 3. Rute Memulai Refueling Session
router.post('/start', refuelingController.startRefueling);

// 4. Rute Operasi pada satu Refueling Log (End, Delete)
router.route('/:id')
  .patch(refuelingController.endRefueling)
  .delete(refuelingController.deleteRefueling);

export default router;
