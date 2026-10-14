# ✅ UPLOAD CHECKLIST - Semua Sudah Sinkron!

## Status Sinkronisasi

| Komponen | Status | Detail |
|----------|--------|--------|
| Database | ✅ OK | Box & Users sudah ada |
| Backend API | ✅ OK | Semua endpoint works |
| ESP32 Config | ✅ OK | Match dengan database |
| Telemetry | ✅ OK | Box ONLINE |
| RFID Check | ✅ OK | Supervisor & Mechanic terdeteksi |

## Yang Sudah Disinkronkan

### 1. Database
```
Box: ELOTO BOX 1
  ├── IP: 192.168.137.176
  ├── Device ID: ✅ Cocok
  └── Status: ONLINE

Users (9 personel):
  ├── SPV001 | Budi Santoso | PENGAWAS | RFID: 9D88FA1200
  ├── SPV002 | Eltha Putri | PENGAWAS | RFID: 3C001E9494
  ├── MEK001 | Agus Prayitno | WORKER | RFID: 1A2B3C4D5E
  ├── MEK002 | Rahmat Hidayat | WORKER | RFID: F4E5D6C7B8
  ├── MEK003 | Joko Widodo | WORKER | RFID: A1B2C3D4E5
  ├── MEK004 | Andi Saputra | WORKER | RFID: 3E0028F54F
  ├── MEK005 | Rizki Pratama | WORKER | RFID: 3D001266BB
  ├── FUL001 | Dedi Kurniawan | FUELMAN | RFID: 3C00035095
  └── FUL002 | Hendra Wijaya | FUELMAN | RFID: 3E0027D5B2
```

### 2. Backend API (Port 5002)
```
✅ POST /api/boxes/:id/telemetry    → Terima data ESP32
✅ POST /api/users/check-card       → Verifikasi kartu RFID
✅ GET  /api/users                  → Daftar semua user
✅ GET  /api/users/photo/:uid       → Ambil foto user
✅ GET  /api/boxes                  → Data box untuk dashboard
```

### 3. ESP32 Config (default di code)
```
device_id   = "ELOTO BOX 1"        ← Match database ✓
wifi_ssid   = "your-wifi-network"  ← WiFi target
wifi_pass   = "<wifi-password>"    ← Simpan hanya di SD
server_host = "192.168.137.1:5002" ← Backend address ✓
```

### 4. SD Card Config (config.txt)
```
SSID=your-wifi-network
PASS=replace-with-wifi-password
SERVER=http://192.168.137.1:5002
DEVICE_ID=ELOTO BOX 1
```

## Yang Perlu Anda Lakukan

### Step 1: Copy config.txt ke SD Card
Copy file dari: `esp32/SD_CARD_CONFIG/config.txt`
Ke SD Card: `/config.txt`

### Step 2: Upload Firmware ESP32
1. Buka sketch aktif `esp32/ELOTO_FIXED/ELOTO_FIXED.ino` di Arduino IDE
2. Pilih board **ESP32 Dev Module**
3. Buka **Tools → Partition Scheme** dan pilih **Minimal SPIFFS (1.9MB APP with OTA/128KB SPIFFS)**. Firmware melebihi ukuran partisi default 1.2MB; opsi ini menyediakan partisi aplikasi lebih besar dan tetap mempertahankan OTA. Foto/personel disimpan di SD card, bukan SPIFFS.
4. Klik **Upload**
5. Tunggu sampai selesai

### Step 3: Restart ESP32
Setelah upload, restart ESP32.

### Step 4: Verifikasi firmware dan sinkronisasi SD di Serial Monitor
Pastikan firmware yang baru di-upload mencetak penanda berikut:
```
[BUILD] ELOTO_FIXED AUTH=GPS_EARLY_ACQUISITION_V27 SD_STARTUP_RETRY_V31 SD_HANDSHAKE_DIAG_V32 SD_RELAY_QUIESCE_V37 COUNTDOWN_DISPLAY_V37 LCD_PHOTO_COVER_V1
```
Saat online, backend memverifikasi kartu; cache lokal dipakai ketika Wi-Fi/backend tidak dapat dijangkau, tetapi kartu yang dinyatakan tidak terdaftar oleh backend tetap ditolak. Setelah personel dibuat/diubah dari dashboard, perintah `SYNC_USERS` meminta box menyinkronkan daftar dan foto secara langsung (poll hingga 3 detik); sinkronisasi berkala menjadi cadangan. Foto diunduh di task latar dan disimpan ke `/foto/<SID>.jpg` (atau nama berbasis UID), sehingga tapping tidak menunggu unduhan. Foto yang tersimpan dapat ditampilkan dan digunakan saat offline.
Mount SD mencoba SPI 1 MHz, 400 kHz, lalu 100 kHz dan mencatat hasil setiap percobaan. Firmware tidak memformat kartu.
Saat backend dan SD siap, alat memperbarui `users.csv` dan menjadwalkan cache foto personel. Foto disimpan transaksional memakai SID valid sebagai nama FAT 8.3 (`/foto/<SID>.jpg`) dengan file staging/cadangan (`.TMP`/`.BAK`), sedangkan UID dipakai untuk meminta foto dari backend. LCD mengulang percobaan tampil tiap 10 detik selama foto belum berhasil dirender; file JPEG hingga 60 KB diterima. Periksa log `[PHOTO_SYNC] ... saved=1` dan folder `foto` untuk memastikan file berhasil disimpan. Tanpa SD yang terpasang dan dapat ditulis, cache foto offline tidak tersedia.
Pesan `[SD] Read/write test passed` hanya memastikan tes dasar SD lulus; itu sendiri tidak
membuktikan data dan foto berhasil tersinkron.
Jangan membuat `users.csv` atau file `.TMP` secara manual. Jika sinkronisasi gagal,
simpan seluruh baris `[SD_SYNC]`, `[PHOTO_SYNC]`, `[SD_LOCK]`, dan pesan `[SD]` untuk diagnosis.
Timeout `[SD_LOCK]` kini juga mencatat operasi pemegang lock dan durasi lock (`holder_operation`
dan `held_ms`), termasuk nama operasi seperti `session-load`, `session-save`, `users-sync`,
`offline-log-upload`, atau `photo-cache`, agar sumber kontensi SD dapat diidentifikasi tanpa menebak.
Selama solenoid aktif, akses SD dihentikan sedangkan TFT tetap aktif menampilkan hitung mundur;
layar juga tetap aktif selama jeda pemulihan SD 750 ms setelah relay mati. Relay hanya boleh aktif
setelah mutex SD dan SPI berhasil diamankan. Setelah jeda, firmware membaca sektor SD sebelum
membuka kembali akses SD. Periksa
`[RELAY] Pulse started sd_quiesced=1` dan
`[SD] Health check passed after relay pulse`; `[RELAY] Pulse cancelled` berarti relay sengaja
tidak dijalankan karena bus belum aman. Jika perangkat reboot, simpan nilai `[BOOT] reset_reason`;
reset brownout menandakan suplai daya perlu diperiksa, bukan diperbaiki hanya dengan perubahan kode.
Penyimpanan sesi tidak lagi dipicu hanya oleh GPS mendapatkan fix (karena itu bukan perubahan sesi).
Sinkronisasi personel mencoba file staging `/USERS.TMP`, `/U.TMP`, lalu `/foto/CACHE.TMP`;
semua jalur staging punya pemulihan transaksi saat boot. Jika ketiganya gagal dibuka, log
`Cannot create root or /foto temp files` mencatat status mount/kapasitas direktori untuk diagnosis;
cache lama tetap dipertahankan.
Saat boot, tes tulis-baca kini memakai nama 8.3 `/SDTEST.TXT` dan `/foto/SDTEST.TXT`, bukan
nama tersembunyi panjang. Jika kedua tes gagal, firmware melaporkan status baca direktori,
jenis kartu, kapasitas dan pemakaian. Jangan format sebelum menyalin data dan memastikan media
memang gagal menulis; kode tidak otomatis memformat kartu.
Badge TFT berubah ke `SD --` setelah tiga probe tidak dapat memverifikasi akses SD; probe sukses berikutnya memulihkannya. Jika penyebabnya lock berkepanjangan, badge juga menunjukkan akses belum terverifikasi, bukan memastikan kartu tercabut.
Pengunggah log offline membaca salinan terbatas lalu menutup semua file sebelum meminta backend;
setelah respons jaringan, ia hanya menghapus catatan yang berhasil terkirim dengan commit transaksional.
Ini menghindari pemakaian objek file SD ketika mutex dilepas dan menjaga catatan baru yang ditulis selama HTTP.

### Step 5: Cek Dashboard
1. Buka `http://localhost:3000`
2. Login sebagai Administrator
3. Box "ELOTO BOX 1" harusnya **ONLINE** ✓

## Test Flow Lengkap

### Telemetry Flow
```
ESP32 → POST /api/boxes/ELOTO%20BOX%201/telemetry
  Header: X-Device-Id: ELOTO BOX 1
  Body: { event_id, event, uid, state, is_online: 1, ... }
  ↓
Backend → Update boxes SET is_online = 1, last_ping = NOW()
  ↓
Dashboard → GET /api/boxes → is_online = 1 → Tampil "ONLINE" ✓
```

### RFID Tap Flow
```
User tap kartu RFID
  ↓
ESP32 → POST /api/users/check-card { rfid_uid: "9D88FA1200" }
  ↓
Backend → Cari user → { nama: "Budi Santoso", role: "PENGAWAS" }
  ↓
ESP32 → Tampilkan foto & nama di LCD ✓
```

## Troubleshooting Cepat

| Masalah | Solusi |
|---------|--------|
| Box OFFLINE | Cek Serial Monitor, pastikan WiFi connected |
| RFID tidak terbaca | Cek `rfid_uid` di database sudah benar |
| Foto tidak muncul | Upload foto di Dashboard → Personel |
| Error 401 | Cek `X-Device-Id` pada ESP32 cocok dengan box di database |
| Error 400 | Cek Serial Monitor untuk detail error |

## File yang Diubah

1. ✅ `backend/server.js` - Listen di 0.0.0.0
2. ✅ `backend/domain/telemetry.js` - Auto-generate event_id
3. ✅ `backend/app.js` - CORS, autentikasi perangkat, dan health endpoint
4. ✅ `esp32/ELOTO_FIXED.ino` - Device ID configurable, token auth
5. ✅ Database - Box token & 9 users seeded

## Siap Upload! 🚀

Semua sudah sinkron. Tinggal:
1. Copy `config.txt` ke SD Card
2. Upload firmware ESP32
3. Restart ESP32
4. Cek Dashboard → ONLINE ✓
