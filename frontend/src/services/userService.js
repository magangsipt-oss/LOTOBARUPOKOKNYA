import api from './api';

/**
 * Service untuk mengelola komunikasi data Pengguna & Verifikasi RFID
 */
const userService = {
  // 1. Mengambil semua data pengguna (pekerja & supervisor)
  getAllUsers: async () => {
    const response = await api.get('/users');
    return response.data;
  },

  // 2. Mengambil detail pengguna berdasarkan SID (Student ID)
  getUserBySid: async (sid) => {
    const response = await api.get(`/users/${sid}`);
    return response.data;
  },

  // 3. Mengambil daftar supervisor saja
  getSupervisors: async () => {
    const response = await api.get('/users/supervisors');
    return response.data;
  },

  // 4. Memverifikasi nomor kartu RFID saat tap kartu
  checkCard: async (rfidUid) => {
    const response = await api.post('/users/check-card', { rfid_uid: rfidUid });
    return response.data;
  },

  // 5. Menambahkan pengguna baru (mendukung pengiriman teks dan file foto profil)
  createUser: async (userData) => {
    // Jika data berupa FormData (ada unggahan file foto)
    const isFormData = userData instanceof FormData;
    const config = isFormData
      ? { headers: { 'Content-Type': 'multipart/form-data' } }
      : {};

    const response = await api.post('/users', userData, config);
    return response.data;
  },

  // 6. Memperbarui data pengguna berdasarkan SID
  updateUser: async (sid, userData) => {
    const isFormData = userData instanceof FormData;
    const config = isFormData
      ? { headers: { 'Content-Type': 'multipart/form-data' } }
      : {};

    const response = await api.put(`/users/${sid}`, userData, config);
    return response.data;
  },

  // 7. Menghapus data pengguna dari sistem
  deleteUser: async (sid) => {
    const response = await api.delete(`/users/${sid}`);
    return response.data;
  },

  // 8. Mengambil tim supervisor berdasarkan box
  getTeamByBox: async (idBox) => {
    const response = await api.get(`/supervisor/box/${idBox}`);
    return response.data;
  },

  // 9. Mengambil tim supervisor untuk supervisor tertentu
  getTeamBySupervisor: async (supervisorSid) => {
    const response = await api.get(`/supervisor/supervisor/${supervisorSid}`);
    return response.data;
  },

  // 10. Menambahkan mekanik ke tim pengawas
  addMechanicToTeam: async (payload) => {
    const response = await api.post('/supervisor/add', payload);
    return response.data;
  },

  // 11. Menghapus mekanik dari tim
  removeMechanicFromTeam: async (id) => {
    const response = await api.delete(`/supervisor/${id}`);
    return response.data;
  },

  // 12. Menghapus seluruh tim pada box tertentu
  deleteTeamByBox: async (idBox) => {
    const response = await api.delete(`/supervisor/box/${idBox}/clear`);
    return response.data;
  }
};

export default userService;