import { API_BASE_URL } from './api';

// Satu koneksi Server-Sent Events dipakai bersama semua panel dashboard.
// Saat box LOTO (atau pengguna lain) mengubah data, setiap panel langsung memuat ulang datanya.
const listeners = new Set();
let source = null;
let timer = null;
const COALESCE_MS = 300;
// Selama live tersambung, polling hanya cadangan (mis. mendeteksi box yang berhenti mengirim).
const LIVE_FALLBACK_MS = 15000;

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

export const isLiveConnected = () => typeof EventSource !== 'undefined' &&
  source?.readyState === EventSource.OPEN;

export function subscribeLive(listener) {
  listeners.add(listener);
  open();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) close();
  };
}

// Muat ulang saat ada perubahan live; polling `intervalMs` hanya dipakai bila live terputus,
// selain itu dijarangkan agar kuota request per pengguna tidak habis (HTTP 429).
export function livePoll(load, intervalMs) {
  let lastRun = Date.now();
  const run = () => { lastRun = Date.now(); return load(); };
  const interval = setInterval(() => {
    const due = isLiveConnected() ? LIVE_FALLBACK_MS : intervalMs;
    if (Date.now() - lastRun >= due - 50) run();
  }, intervalMs);
  const stopLive = subscribeLive(run);
  return () => { clearInterval(interval); stopLive(); };
}
