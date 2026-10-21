import { API_BASE_URL } from './api';

// Satu koneksi Server-Sent Events dipakai bersama semua panel dashboard.
// Saat box LOTO (atau pengguna lain) mengubah data, setiap panel langsung memuat ulang datanya.
// Polling berkala tetap berjalan sebagai cadangan bila koneksi live terputus.
const listeners = new Set();
let source = null;
let timer = null;
const COALESCE_MS = 300;

const notify = () => {
  // Gabungkan rentetan event (telemetri + presence) menjadi satu kali muat ulang.
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* panel lain tetap dimuat */ }
    }
  }, COALESCE_MS);
};

const open = () => {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource(`${API_BASE_URL.replace(/\/+$/, '')}/live`, { withCredentials: true });
  source.addEventListener('change', notify);
};

const close = () => {
  if (source) source.close();
  source = null;
  clearTimeout(timer);
  timer = null;
};

export function subscribeLive(listener) {
  listeners.add(listener);
  open();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) close();
  };
}
