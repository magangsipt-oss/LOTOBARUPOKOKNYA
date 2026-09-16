import api from './api';

/**
 * Service untuk mengelola data Riwayat Pengisian BBM (Refueling)
 */
const refuelingService = {
  // Mengambil semua riwayat refueling
  getAll: async () => {
    const response = await api.get('/refueling');
    return response.data;
  },

  // Mengambil riwayat refueling untuk box tertentu
  getByBox: async (idBox) => {
    const response = await api.get(`/refueling/box/${encodeURIComponent(idBox)}`);
    return response.data;
  },

  // Memulai sesi refueling
  start: async ({ idBox, fuelmanUid, fuelmanName, latitude, longitude, isLotoActive }) => {
    const response = await api.post('/refueling/start', {
      idBox, fuelmanUid, fuelmanName, latitude, longitude, isLotoActive
    });
    return response.data;
  },

  // Mengakhiri sesi refueling
  end: async (id) => {
    const response = await api.patch(`/refueling/${id}`);
    return response.data;
  },

  // Menghapus riwayat refueling
  delete: async (id) => {
    const response = await api.delete(`/refueling/${id}`);
    return response.data;
  }
};

export default refuelingService;
