import RefuelingModel from '../models/refuelingModel.js';

/**
 * Controller untuk mengelola Refueling Logs E-LOTO
 */
const refuelingController = {
  // 1. Mengambil semua refueling logs
  getAllRefueling: async (req, res) => {
    try {
      const logs = await RefuelingModel.getAll();
      return res.status(200).json({
        success: true,
        message: 'Data seluruh refueling logs berhasil diambil',
        data: logs
      });
    } catch (error) {
      console.error('Error getAllRefueling:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil data refueling logs',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 2. Mengambil refueling logs untuk box tertentu
  getRefuelingByBox: async (req, res) => {
    try {
      const { idBox } = req.params;

      if (!idBox) {
        return res.status(400).json({
          success: false,
          message: 'Parameter idBox wajib disertakan!'
        });
      }

      const logs = await RefuelingModel.getByIdBox(idBox);
      return res.status(200).json({
        success: true,
        message: `Refueling logs untuk box ${idBox} berhasil diambil`,
        data: logs
      });
    } catch (error) {
      console.error('Error getRefuelingByBox:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil refueling logs',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 3. Memulai sesi refueling
  startRefueling: async (req, res) => {
    try {
      const { idBox, fuelmanUid, fuelmanName, latitude, longitude, isLotoActive } = req.body;

      if (!idBox || !fuelmanUid) {
        return res.status(400).json({
          success: false,
          message: 'idBox dan fuelmanUid wajib disertakan!'
        });
      }

      const newId = await RefuelingModel.startRefueling({
        idBox,
        fuelmanUid,
        fuelmanName,
        latitude,
        longitude,
        isLotoActive
      });

      return res.status(201).json({
        success: true,
        message: 'Sesi refueling berhasil dimulai',
        data: {
          id: newId,
          idBox,
          fuelmanUid,
          fuelmanName,
          latitude,
          longitude,
          isLotoActive: isLotoActive ? 1 : 0
        }
      });
    } catch (error) {
      console.error('Error startRefueling:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal memulai sesi refueling',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 4. Mengakhiri sesi refueling
  endRefueling: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Parameter id wajib disertakan!'
        });
      }

      const updated = await RefuelingModel.endRefueling(id);

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: `Refueling log dengan id ${id} tidak ditemukan atau sudah selesai`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Sesi refueling berhasil diakhiri'
      });
    } catch (error) {
      console.error('Error endRefueling:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengakhiri sesi refueling',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 5. Menghapus refueling log
  deleteRefueling: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Parameter id wajib disertakan!'
        });
      }

      const deleted = await RefuelingModel.delete(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: `Refueling log dengan id ${id} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Refueling log berhasil dihapus'
      });
    } catch (error) {
      console.error('Error deleteRefueling:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menghapus refueling log',
        error: 'REQUEST_FAILED'
      });
    }
  }
};

export default refuelingController;
