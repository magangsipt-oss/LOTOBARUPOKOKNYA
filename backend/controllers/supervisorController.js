import SupervisorModel from '../models/supervisorModel.js';

/**
 * Controller untuk mengelola Supervisor Team E-LOTO
 */
const supervisorController = {
  // 0a. GET /team?supervisor_sid=X&id_box=Y — Frontend compatibility
  getTeam: async (req, res) => {
    try {
      const { supervisor_sid, id_box } = req.query;

      if (!supervisor_sid || !id_box) {
        return res.status(400).json({
          success: false,
          message: 'Parameter supervisor_sid dan id_box wajib disertakan!'
        });
      }

      // Return team members as flat array of { sid } for frontend
      const team = await SupervisorModel.getTeamByBox(id_box);
      const members = team
        .filter(m => m.supervisor_sid === supervisor_sid)
        .map(m => ({ sid: m.mechanic_sid, id: m.id, maintenance_type: m.maintenance_type }));

      return res.status(200).json({
        success: true,
        message: `Tim mekanik untuk ${supervisor_sid} di ${id_box} berhasil diambil`,
        data: members
      });
    } catch (error) {
      console.error('Error getTeam:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil data tim',
        error: 'REQUEST_FAILED'
      });
    }
  },

  // 0b. POST /team — bulk save team members for a supervisor+box
  saveTeam: async (req, res) => {
    try {
      const { supervisor_sid, id_box, maintenance_type, mechanic_sids } = req.body;

      if (!supervisor_sid || !id_box) {
        return res.status(400).json({
          success: false,
          message: 'supervisor_sid dan id_box wajib disertakan!'
        });
      }

      if (!Array.isArray(mechanic_sids) || mechanic_sids.length > 100 || mechanic_sids.some(s => typeof s !== 'string' || !s || s.length > 50) || !['Mekanikal', 'Elektrikal', 'Hidrolik', 'Mekanikal & Elektrikal'].includes(maintenance_type || 'Mekanikal')) {
        return res.status(400).json({ success: false, message: 'Daftar mekanik atau jenis pemeliharaan tidak valid.' });
      }
      const count = await SupervisorModel.replaceTeam(supervisor_sid, id_box, [...new Set(mechanic_sids)], maintenance_type || 'Mekanikal');

      return res.status(201).json({
        success: true,
        message: `${count} mekanik berhasil ditugaskan ke ${id_box}`,
        data: { supervisor_sid, id_box, maintenance_type, mechanic_count: count }
      });
    } catch (error) {
      console.error('Error saveTeam:', error.message);
      return res.status(error.status || 500).json({
        success: false,
        message: 'Gagal menyimpan tim mekanik',
        error: 'REQUEST_FAILED'
      });
    }
  },

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
        error: 'REQUEST_FAILED'
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
        error: 'REQUEST_FAILED'
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
        error: 'REQUEST_FAILED'
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
        error: 'REQUEST_FAILED'
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
        error: 'REQUEST_FAILED'
      });
    }
  }
};

export default supervisorController;
