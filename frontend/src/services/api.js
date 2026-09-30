import axios from 'axios';

export const normalizeApiBaseUrl = value => {
  const base = String(value || '/api').trim().replace(/\/+$/, '');
  if (!base) return '/api';
  return base === '/api' || /\/api$/i.test(base) ? base : `${base}/api`;
};

// The deployed frontend may point VITE_API_URL either at the API origin or at
// its /api prefix. Normalize both forms so every FE service has one contract.
export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env?.VITE_API_URL);
let csrfToken = '';
let sessionVersion = 0;
let authPending = false;
export const getSessionVersion = () => sessionVersion;
export const beginAuthChange = () => { authPending = true; return ++sessionVersion; };
export const cancelAuthChange = version => {
  if (version === sessionVersion) { authPending = false; sessionVersion++; }
};
export const setCsrfToken = token => { csrfToken = token || ''; authPending = false; sessionVersion++; };
const api = axios.create({ baseURL: API_BASE_URL, timeout: 10000, withCredentials: true });
api.interceptors.request.use(config => {
  config.sessionVersion = sessionVersion;
  if (!['get', 'head', 'options'].includes(config.method) && csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
  return config;
});
api.interceptors.response.use(response => response, error => {
  if (error.response?.status === 401 && !error.config?.url?.endsWith('/login') &&
      !authPending && error.config?.sessionVersion === sessionVersion) {
    setCsrfToken('');
    window.dispatchEvent(new Event('eloto-session-expired'));
  }
  return Promise.reject(error);
});
export default api;
