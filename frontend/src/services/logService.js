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

  // ===== BLE LOTO COMPLIANCE =====

  // Get latest compliance status for a box
  getLatestCompliance: async (idBox) => {
    const response = await api.get(`/loto/compliance/${encodeURIComponent(idBox)}`);
    return response.data;
  },

  // Get compliance history for a box
  getComplianceHistory: async (idBox, limit = 20) => {
    const response = await api.get(`/loto/compliance/${encodeURIComponent(idBox)}/history`, { params: { limit } });
    return response.data;
  },

  // Get active BLE presence for a box (recent detections)
  getActivePresence: async (idBox) => {
    const response = await api.get(`/loto/presence/${encodeURIComponent(idBox)}`);
    return response.data;
  },

  // BLE Tag management
  getAllBleTags: async () => {
    const response = await api.get('/loto/tags');
    return response.data;
  },

  registerBleTag: async (data) => {
    const response = await api.post('/loto/tags', data);
    return response.data;
  },

  updateBleTag: async (id, data) => {
    const response = await api.put(`/loto/tags/${id}`, data);
    return response.data;
  },

  deleteBleTag: async (id) => {
    const response = await api.delete(`/loto/tags/${id}`);
    return response.data;
  },

  // ===== LEGACY PEOPLE COUNTING (redirect to compliance) =====

  getLatestPeopleCount: async (idBox) => {
    const response = await api.get(`/loto/compliance/${encodeURIComponent(idBox)}`);
    return response.data;
  },

  getPeopleCountHistory: async (idBox, limit = 20) => {
    const response = await api.get(`/loto/compliance/${encodeURIComponent(idBox)}/history`, { params: { limit } });
    return response.data;
  }
};

export default logService;
