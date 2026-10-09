import express from 'express';
import maintenanceController from '../controllers/maintenanceController.js';

const router = express.Router();

// 1. Rute Utama Maintenance Logs (Ambil semua & Tambah baru)
router.route('/')
  .get(maintenanceController.getAllMaintenance)
  .post(maintenanceController.createMaintenance);

// 2. Rute Maintenance Logs untuk box tertentu
router.get('/box/:idBox', maintenanceController.getMaintenanceByBox);

// 3. Rute Operasi pada satu Maintenance Log (Get by ID, Update, Delete)
router.route('/:id')
  .get(maintenanceController.getMaintenanceById)
  .put(maintenanceController.updateMaintenance)
  .delete(maintenanceController.deleteMaintenance);

export default router;
