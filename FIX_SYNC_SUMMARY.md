# Perbaikan Sinkronisasi ESP32 - Backend - Frontend

## Masalah yang Ditemukan

Dashboard menunjukkan device OFFLINE meskipun LCD pada ESP32 menunjukkan GPS sudah OK dan sistem berjalan normal.

### Root Cause
1. **Backend membutuhkan field `event_id`** yang tidak dikirim oleh ESP32
2. ESP32 harus mengirim identitas box melalui `X-Device-Id`.
3. **CORS configuration memblokir request dari ESP32** karena origin mismatch

## Perbaikan yang Dilakukan

### 1. Backend - Telemetry Validation ([backend/domain/telemetry.js](backend/domain/telemetry.js))
- Membuat `event_id` **optional** dengan auto-generation jika tidak dikirim
- Format auto-generated: `{event}-{uid}-{timestamp}-{random}`
- Backend sekarang menerima telemetry dari ESP32 tanpa harus menyertakan `event_id`

### 2. ESP32 - Event ID Generation ([esp32/ELOTO_FIXED.ino](esp32/ELOTO_FIXED.ino))
- Menambahkan field `event_id` ke payload telemetry
- Format: `{event}-{uid}-{millis()}-{random(1000-9999)}`
- Setiap telemetry memiliki ID unik untuk deduplication

### 3. ESP32 - Device Identity ([esp32/ELOTO_FIXED/ELOTO_FIXED.ino](esp32/ELOTO_FIXED/ELOTO_FIXED.ino))
- Mengirim `X-Device-Id` pada request perangkat
- ID harus sesuai dengan box yang terdaftar di database

### 4. Backend - CORS & Origin Check ([backend/app.js](backend/app.js))
- Mengizinkan request perangkat dari LAN tepercaya tanpa header Origin
- Menambahkan `User-Agent` ke allowed headers
- Device requests tanpa Origin header diizinkan melewati middleware

## Konfigurasi yang Diperlukan

### Di SD Card (config.txt)
```
SSID=your-wifi-network
PASS=replace-with-wifi-password
SERVER=http://192.168.137.1:5002
DEVICE_ID=BOX ELOTO 1
```

## Cara Testing

1. **Upload ESP32 firmware** ke board
2. Pastikan `DEVICE_ID` di SD sesuai dengan ID box yang terdaftar
4. **Restart ESP32**
5. **Cek Serial Monitor** - pastikan tidak ada error 401 atau 400
6. **Buka Dashboard** - device sekarang harusnya menunjukkan ONLINE

## Alur Data yang Benar (Setelah Fix)

```
ESP32 → POST /api/boxes/{id}/telemetry
  ├── Header: X-Device-Id: BOX ELOTO 1
  ├── Body: { event_id, event, uid, state, ... }
  │
  ▼
Backend → Validate & Process
  ├── Identify device via X-Device-Id
  ├── Auto-generate event_id if missing
  ├── Update boxes.is_online = 1
  └── Store telemetry data
  │
  ▼
Frontend → Polling getAllBoxes()
  ├── Check is_online === 1
  └── Display device as ONLINE ✓
```

## Troubleshooting

### Device masih OFFLINE di Dashboard
1. Cek Serial Monitor untuk error 401 (auth gagal) atau 400 (validation gagal)
2. Pastikan ID box di SD cocok dengan database
3. Pastikan backend berjalan dan bisa diakses dari ESP32
4. Cek firewall atau network blocking

### Error 401 Unauthorized
- Token di ESP32 tidak cocok dengan di database
- Update token di kedua tempat

### Error 400 Validation Failed
- Cek apakah field yang dikirim valid
- Lihat log backend untuk detail error

## Catatan Penting

- Header ID perangkat bukan rahasia; batasi API perangkat pada jaringan tepercaya.
