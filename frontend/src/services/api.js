import axios from 'axios';
let csrfToken = '';
export const setCsrfToken = token => { csrfToken = token || ''; };
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', timeout: 10000, withCredentials: true });
api.interceptors.request.use(config => {
  if (!['get', 'head', 'options'].includes(config.method) && csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
  return config;
});
api.interceptors.response.use(response => response, error => {
  if (error.response?.status === 401 && !error.config?.url?.endsWith('/login')) {
    csrfToken = '';
    window.dispatchEvent(new Event('eloto-session-expired'));
  }
  return Promise.reject(error);
});
export default api;
