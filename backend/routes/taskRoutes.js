import express from 'express';
import TaskController from '../controllers/taskController.js';

const router = express.Router();

router.get('/', TaskController.getMine);

export default router;
