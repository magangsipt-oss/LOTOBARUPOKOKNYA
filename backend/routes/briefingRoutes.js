import express from 'express';
import BriefingController from '../controllers/briefingController.js';

const router = express.Router();

router.get('/', BriefingController.getAll);
router.get('/:id', BriefingController.getById);
router.post('/', BriefingController.create);
router.put('/:id', BriefingController.update);
router.post('/:id/sign', BriefingController.sign);
router.delete('/:id', BriefingController.delete);

export default router;
