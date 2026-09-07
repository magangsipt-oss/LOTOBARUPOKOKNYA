import express from 'express';
import userController from '../controllers/userController.js';
import upload from '../middleware/fileUploader.js';

const router = express.Router();

// 1. Rute autentikasi, kartu RFID & supervisor
router.post('/login', userController.login);
router.post('/check-card', userController.checkCard);
router.get('/supervisors', userController.getSupervisors);
router.get('/photo/:uid', userController.getPhoto);

// 2. Rute CRUD user
router.route('/')
  .get(userController.getAllUsers)
  .post(upload.single('profile_photo'), userController.createUser);

router.route('/:sid')
  .get(userController.getUserBySid)
  .put(upload.single('profile_photo'), userController.updateUser)
  .delete(userController.deleteUser);

export default router;