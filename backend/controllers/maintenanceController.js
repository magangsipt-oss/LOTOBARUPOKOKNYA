import MaintenanceModel from '../models/maintenanceModel.js';

/**
 * Controller untuk mengelola Maintenance Logs E-LOTO
 */
const maintenanceController = {
  // 1. Mengambil semua maintenance logs
  getAllMaintenance: async (req, res) => {
    try {
      const logs = await MaintenanceModel.getAll();
      return res.status(200).json({
        success: true,
        message: 'Data seluruh maintenance logs berhasil diambil',
        data: logs
      });
    } catch (error) {
      console.error('Error getAllMaintenance:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil data maintenance logs',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 2. Mengambil maintenance logs untuk box tertentu
  getMaintenanceByBox: async (req, res) => {
    try {
      const { idBox } = req.params;

      if (!idBox) {
        return res.status(400).json({
          success: false,
          message: 'Parameter idBox wajib disertakan!'
        });
      }

      const logs = await MaintenanceModel.getByIdBox(idBox);
      return res.status(200).json({
        success: true,
        message: `Maintenance logs untuk box ${idBox} berhasil diambil`,
        data: logs
      });
    } catch (error) {
      console.error('Error getMaintenanceByBox:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil maintenance logs',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 3. Mengambil satu maintenance log berdasarkan ID
  getMaintenanceById: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Parameter id wajib disertakan!'
        });
      }

      const log = await MaintenanceModel.getById(id);

      if (!log) {
        return res.status(404).json({
          success: false,
          message: `Maintenance log dengan id ${id} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Maintenance log berhasil diambil',
        data: log
      });
    } catch (error) {
      console.error('Error getMaintenanceById:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil maintenance log',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 4. Menambahkan maintenance log baru
  createMaintenance: async (req, res) => {
    try {
      const { jenis, estimasi, teknisi, pengawas, deskripsi, status, foto } = req.body;
      const mesin = req.body.mesin ?? req.body.unit ?? 'Unit tidak ditentukan';
      const idBox = req.body.idBox ?? req.body.id_box;

      if (typeof idBox !== 'string' || !idBox || idBox.length > 50 || typeof mesin !== 'string' || !mesin.trim() || mesin.length > 100 || typeof jenis !== 'string' || !jenis || jenis.length > 50 || [estimasi, teknisi, pengawas, deskripsi].some(v => typeof v !== 'string' || !v.trim()) || estimasi.length > 50 || teknisi.length > 100 || pengawas.length > 100 || deskripsi.length > 10000 || (status && (typeof status !== 'string' || status.length > 20)) || (foto && (typeof foto !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(foto) || foto.length > 7000000))) {
        return res.status(400).json({
          success: false,
          message: 'idBox, mesin, dan jenis wajib disertakan!'
        });
      }

      const newId = await MaintenanceModel.create({
        idBox,
        mesin,
        jenis,
        estimasi,
        teknisi,
        pengawas,
        deskripsi,
        status,
        foto
      });

      return res.status(201).json({
        success: true,
        message: 'Maintenance log berhasil ditambahkan',
        data: {
          id: newId,
          idBox,
          mesin,
          jenis,
          estimasi,
          teknisi,
          pengawas,
          deskripsi,
          status: status || 'pending',
          foto
        }
      });
    } catch (error) {
      console.error('Error createMaintenance:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menambahkan maintenance log',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 5. Memperbarui maintenance log
  updateMaintenance: async (req, res) => {
    try {
      const { id } = req.params;
      const { mesin, jenis, estimasi, teknisi, pengawas, deskripsi, status, foto } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Parameter id wajib disertakan!'
        });
      }

      // Cek apakah record ada
      const existingLog = await MaintenanceModel.getById(id);
      if (!existingLog) {
        return res.status(404).json({
          success: false,
          message: `Maintenance log dengan id ${id} tidak ditemukan`
        });
      }

      const updated = await MaintenanceModel.update(id, {
        mesin,
        jenis,
        estimasi,
        teknisi,
        pengawas,
        deskripsi,
        status,
        foto
      });

      if (!updated) {
        return res.status(500).json({
          success: false,
          message: 'Gagal memperbarui maintenance log'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Maintenance log berhasil diperbarui',
        data: {
          id,
          mesin,
          jenis,
          estimasi,
          teknisi,
          pengawas,
          deskripsi,
          status,
          foto
        }
      });
    } catch (error) {
      console.error('Error updateMaintenance:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal memperbarui maintenance log',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 6. Menghapus maintenance log
  deleteMaintenance: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Parameter id wajib disertakan!'
        });
      }

      // Cek apakah record ada
      const existingLog = await MaintenanceModel.getById(id);
      if (!existingLog) {
        return res.status(404).json({
          success: false,
          message: `Maintenance log dengan id ${id} tidak ditemukan`
        });
      }

      const deleted = await MaintenanceModel.delete(id);

      if (!deleted) {
        return res.status(500).json({
          success: false,
          message: 'Gagal menghapus maintenance log'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Maintenance log berhasil dihapus'
      });
    } catch (error) {
      console.error('Error deleteMaintenance:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menghapus maintenance log',
        error: 'REQUEST_FAILED'
      });
    }
  }
};

export default maintenanceController;
