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

[frontend/.env.example](../frontend/.env.example) dan [frontend/.env.production](../frontend/.env.production) memakai `VITE_API_URL=/api`. Variabel Vite dimasukkan saat build dan dapat dibaca browser: jangan menyimpan token perangkat, password database, atau rahasia lain di sana. Perubahan konfigurasi build memerlukan build ulang.

## Counting

Salin [contoh environment counting](../counting/.env.example) ke `counting/.env`. Launcher `pnpm dev` dan `pnpm dev:counting` memuat file tersebut otomatis; environment yang sudah diexport mendapat prioritas. Launcher memakai `counting/.venv` bila tersedia, atau Python sistem. `ELOTO_PYTHON` dapat menentukan executable Python lain. Menjalankan script Python langsung tetap memerlukan environment yang diexport. ID boks harus persis sama dengan database dan pemetaan backend, termasuk spasi.

| Variabel | Perilaku |
| --- | --- |
| `ELOTO_API_URL` | Base API termasuk `/api`; default `http://localhost:5002/api` |
| `ELOTO_BOX_ID` | Default `BOX ELOTO 1` |
| `ELOTO_DEVICE_TOKEN` | Wajib, token boks yang sudah diprovision |
| `ELOTO_RTSP_URL` | Wajib, URL kamera termasuk kredensial bila diperlukan |
| `ELOTO_MJPEG_PORT` | Default `8081`; harus sesuai `MJPEG_PORTS` backend |
| `ELOTO_HEADLESS` | `1` untuk tanpa jendela lokal; default `1` |
| `ELOTO_SYNC_INTERVAL` | Detik sinkronisasi, default 5, minimum 2 |
| `ELOTO_MODEL` | Path/model YOLO, default `yolo11n.pt` |
| `ELOTO_CONF` | Ambang confidence, default `0.5` |
| `ELOTO_ROI` | Koordinat ROI opsional; lihat parser pada worker sebelum mengisi |

Dari root repository, siapkan environment Python terpisah:

```bash
python3 -m venv counting/.venv
source counting/.venv/bin/activate
python -m pip install -r counting/requirements.txt
# Isi counting/.env sebelum menjalankan worker.
pnpm dev:counting
# Atau jalankan frontend, backend, dan counting sekaligus: pnpm dev
```

Dependency Python, model, ROI, dan dukungan GPU perlu divalidasi pada mesin target. Tes unit counting tidak menjalankan pipeline kamera/model. Jangan memakai URL kamera contoh sebagai kredensial nyata.

Jika URL kamera atau token belum lengkap, launcher melewati counting dengan pesan `Belum diaktifkan` dan exit sukses; web/backend tetap dapat berjalan. Setelah konfigurasi diisi, jalankan `pnpm dev:counting` atau restart `pnpm dev`.

## ESP32

`config.txt` sekarang opsional untuk firmware production BiznetGIO. Jika file itu tidak ada, firmware memakai Wi-Fi, ID boks, dan token dari header rahasia lokal saat proses upload, serta URL VPS dan root CA yang tertanam di firmware. Kartu SD tetap dipakai untuk data lokal seperti pengguna, sesi, dan log.

Header lokal berikut sudah diabaikan Git; isi di komputer yang dipakai untuk meng-upload firmware:

- `esp32/ELOTO_FIXED/network_secrets.local.h`: `ELOTO_NETWORK_SSID` dan `ELOTO_NETWORK_PASSWORD`.
- `esp32/ELOTO_FIXED/device_secrets.override.h`: `ELOTO_DEVICE_ID`.
- `esp32/ELOTO_FIXED/device_secrets.profile.h`: `ELOTO_DEVICE_TOKEN`.

Pastikan nilai itu valid sebelum upload. Firmware memakai satu profil Wi-Fi dari header. Jika ingin beberapa profil Wi-Fi, mengganti server, atau mengganti CA, salin format [esp32/config.example.txt](../esp32/config.example.txt) sebagai `/config.txt` pada SD:

| Kunci / file | Fungsi |
| --- | --- |
| `WIFI_1_SSID` … `WIFI_5_SSID` dan `WIFI_1_PASS` … `WIFI_5_PASS` | Hingga lima profil Wi-Fi; perangkat mencoba profil berurutan dan pindah setelah timeout. Format lama `SSID`/`PASS` tetap didukung; nilai contoh seperti `your-...` diabaikan. ESP32 hanya mendukung Wi-Fi 2,4 GHz |
| `SERVER` | Opsional override endpoint; default production `https://103.197.188.61`. LAN tepercaya: `http://192.168.1.10:5002` |
| `TOKEN` | Opsional override token asli untuk boks yang telah diprovision |
| `/server_ca.pem` | Opsional override root CA TLS. Default production memakai ISRG Root X1 yang tertanam di firmware |

`ELOTO_FIXED` memverifikasi sertifikat TLS dan handshake boks sebelum memakai API. Jam ESP32 harus tersinkron melalui NTP. Jangan mematikan verifikasi sertifikat. HTTP hanya diterima untuk host privat yang ditetapkan eksplisit. Langkah provisioning ada di [deployment](DEPLOYMENT.md).

Jangan commit nilai asli header lokal atau config SD. Karena revisi lama pernah memuat nilai perangkat/jaringan, rotasi token boks dan password Wi-Fi sebelum production; perubahan file tidak menghapus nilai dari riwayat Git.
