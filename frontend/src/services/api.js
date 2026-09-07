import axios from 'axios';
import { API_SECRET_TOKEN } from '../utils/helpers';

/**
 * Konfigurasi Utama Axios Client untuk E-LOTO Platform
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5002/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache'
  }
});

// Suntikkan token otentikasi ke setiap permintaan
api.interceptors.request.use((config) => {
  config.headers['Authorization'] = `Bearer ${API_SECRET_TOKEN}`;
  config.headers['X-Device-Token'] = API_SECRET_TOKEN;
  return config;
});

// Penanganan pencegahan galat jaringan secara global
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Request Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export default api;
