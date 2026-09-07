import api from './api';

/**
 * Service untuk mengelola komunikasi data Box/Unit E-LOTO
 */
const boxService = {
  // Mengambil semua data box
  getAllBoxes: async () => {
    const response = await api.get('/boxes');
    return response.data;
  },

  // Menambahkan box baru
  createBox: async (boxData) => {
    const response = await api.post('/boxes', boxData);
    return response.data;
  },

  // Memperbarui data box
  updateBox: async (idBox, boxData) => {
    const response = await api.put(`/boxes/${encodeURIComponent(idBox)}`, boxData);
    return response.data;
  },

  // Menghapus box
  deleteBox: async (idBox) => {
    const response = await api.delete(`/boxes/${encodeURIComponent(idBox)}`);
    return response.data;
  },

  // Mengambil semua maintenance log
  getAllMaintenance: async () => {
    const response = await api.get('/maintenance');
    return response.data;
  },

  // Membuat maintenance log baru
  createMaintenance: async (maintenanceData) => {
    const response = await api.post('/maintenance', maintenanceData);
    return response.data;
  },

  // Menghapus maintenance log
  deleteMaintenance: async (id) => {
    const response = await api.delete(`/maintenance/${id}`);
    return response.data;
  }
};

export default boxService;
