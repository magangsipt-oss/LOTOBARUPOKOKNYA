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
  ├── Device Token: ✅ Set
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
wifi_ssid   = "vivoV29"            ← WiFi yang benar ✓
wifi_pass   = "112233445566"       ← Password WiFi ✓
server_host = "192.168.137.1:5002" ← Backend address ✓
device_token= "ESP32-ELOTO-BOX1-SECRET-TOKEN-2024" ← Auth token ✓
```

### 4. SD Card Config (config.txt)
```
SSID=vivoV29
PASS=112233445566
SERVER=192.168.137.1:5002
TOKEN=ESP32-ELOTO-BOX1-SECRET-TOKEN-2024
DEVICE_ID=ELOTO BOX 1
```

## Yang Perlu Anda Lakukan

### Step 1: Copy config.txt ke SD Card
Copy file dari: `esp32/SD_CARD_CONFIG/config.txt`
Ke SD Card: `/config.txt`

### Step 2: Upload Firmware ESP32
1. Buka `esp32/ELOTO_FIXED.ino` di Arduino IDE / PlatformIO
2. Pilih board: ESP32
3. Klik **Upload**
4. Tunggu sampai selesai

### Step 3: Restart ESP32
Setelah upload, restart ESP32.

### Step 4: Cek Serial Monitor
Harusnya muncul:
```
[CONFIG] Berhasil memuat konfigurasi dari SD Card.
[CONFIG] Device ID: ELOTO BOX 1
[CONFIG] Server: 192.168.137.1:5002
[WIFI] Connected to vivoV29
[WIFI] IP Address: 192.168.137.176
```

### Step 5: Cek Dashboard
1. Buka `http://localhost:3000`
2. Login sebagai Administrator
3. Box "ELOTO BOX 1" harusnya **ONLINE** ✓

## Test Flow Lengkap

### Telemetry Flow
```
ESP32 → POST /api/boxes/ELOTO%20BOX%201/telemetry
  Header: X-Device-Token: ESP32-ELOTO-BOX1-SECRET-TOKEN-2024
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
| Error 401 | Cek TOKEN di SD Card sama dengan database |
| Error 400 | Cek Serial Monitor untuk detail error |

## File yang Diubah

1. ✅ `backend/server.js` - Listen di 0.0.0.0
2. ✅ `backend/domain/telemetry.js` - Auto-generate event_id
3. ✅ `backend/app.js` - CORS & diagnostic endpoint
4. ✅ `esp32/ELOTO_FIXED.ino` - Device ID configurable, token auth
5. ✅ Database - Box token & 9 users seeded

## Siap Upload! 🚀

Semua sudah sinkron. Tinggal:
1. Copy `config.txt` ke SD Card
2. Upload firmware ESP32
3. Restart ESP32
4. Cek Dashboard → ONLINE ✓
