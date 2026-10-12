import express from 'express';
import DOPPlanController from '../controllers/dopPlanController.js';

const router = express.Router();

router.get('/', DOPPlanController.getAll);
router.post('/', DOPPlanController.create);
router.delete('/:id', DOPPlanController.delete);

export default router;
