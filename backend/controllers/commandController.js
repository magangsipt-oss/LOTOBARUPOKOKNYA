import CommandModel from '../models/commandModel.js';
export default {
  async setCommand(req, res, next) {
    try {
      const { idBox, command, parameter = '' } = req.body || {};
      // Only firmware-supported, non-actuating operations may be queued remotely.
      if (typeof idBox !== 'string' || !idBox || idBox.length > 50 || command !== 'SYNC_USERS' || parameter !== '') {
        return res.status(400).json({ success: false, message: 'Perintah tidak didukung. Hanya SYNC_USERS tanpa parameter yang tersedia.' });
      }
      const id = await CommandModel.setCommand(idBox, command, parameter);
      if (!id) return res.status(404).json({ success: false, message: 'Boks tidak ditemukan.' });
      res.status(201).json({ success: true, data: { id, idBox, command } });
    } catch (error) { next(error); }
  },
  async getPendingCommand(req, res, next) {
    try { res.json({ success: true, data: await CommandModel.getPendingCommand(req.params.idBox) }); } catch (error) { next(error); }
  },
  async clearPendingCommand(req, res, next) {
    try {
      const id = req.body?.commandId;
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return res.status(400).json({ success: false, message: 'commandId wajib diisi.' });
      const cleared = await CommandModel.clearPendingCommand(req.params.idBox, id);
      res.status(cleared ? 200 : 404).json({ success: cleared });
    } catch (error) { next(error); }
  }
};
