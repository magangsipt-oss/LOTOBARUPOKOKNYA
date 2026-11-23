import express from 'express';
import LotoPermitController from '../controllers/lotoPermitController.js';

const router = express.Router();

router.get('/', LotoPermitController.getAll);
router.get('/:id', LotoPermitController.getById);
router.post('/', LotoPermitController.create);
router.put('/:id', LotoPermitController.update);
router.post('/:id/approve', LotoPermitController.approve);
router.delete('/:id', LotoPermitController.delete);

export default router;
