import express from 'express';
import commandController from '../controllers/commandController.js';

const router = express.Router();

// 1. Rute untuk set/queue command
router.post('/', commandController.setCommand);

// 2. Rute untuk ambil pending command (device sync)
router.get('/:idBox/pending', commandController.getPendingCommand);

// 3. Rute untuk clear pending command setelah device mengambilnya
router.patch('/:idBox/clear', commandController.clearPendingCommand);

export default router;
