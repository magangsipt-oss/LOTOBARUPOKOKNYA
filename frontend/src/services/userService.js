import api from './api';

/**
 * Service untuk mengelola komunikasi data Pengguna & Verifikasi RFID
 */
const userService = {
  // Login pengguna
  login: async (sid, password) => {
    const response = await api.post('/users/login', { sid, password });
    return response.data;
  },

  // Mengambil semua data pengguna
  getAllUsers: async () => {
    const response = await api.get('/users');
    return response.data;
  },

  // Mengambil detail pengguna berdasarkan SID
  getUserBySid: async (sid) => {
    const response = await api.get(`/users/${encodeURIComponent(sid)}`);
    return response.data;
  },

  // Menambahkan pengguna baru
  createUser: async (userData) => {
    const isFormData = userData instanceof FormData;
    const config = isFormData
      ? { headers: { 'Content-Type': 'multipart/form-data' } }
      : {};
    const response = await api.post('/users', userData, config);
    return response.data;
  },

  // Memperbarui data pengguna
  updateUser: async (sid, userData) => {
    const isFormData = userData instanceof FormData;
    const config = isFormData
      ? { headers: { 'Content-Type': 'multipart/form-data' } }
      : {};
    const response = await api.put(`/users/${encodeURIComponent(sid)}`, userData, config);
    return response.data;
  },

  // Menghapus data pengguna
  deleteUser: async (sid) => {
    const response = await api.delete(`/users/${encodeURIComponent(sid)}`);
    return response.data;
  },

  // Mengambil tim supervisor
  getSupervisorTeam: async (supervisorSid, idBox) => {
    const response = await api.get('/supervisor/team', {
      params: { supervisor_sid: supervisorSid, id_box: idBox }
    });
    return response.data;
  },

  // Menyimpan tim mekanik
  saveSupervisorTeam: async (payload) => {
    const response = await api.post('/supervisor/team', payload);
    return response.data;
  }
};

export default userService;
