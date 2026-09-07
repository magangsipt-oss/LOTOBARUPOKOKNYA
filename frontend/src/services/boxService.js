import api from './api';

/**
 * Service untuk mengelola komunikasi data Box/Unit E-LOTO
 */
const boxService = {
  // 1. Mengambil semua data box
  getAllBoxes: async () => {
    const response = await api.get('/boxes');
    return response.data;
  },

  // 2. Mengambil detail box berdasarkan ID Box
  getBoxById: async (idBox) => {
    const response = await api.get(`/boxes/${idBox}`);
    return response.data;
  },

  // 3. Menambahkan box baru ke sistem
  createBox: async (boxData) => {
    const response = await api.post('/boxes', boxData);
    return response.data;
  },

  // 4. Memperbarui informasi box
  updateBox: async (idBox, boxData) => {
    const response = await api.put(`/boxes/${idBox}`, boxData);
    return response.data;
  },

  // 5. Menghapus box dari sistem
  deleteBox: async (idBox) => {
    const response = await api.delete(`/boxes/${idBox}`);
    return response.data;
  },

  // 6. Mengubah state box (IDLE, LOCKED, dll)
  updateBoxState: async (idBox, state) => {
    const response = await api.patch(`/boxes/${idBox}/state`, { state });
    return response.data;
  },

  // 7. Memperbarui telemetri/hardware status dari ESP32
  updateTelemetry: async (idBox, telemetryData) => {
    const response = await api.post(`/boxes/${idBox}/telemetry`, telemetryData);
    return response.data;
  },

  // 8. Mengambil semua maintenance log
  getAllMaintenance: async () => {
    const response = await api.get('/maintenance');
    return response.data;
  },

  // 9. Mengambil maintenance log untuk box tertentu
  getMaintenanceByBox: async (idBox) => {
    const response = await api.get(`/maintenance/box/${idBox}`);
    return response.data;
  },

  // 10. Mengambil satu maintenance log berdasarkan ID
  getMaintenanceById: async (id) => {
    const response = await api.get(`/maintenance/${id}`);
    return response.data;
  },

  // 11. Membuat maintenance log baru
  createMaintenance: async (maintenanceData) => {
    const response = await api.post('/maintenance', maintenanceData);
    return response.data;
  },

  // 12. Memperbarui maintenance log
  updateMaintenance: async (id, maintenanceData) => {
    const response = await api.put(`/maintenance/${id}`, maintenanceData);
    return response.data;
  },

  // 13. Menghapus maintenance log
  deleteMaintenance: async (id) => {
    const response = await api.delete(`/maintenance/${id}`);
    return response.data;
  },

  // 14. Mengambil semua refueling log
  getAllRefueling: async () => {
    const response = await api.get('/refueling');
    return response.data;
  },

  // 15. Mengambil refueling log untuk box tertentu
  getRefuelingByBox: async (idBox) => {
    const response = await api.get(`/refueling/box/${idBox}`);
    return response.data;
  },

  // 16. Memulai sesi refueling
  startRefueling: async (payload) => {
    const response = await api.post('/refueling/start', payload);
    return response.data;
  },

  // 17. Mengakhiri sesi refueling
  endRefueling: async (id, payload = {}) => {
    const response = await api.patch(`/refueling/${id}`, payload);
    return response.data;
  },

  // 18. Menghapus refueling log
  deleteRefueling: async (id) => {
    const response = await api.delete(`/refueling/${id}`);
    return response.data;
  }
};

export default boxService;