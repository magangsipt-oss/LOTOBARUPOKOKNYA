import express from 'express';
import lotoComplianceController from '../controllers/lotoComplianceController.js';

const router = express.Router();

// 1. BLE Scanner reports detected tags (ESP32 POST here)
router.post('/presence', lotoComplianceController.reportPresence);

// 2. Get latest compliance status for a box
router.get('/compliance/:idBox', lotoComplianceController.getLatestCompliance);

// 3. Get compliance history for a box
router.get('/compliance/:idBox/history', lotoComplianceController.getComplianceHistory);

// 4. Get active BLE presence for a box (recent detections)
router.get('/presence/:idBox', lotoComplianceController.getActivePresence);

// 5. BLE Tag management
router.get('/tags', lotoComplianceController.getAllTags);
router.post('/tags', lotoComplianceController.registerTag);
router.put('/tags/:id', lotoComplianceController.updateTag);
router.delete('/tags/:id', lotoComplianceController.deleteTag);

export default router;
