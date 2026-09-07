import api from './api';

/**
 * Service untuk mengelola komunikasi data Log Aktivitas & Riwayat Tap RFID
 */
const logService = {
  // Mengambil semua riwayat log aktivitas
  getAllLogs: async () => {
    const response = await api.get('/logs');
    return response.data;
  },

  // Menghapus log aktivitas
  deleteLog: async (id) => {
    const response = await api.delete(`/logs/${id}`);
    return response.data;
  },

  // Mengambil riwayat tap kartu RFID
  getTappingHistory: async (limit = 200) => {
    const response = await api.get('/logs/tapping-history', { params: { limit } });
    return response.data;
  },

  // Menghapus riwayat tap
  deleteTappingHistory: async (id, eventIds) => {
    const response = await api.delete(`/logs/tapping-history/${id}`, {
      data: { id, event_ids: eventIds }
    });
    return response.data;
  },

  // Mengambil data RFID buffer
  getRfidBuffer: async () => {
    const response = await api.get('/logs/buffer');
    return response.data;
  },

  // Menghapus item dari buffer
  deleteBuffer: async (id) => {
    const response = await api.delete(`/logs/buffer/${id}`);
    return response.data;
  },

  // People Counting
  getLatestPeopleCount: async (idBox) => {
    const response = await api.get(`/logs/people-counting/${encodeURIComponent(idBox)}`);
    return response.data;
  },

  getPeopleCountHistory: async (idBox, limit = 20) => {
    const response = await api.get(`/logs/people-counting/${encodeURIComponent(idBox)}/history`, { params: { limit } });
    return response.data;
  }
};

export default logService;
