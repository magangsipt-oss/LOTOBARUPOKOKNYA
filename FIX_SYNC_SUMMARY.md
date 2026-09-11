# Perbaikan Sinkronisasi ESP32 - Backend - Frontend

## Masalah yang Ditemukan

Dashboard menunjukkan device OFFLINE meskipun LCD pada ESP32 menunjukkan GPS sudah OK dan sistem berjalan normal.

### Root Cause
1. **Backend membutuhkan field `event_id`** yang tidak dikirim oleh ESP32
2. **ESP32 tidak mengirim header autentikasi `X-Device-Token`** sehingga request ditolak (401)
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

### 3. ESP32 - Device Authentication ([esp32/ELOTO_FIXED.ino](esp32/ELOTO_FIXED.ino))
- Menambahkan variabel `device_token` untuk autentikasi
- Mengirim header `X-Device-Token` di setiap request
- Menambahkan pembacaan token dari SD card (config.txt)

### 4. Backend - CORS & Origin Check ([backend/app.js](backend/app.js))
- Mengizinkan request dengan header `X-Device-Token` melewati origin check
- Menambahkan `User-Agent` ke allowed headers
- Device requests tanpa Origin header diizinkan melewati middleware

## Konfigurasi yang Diperlukan

### Di SD Card (config.txt)
```
SSID=vivoV29
PASS=112233445566
SERVER=192.168.137.1:5002
TOKEN=ESP32-ELOTO-BOX1-SECRET-TOKEN-2024
```

### Di Database (boxes table)
Pastikan kolom `device_token` diisi dengan token yang sama:
```sql
UPDATE boxes SET device_token = SHA2('ESP32-ELOTO-BOX1-SECRET-TOKEN-2024', 256)
WHERE id_box = 'BOX ELOTO 1';
```

## Cara Testing

1. **Upload ESP32 firmware** ke board
2. **Update device_token** di SD card config.txt
3. **Update device_token** di database boxes table
4. **Restart ESP32**
5. **Cek Serial Monitor** - pastikan tidak ada error 401 atau 400
6. **Buka Dashboard** - device sekarang harusnya menunjukkan ONLINE

## Alur Data yang Benar (Setelah Fix)

```
ESP32 → POST /api/boxes/{id}/telemetry
  ├── Header: X-Device-Token: ESP32-ELOTO-BOX1-SECRET-TOKEN-2024
  ├── Body: { event_id, event, uid, state, ... }
  │
  ▼
Backend → Validate & Process
  ├── Authenticate device via X-Device-Token
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
2. Pastikan device_token di SD card sama dengan di database
3. Pastikan backend berjalan dan bisa diakses dari ESP32
4. Cek firewall atau network blocking

### Error 401 Unauthorized
- Token di ESP32 tidak cocok dengan di database
- Update token di kedua tempat

### Error 400 Validation Failed
- Cek apakah field yang dikirim valid
- Lihat log backend untuk detail error

## Catatan Penting

- **device_token** harus di-hash dengan SHA-256 saat disimpan di database
- Gunakan token yang kuat dan unik untuk setiap device
- Jangan commit token ke version control
- Pertimbangkan untuk menggunakan environment variables di production
