/**
 * Shared constants and helper functions for E-LOTO Platform
 */



export const STATE_DESC = {
  // Nama panjang (backend DB / frontend state)
  STATE_BOOT_IP: 'Menghubungkan boks ke jaringan Wi-Fi...',
  STATE_IDLE: 'Boks Standby. Tekan Tombol 1 di boks untuk memulai penguncian.',
  STATE_REGISTER_RFID: 'Mode Daftarkan Kartu Aktif! Tempelkan kartu di boks untuk membaca UID.',
  STATE_WAIT_SPV_IN: 'Menunggu Pengawas memindai kartu untuk membuka sesi.',
  STATE_SET_MEKANIK_COUNT: 'Pengawas sedang mengatur jumlah mekanik yang bekerja.',
  STATE_MEKANIK_IN: 'Mekanik dapat menempelkan kartu satu per satu untuk mulai bekerja.',
  STATE_LOTO_LOCKED_ACTIVE: 'Penguncian Aktif. Tekan Tombol 2 di boks jika ingin menambah mekanik atau keluar.',
  STATE_CHOOSE_ACTION: 'Menu Pilihan: Tekan 1 untuk Tambah Mekanik, Tekan 2 untuk Selesai/Keluar.',
  STATE_MEKANIK_OUT: 'Mekanik menempelkan kartu untuk keluar dari pekerjaan.',
  STATE_WAIT_SPV_OUT: 'Semua mekanik sudah keluar. Menunggu kartu Pengawas untuk menutup sesi.',
  STATE_MAINTENANCE_DONE: 'Pekerjaan selesai. Tekan Tombol 3 untuk membuka gembok.',
  STATE_RFID_DETECTED: 'Kartu RFID terdeteksi. Sistem sedang memeriksa identitas kartu.',
  STATE_RFID_VALID: 'Kartu RFID valid dan akses diterima.',
  STATE_MENU: 'Menu LOTO terbuka. Pilih tindakan dengan tombol perangkat.',
  STATE_EVENT_LOG: 'Daftar event perangkat sedang ditampilkan.',
  STATE_LOGOUT_DENIED: 'Logout ditolak karena kartu atau urutan stack tidak sesuai.',
  STATE_STACK_STATUS: 'Status stack personel sedang ditampilkan.',
  STATE_SERVER_OFFLINE: 'Server offline. Perangkat berjalan dalam mode lokal.',
  STATE_SYSTEM_ERROR: 'Perangkat mengalami error sistem. Periksa SD card dan sensor.',
  STATE_INITIALIZING: 'Perangkat sedang menginisialisasi ESP32, TFT, RFID, dan storage.',
  STATE_CONNECTING: 'Perangkat sedang menghubungkan diri ke jaringan.',
  STATE_SYSTEM_READY: 'Perangkat siap memulai proses E-LOTO.',
  STATE_COUNTDOWN: 'Persiapan penguncian sedang berjalan.',
  STATE_SUPERVISOR_VALID: 'RFID pengawas valid dan dapat melanjutkan proses.',
  STATE_MECHANIC_VALID: 'RFID mekanik valid dan terverifikasi.',
  STATE_ALL_WORKERS_REGISTERED: 'Semua pekerja berhasil terdaftar pada sesi ini.',
  STATE_LOGOUT_SUCCESS: 'Logout berhasil sesuai urutan FIFO.',
  STATE_ALL_WORKERS_OUT: 'Semua pekerja sudah keluar dari stack.',
  STATE_UNLOCKING: 'Gembok sedang dibuka.',
  STATE_SYSTEM_READY_FINAL: 'E-LOTO selesai dan sistem kembali siap digunakan.',
  // Nama abbreviated dari ESP32 (stateToString di .ino)
  BOOT_IP: 'Menghubungkan boks ke jaringan Wi-Fi...',
  IDLE_READY: 'Boks Standby. Tekan Tombol 1 di boks untuk memulai penguncian.',
  START_CONFIRM: 'Konfirmasi memulai sesi penguncian.',
  WAIT_SPV: 'Menunggu Pengawas memindai kartu untuk membuka sesi.',
  SET_QUOTA: 'Pengawas sedang mengatur jumlah mekanik yang bekerja.',
  MEK_IN: 'Mekanik dapat menempelkan kartu satu per satu untuk mulai bekerja.',
  LOCKED_ACTIVE: 'Penguncian Aktif. Semua mekanik sedang bekerja.',
  CHOOSE_ACT: 'Menu Pilihan: Keluar, Tambah Mekanik, atau Tambah Pengawas.',
  MEK_OUT: 'Mekanik menempelkan kartu untuk keluar dari pekerjaan.',
  SPV_OUT: 'Semua mekanik sudah keluar. Menunggu kartu Pengawas untuk menutup sesi.',
  SPV_OUT_CONFIRM: 'Konfirmasi keluar pengawas — gembok akan dibuka.',
  MAINT_DONE: 'Pekerjaan selesai. Unit aman digunakan.',
  REGISTER: 'Mode Daftarkan Kartu Aktif! Tempelkan kartu baru di boks.',
  WORKER_LIST: 'Daftar personel dalam sesi ini.',
  WORKER_DETAIL: 'Detail data personel yang dipilih.',
  RFID_DETECTED: 'Kartu RFID terdeteksi. Sistem sedang memeriksa identitas kartu.',
  RFID_VALID: 'Kartu RFID valid dan akses diterima.',
  MENU: 'Menu LOTO terbuka. Pilih tindakan dengan tombol perangkat.',
  EVENT_LOG: 'Daftar event perangkat sedang ditampilkan.',
  LOGOUT_DENIED: 'Logout ditolak karena kartu atau urutan stack tidak sesuai.',
  STACK_STATUS: 'Status stack personel sedang ditampilkan.',
  SERVER_OFFLINE: 'Server offline. Perangkat berjalan dalam mode lokal.',
  SYSTEM_ERROR: 'Perangkat mengalami error sistem. Periksa SD card dan sensor.',
  INITIALIZING: 'Perangkat sedang menginisialisasi ESP32, TFT, RFID, dan storage.',
  CONNECTING: 'Perangkat sedang menghubungkan diri ke jaringan.',
  SHOW_IP: 'IP Address ditampilkan. Hubungkan ke jaringan Wi-Fi.',
  SYSTEM_READY: 'Perangkat siap memulai proses E-LOTO.',
  COUNTDOWN: 'Persiapan penguncian sedang berjalan.',
  SUPERVISOR_VALID: 'RFID pengawas valid dan dapat melanjutkan proses.',
  MECHANIC_VALID: 'RFID mekanik valid dan terverifikasi.',
  ALL_WORKERS_REGISTERED: 'Semua pekerja berhasil terdaftar pada sesi ini.',
  LOGOUT_SUCCESS: 'Logout berhasil sesuai urutan FIFO.',
  ALL_WORKERS_OUT: 'Semua pekerja sudah keluar dari stack.',
  UNLOCKING: 'Gembok sedang dibuka.',
  SYSTEM_READY_FINAL: 'E-LOTO selesai dan sistem kembali siap digunakan.'
};

export const safeToFixed = (val, digits = 4) => {
  const num = Number(val);
  return isNaN(num) ? '0.0000' : num.toFixed(digits);
};

export const formatWaktuDowntime = (totalDetik) => {
  const seconds = Math.max(0, Number(totalDetik) || 0);
  const jam = Math.floor(seconds / 3600);
  const menit = Math.floor((seconds % 3600) / 60);
  const detik = seconds % 60;
  return [jam, menit, detik].map(value => String(value).padStart(2, '0')).join(':');
};

export const resolveProfilePhotoUrl = photo => {
  const value = String(photo || '').trim();
  const base = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  if (!value || value === 'assets/default-avatar.png') return 'assets/default-avatar.png';
  if (/^data:image\/(jpeg|png|webp);base64,/.test(value)) return value;
  if (value.startsWith('api/uploads/')) return `${base}/legacy-uploads/${value.slice(12)}`;
  if (value.startsWith('uploads/')) return `${base}/${value}`;
  if (/^[A-Za-z0-9_.-]+$/.test(value)) return `${base}/uploads/user_profiles/${value}`;
  return 'assets/default-avatar.png';
};

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const resolveUserPhotoUrl = (profile, fallbackPhoto) => {
  const uid = String(profile?.rfidUid || profile?.rfid_uid || profile?.uid || '').trim();
  if (uid) return `${import.meta.env.VITE_API_URL || '/api'}/users/photo/${encodeURIComponent(uid)}`;
  return resolveProfilePhotoUrl(fallbackPhoto || profile?.foto);
};

export const getInitialAvatar = (name) => {
  const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#fee2e2"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#b91c1c" font-family="Arial" font-size="34" font-weight="700">${escapeHtml(initials)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

export const isSystemUid = (uid) => {
  const value = String(uid || '').trim().toUpperCase();
  return !value || value === 'SYSTEM' || value === '—';
};

export const isAdminUid = (uid, userDatabase) => {
  return getUserProfile(uid, userDatabase).role === 'admin';
};

export const getUserProfile = (uid, userDatabase) => {
  const searchId = String(uid || '').split(':')[0].trim().toUpperCase();
  const user = userDatabase.find(item => {
    const rfid = String(item.rfidUid || item.rfid_uid || '').trim().toUpperCase();
    return (rfid && rfid === searchId) || String(item.sid || '').trim().toUpperCase() === searchId;
  });
  return user ? {
    nama: user.nama || 'Personel Tidak Dikenal',
    sid: user.sid || '—',
    role: user.role || 'teknisi',
    foto: user.foto || 'assets/default-avatar.png'
  } : { nama: `Kartu (${uid || '—'})`, sid: '—', role: 'teknisi', foto: 'assets/default-avatar.png' };
};

export const terjemahkanIdKeNamaLengkap = (idMentah, userDatabase) => {
  if (!idMentah || idMentah === '—' || idMentah === '') return '—';

  let searchId = String(idMentah).toUpperCase().trim();
  if (searchId.includes(':')) {
    searchId = searchId.split(':')[0].trim();
  }

  const hasilCari = userDatabase.find(u => {
    const uRfid = String(u.rfidUid || u.rfid_uid || '').toUpperCase().trim();
    const uSid = String(u.sid || '').toUpperCase().trim();
    return (uRfid !== '' && uRfid === searchId) || uSid === searchId;
  });

  return hasilCari ? `${hasilCari.nama} [${hasilCari.sid}]` : `Kartu (${idMentah})`;
};

export const normalizeUserRole = (role) => {
  const rLower = String(role || '').toLowerCase();
  if (rLower.includes('supervisor') || rLower.includes('pengawas') || rLower.includes('spv') || rLower.includes('k3')) return 'pengawas';
  if (rLower.includes('fuel') || rLower.includes('bbm') || rLower.includes('refuel')) return 'fuelman';
  if (rLower.includes('admin')) return 'admin';
  return 'teknisi';
};

export const safeCsvCell = value => {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
};
