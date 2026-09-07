import api from './api';

/**
 * Service untuk mengelola komunikasi data Log Aktivitas & Riwayat Tap RFID
 */
const logService = {
  // 1. Mengambil semua riwayat log aktivitas LOTO
  getAllLogs: async () => {
    const response = await api.get('/logs');
    return response.data;
  },

  // 2. Mencatat aktivitas log baru
  createLog: async (logData) => {
    // logData berisi: { box_id, user_id, action, status_before, status_after, notes }
    const response = await api.post('/logs', logData);
    return response.data;
  },

  // 3. Menghapus satu log aktivitas berdasarkan ID
  deleteLog: async (id) => {
    const response = await api.delete(`/logs/${id}`);
    return response.data;
  },

  // 4. Menghapus seluruh riwayat log aktivitas (Clear Logs)
  clearAllLogs: async () => {
    const response = await api.delete('/logs/clear');
    return response.data;
  },

  // 5. Mengambil riwayat tap kartu RFID terbaru
  getTappingHistory: async () => {
    const response = await api.get('/logs/tapping-history');
    return response.data;
  },

  // 6. Mencatat riwayat tap kartu RFID baru
  createTapping: async (tapData) => {
    // tapData berisi: { rfid_uid, id_box, event_type }
    const response = await api.post('/logs/tapping', tapData);
    return response.data;
  },

  // 7. Menghapus seluruh riwayat tap kartu RFID
  clearTappingHistory: async () => {
    const response = await api.delete('/logs/tapping-history/clear');
    return response.data;
  },

  // 8. Mengambil semua data RFID buffer
  getAllRfidBuffer: async () => {
    const response = await api.get('/events/buffer');
    return response.data;
  },

  // 9. Mengambil RFID buffer berdasarkan box
  getBufferByBox: async (idBox) => {
    const response = await api.get(`/events/buffer/box/${idBox}`);
    return response.data;
  },

  // 10. Menambah data ke RFID buffer
  addToBuffer: async (payload) => {
    const response = await api.post('/events/buffer', payload);
    return response.data;
  },

  // 11. Menghapus satu item dari RFID buffer
  removeFromBuffer: async (id) => {
    const response = await api.delete(`/events/buffer/${id}`);
    return response.data;
  },

  // 12. Menghapus buffer berdasarkan box
  clearBufferByBox: async (idBox) => {
    const response = await api.delete(`/events/buffer/box/${idBox}/clear`);
    return response.data;
  },

  // 13. Mengambil semua audit log
  getAllAuditLogs: async () => {
    const response = await api.get('/events/logs');
    return response.data;
  },

  // 14. Mengambil audit log per box
  getAuditLogsByBox: async (idBox) => {
    const response = await api.get(`/events/logs/box/${idBox}`);
    return response.data;
  },

  // 15. Menambahkan audit log baru
  createAuditLog: async (payload) => {
    const response = await api.post('/events/logs', payload);
    return response.data;
  },

  // 16. Menghapus audit log tertentu
  deleteAuditLog: async (id) => {
    const response = await api.delete(`/events/logs/${id}`);
    return response.data;
  },

  // 17. Membersihkan audit log lama
  deleteOldAuditLogs: async () => {
    const response = await api.delete('/events/logs/old/cleanup');
    return response.data;
  },

  // 18. Mengirim command ke perangkat
  setCommand: async (commandData) => {
    const response = await api.post('/commands', commandData);
    return response.data;
  },

  // 19. Mengambil pending command perangkat
  getPendingCommand: async (idBox) => {
    const response = await api.get(`/commands/${idBox}/pending`);
    return response.data;
  },

  // 20. Menghapus pending command setelah perangkat menerima
  clearPendingCommand: async (idBox) => {
    const response = await api.patch(`/commands/${idBox}/clear`);
    return response.data;
  }
};

export default logService;