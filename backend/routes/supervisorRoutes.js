import express from 'express';
import supervisorController from '../controllers/supervisorController.js';

const router = express.Router();

// 1. Rute Supervisor Team untuk box tertentu
router.get('/box/:idBox', supervisorController.getTeamByBox);

// 2. Rute Supervisor Team untuk pengawas tertentu
router.get('/supervisor/:supervisorSid', supervisorController.getTeamBySupervisor);

// 3. Rute Menambahkan Mekanik ke Team Pengawas
router.post('/add', supervisorController.addMechanicToTeam);

// 4. Rute Operasi pada satu Team Member (Remove)
router.delete('/:id', supervisorController.removeMechanicFromTeam);

// 5. Rute Hapus seluruh team untuk box
router.delete('/box/:idBox/clear', supervisorController.deleteTeamByBox);

export default router;
