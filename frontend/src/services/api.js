import axios from 'axios';

/**
 * Konfigurasi Utama Axios Client untuk E-LOTO Platform
 */
const api = axios.create({
  // Alamat URL server backend Express kita
  baseURL: 'http://localhost:5002/api',
  timeout: 10000, // Batas waktu tunggu permintaan: 10 detik
  headers: {
    'Content-Type': 'application/json',
  },
});

// Penanganan pencegahan galat jaringan secara global
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Log galat ke konsol peramban agar mudah dilacak
    console.error('API Request Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;