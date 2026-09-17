import axios from 'axios';
let csrfToken = '';
let sessionVersion = 0;
let authPending = false;
export const getSessionVersion = () => sessionVersion;
export const beginAuthChange = () => { authPending = true; return ++sessionVersion; };
export const cancelAuthChange = version => {
  if (version === sessionVersion) { authPending = false; sessionVersion++; }
};
export const setCsrfToken = token => { csrfToken = token || ''; authPending = false; sessionVersion++; };
const api = axios.create({ baseURL: import.meta.env?.VITE_API_URL || '/api', timeout: 10000, withCredentials: true });
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
