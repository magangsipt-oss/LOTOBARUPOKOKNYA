# Konfigurasi

## Backend

Buat `backend/.env` dari [backend/.env.example](../backend/.env.example). Backend membaca file tersebut berdasarkan lokasinya. Isi rahasia lokal tanpa memasukkannya ke Git.

| Variabel | Nilai contoh / aturan |
| --- | --- |
| `NODE_ENV` | `development`; gunakan `production` pada deployment |
| `HOST`, `PORT` | `0.0.0.0`, `5002` untuk development agar ESP32 dapat masuk melalui LAN; `127.0.0.1` hanya untuk akses lokal/proxy |
| `FRONTEND_URL` | `http://localhost:3000`; wajib HTTPS pada production |
| `DB_HOST`, `DB_PORT` | Host MySQL, port `3306` |
| `DB_NAME` | Nama database yang telah dibuat |
| `DB_USER`, `DB_PASSWORD` | Akun database; production menolak user root dan password kosong |
| `TRUST_PROXY` | Production default `loopback`; ubah hanya bila topologi memakai proxy tepercaya lain |
| `MJPEG_PORTS` | JSON pemetaan ID boks ke port, misalnya `{"BOX ELOTO 1":8081}`; port 1024–65535 |

Gunakan akun DDL untuk migrasi dan akun dengan hak terbatas untuk runtime. Konfigurasi aplikasi/database memakai zona waktu `+08:00`.

## Frontend

[frontend/.env.example](../frontend/.env.example) dan [frontend/.env.production](../frontend/.env.production) memakai `VITE_API_URL=/api`. Variabel Vite dimasukkan saat build dan dapat dibaca browser: jangan menyimpan password database atau rahasia lain di sana. Perubahan konfigurasi build memerlukan build ulang.

## Counting

Counting tidak digunakan untuk alur ESP32 dan dashboard saat ini; tidak perlu menyiapkan `counting/.env` atau menjalankan `pnpm dev:counting`.

## ESP32

`config.txt` sekarang opsional untuk firmware production BiznetGIO. Jika file itu tidak ada, firmware memakai Wi-Fi dan ID boks dari header lokal serta URL VPS dan root CA yang tertanam di firmware. Token perangkat tidak lagi digunakan atau disimpan di SD/NVS. Kartu SD tetap dipakai untuk data lokal seperti pengguna, sesi, dan log.

Header lokal berikut sudah diabaikan Git; isi di komputer yang dipakai untuk meng-upload firmware:

- `esp32/ELOTO_FIXED/network_secrets.local.h`: `ELOTO_NETWORK_SSID` dan `ELOTO_NETWORK_PASSWORD`.
- `esp32/ELOTO_FIXED/device_secrets.override.h`: `ELOTO_DEVICE_ID`.

Pastikan nilai itu valid sebelum upload. Firmware memakai satu profil Wi-Fi dari header. Jika ingin beberapa profil Wi-Fi, mengganti server, atau mengganti CA, salin format [esp32/config.example.txt](../esp32/config.example.txt) sebagai `/config.txt` pada SD:

| Kunci / file | Fungsi |
| --- | --- |
| `WIFI_1_SSID` … `WIFI_5_SSID` dan `WIFI_1_PASS` … `WIFI_5_PASS` | Hingga lima profil Wi-Fi; perangkat mencoba profil berurutan dan pindah setelah timeout. Format lama `SSID`/`PASS` tetap didukung; nilai contoh seperti `your-...` diabaikan. ESP32 hanya mendukung Wi-Fi 2,4 GHz |
| `SERVER` | Opsional override endpoint; default production `https://103.197.188.61`. LAN tepercaya: `http://192.168.1.10:5002` |
| `/server_ca.pem` | Opsional override root CA TLS. Default production memakai ISRG Root X1 yang tertanam di firmware |

Firmware `ELOTO_FIXED` terbaru memverifikasi sertifikat TLS dan handshake boks sebelum memakai API. Setiap request otomatis mengirim IP lokal ESP32; daftarkan IP yang sama di dashboard dan gunakan reservasi DHCP supaya IP tetap. Tidak ada provisioning token dan tidak perlu mengubah SD untuk token. Jam ESP32 harus tersinkron melalui NTP. Jangan mematikan verifikasi sertifikat. HTTP hanya diterima untuk host privat yang ditetapkan eksplisit. Langkah setup ada di [deployment](DEPLOYMENT.md).

Jangan commit nilai asli header lokal atau config SD. Karena revisi lama pernah memuat nilai perangkat/jaringan, ubah password Wi-Fi sebelum production; perubahan file tidak menghapus nilai dari riwayat Git.
