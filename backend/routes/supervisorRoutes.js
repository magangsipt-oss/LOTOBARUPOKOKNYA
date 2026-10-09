import express from 'express';
import supervisorController from '../controllers/supervisorController.js';

const router = express.Router();

// 1. Rute Team berdasarkan query params (GET /team?supervisor_sid=X&id_box=Y)
//    Frontend: userService.getSupervisorTeam()
router.get('/team', supervisorController.getTeam);

// 2. Rute Team berdasarkan query params (POST /team) — bulk save
//    Frontend: userService.saveSupervisorTeam()
router.post('/team', supervisorController.saveTeam);

// 3. Rute Supervisor Team untuk box tertentu
router.get('/box/:idBox', supervisorController.getTeamByBox);

// 4. Rute Supervisor Team untuk pengawas tertentu
router.get('/supervisor/:supervisorSid', supervisorController.getTeamBySupervisor);

// 5. Rute Menambahkan Mekanik ke Team Pengawas
router.post('/add', supervisorController.addMechanicToTeam);

// 6. Rute Operasi pada satu Team Member (Remove)
router.delete('/:id', supervisorController.removeMechanicFromTeam);

// 7. Rute Hapus seluruh team untuk box
router.delete('/box/:idBox/clear', supervisorController.deleteTeamByBox);

export default router;
