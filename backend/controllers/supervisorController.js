import SupervisorModel from '../models/supervisorModel.js';

/**
 * Controller untuk mengelola Supervisor Team E-LOTO
 */
const supervisorController = {
  // 1. Mengambil seluruh supervisor team untuk box tertentu
  getTeamByBox: async (req, res) => {
    try {
      const { idBox } = req.params;

      if (!idBox) {
        return res.status(400).json({
          success: false,
          message: 'Parameter idBox wajib disertakan!'
        });
      }

      const team = await SupervisorModel.getTeamByBox(idBox);
      return res.status(200).json({
        success: true,
        message: `Supervisor team untuk box ${idBox} berhasil diambil`,
        data: team
      });
    } catch (error) {
      console.error('Error getTeamByBox:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil supervisor team',
        error: error.message
      });
    }
  },

  // 2. Mengambil semua team untuk supervisor tertentu
  getTeamBySupervisor: async (req, res) => {
    try {
      const { supervisorSid } = req.params;

      if (!supervisorSid) {
        return res.status(400).json({
          success: false,
          message: 'Parameter supervisorSid wajib disertakan!'
        });
      }

      const team = await SupervisorModel.getTeamBySupervisor(supervisorSid);
      return res.status(200).json({
        success: true,
        message: `Supervisor team untuk pengawas ${supervisorSid} berhasil diambil`,
        data: team
      });
    } catch (error) {
      console.error('Error getTeamBySupervisor:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil supervisor team',
        error: error.message
      });
    }
  },

  // 3. Menambahkan mechanic ke supervisor team
  addMechanicToTeam: async (req, res) => {
    try {
      const { supervisorSid, idBox, mechanicSid } = req.body;

      if (!supervisorSid || !idBox || !mechanicSid) {
        return res.status(400).json({
          success: false,
          message: 'supervisorSid, idBox, dan mechanicSid wajib disertakan!'
        });
      }

      const newId = await SupervisorModel.addMechanicToTeam(supervisorSid, idBox, mechanicSid);

      return res.status(201).json({
        success: true,
        message: 'Mekanik berhasil ditambahkan ke team pengawas',
        data: {
          id: newId,
          supervisorSid,
          idBox,
          mechanicSid
        }
      });
    } catch (error) {
      console.error('Error addMechanicToTeam:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menambahkan mekanik ke team pengawas',
        error: error.message
      });
    }
  },

  // 4. Menghapus mechanic dari supervisor team
  removeMechanicFromTeam: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: 'Parameter id wajib disertakan!'
        });
      }

      const deleted = await SupervisorModel.removeMechanicFromTeam(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: `Team member dengan id ${id} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Mekanik berhasil dihapus dari team pengawas'
      });
    } catch (error) {
      console.error('Error removeMechanicFromTeam:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menghapus mekanik dari team pengawas',
        error: error.message
      });
    }
  },

  // 5. Menghapus seluruh team untuk box tertentu
  deleteTeamByBox: async (req, res) => {
    try {
      const { idBox } = req.params;

      if (!idBox) {
        return res.status(400).json({
          success: false,
          message: 'Parameter idBox wajib disertakan!'
        });
      }

      const deletedCount = await SupervisorModel.deleteTeamByBox(idBox);

      return res.status(200).json({
        success: true,
        message: `${deletedCount} team member(s) berhasil dihapus untuk box ${idBox}`,
        data: { deletedCount }
      });
    } catch (error) {
      console.error('Error deleteTeamByBox:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal menghapus team box',
        error: error.message
      });
    }
  }
};

export default supervisorController;
