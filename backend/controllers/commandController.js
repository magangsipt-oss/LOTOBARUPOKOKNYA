import CommandModel from '../models/commandModel.js';

/**
 * Controller untuk mengelola Command Queue & Device Commands
 */
const commandController = {
  // 1. Set/Queue command untuk box
  setCommand: async (req, res) => {
    try {
      const { idBox, command, parameter } = req.body;

      if (!idBox || !command) {
        return res.status(400).json({
          success: false,
          message: 'idBox dan command wajib disertakan!'
        });
      }

      const isSet = await CommandModel.setCommand(idBox, command, parameter || '');

      if (!isSet) {
        return res.status(404).json({
          success: false,
          message: `Box dengan ID ${idBox} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: `Perintah ${command} berhasil dikirim ke antrean box ${idBox}`,
        data: { idBox, command, parameter }
      });
    } catch (error) {
      console.error('Error setCommand:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengirim perintah',
        error: error.message
      });
    }
  },

  // 2. Ambil pending command (digunakan device saat sync)
  getPendingCommand: async (req, res) => {
    try {
      const { idBox } = req.params;

      if (!idBox) {
        return res.status(400).json({
          success: false,
          message: 'Parameter idBox wajib disertakan!'
        });
      }

      const command = await CommandModel.getPendingCommand(idBox);

      return res.status(200).json({
        success: true,
        message: 'Pending command berhasil diambil',
        data: command
      });
    } catch (error) {
      console.error('Error getPendingCommand:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil pending command',
        error: error.message
      });
    }
  },

  // 3. Clear/consume command setelah device mengambilnya
  clearPendingCommand: async (req, res) => {
    try {
      const { idBox } = req.params;

      if (!idBox) {
        return res.status(400).json({
          success: false,
          message: 'Parameter idBox wajib disertakan!'
        });
      }

      const isCleared = await CommandModel.clearPendingCommand(idBox);

      if (!isCleared) {
        return res.status(404).json({
          success: false,
          message: `Box dengan ID ${idBox} tidak ditemukan`
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Pending command berhasil dibersihkan',
        data: { idBox }
      });
    } catch (error) {
      console.error('Error clearPendingCommand:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Gagal membersihkan pending command',
        error: error.message
      });
    }
  }
};

export default commandController;
