import LotoPermitModel from '../models/lotoPermitModel.js';
import BriefingModel from '../models/briefingModel.js';
import { computeTasks } from '../domain/tasks.js';
import { localParts } from '../domain/lotoPermit.js';
import { viewerOf } from '../domain/personnel.js';

// Tugas formulir lapangan untuk pengguna yang sedang login (angka merah di menu dan kotak "Tugas Anda").
const TaskController = {
  getMine: async (req, res) => {
    try {
      const viewer = viewerOf(req.auth);
      if (!['admin', 'pengawas', 'safety', 'teknisi'].includes(viewer.role)) return res.status(200).json({ success: true, data: [] });
      const permits = await LotoPermitModel.getAll();
      // Daftar hadir yang gagal dimuat (mis. migrasi belum dijalankan) tidak boleh menghilangkan tugas izin LOTO.
      const briefings = await BriefingModel.getAll().catch(error => { console.error('Tasks: briefings unavailable:', error.code || error.message); return []; });
      const data = computeTasks({ permits, briefings, viewer, today: localParts().date });
      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('Error getMyTasks:', error.message);
      return res.status(500).json({ success: false, message: 'Gagal memuat tugas.', error: 'REQUEST_FAILED' });
    }
  }
};

export default TaskController;
