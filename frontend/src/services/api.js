import axios from 'axios';

export const normalizeApiBaseUrl = value => {
  const base = String(value || '/api').trim().replace(/\/+$/, '');
  if (!base) return '/api';
  return base === '/api' || /\/api$/i.test(base) ? base : `${base}/api`;
};

export const resolveApiBaseUrl = (value, appOrigin, production = false) => {
  const base = normalizeApiBaseUrl(value);
  if (!production) return base;
  let appUrl, apiUrl;
  try {
    appUrl = new URL(appOrigin);
    apiUrl = new URL(base, appUrl);
  } catch {
    throw new Error('Production API configuration must use a valid application origin.');
  }
  const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname);
  if (apiUrl.origin !== appUrl.origin || apiUrl.pathname.replace(/\/+$/, '') !== '/api' || apiUrl.search || apiUrl.hash ||
      (appUrl.protocol !== 'https:' && !localPreview)) {
    throw new Error('Production API must use the same HTTPS origin and /api path.');
  }
  return base;
};

// The deployed frontend may point VITE_API_URL either at the API origin or at
// its /api prefix. Normalize both forms so every FE service has one contract.
const appOrigin = typeof window === 'undefined' ? 'https://eloto.invalid' : window.location.origin;
export const API_BASE_URL = resolveApiBaseUrl(
  import.meta.env?.VITE_API_URL,
  appOrigin,
  import.meta.env?.PROD === true
);
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
