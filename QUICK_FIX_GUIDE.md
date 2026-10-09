# Panduan Cepat Perbaikan OFFLINE

## Masalah yang Ditemukan

1. **Backend hanya listen di localhost (127.0.0.1)** → ESP32 dari IP lain tidak bisa mengakses
2. ID perangkat harus cocok dengan ID box yang terdaftar di database

## Langkah Perbaikan

### Step 1: Restart Backend

```bash
cd "d:\KULIAH 1-8\FOLDER ELOTO\htdocs\PROJECT_ELOTO_NEW\backend"
# Stop backend yang sedang berjalan (Ctrl+C), lalu restart
npm run dev
# atau
node server.js
```

Backend sekarang akan listen di `0.0.0.0:5002` (semua network interfaces).

### Step 2: Sinkronkan Skema Database

```bash
pnpm --filter backend run migrate
```

Migrasi menghapus kolom token perangkat lama dari tabel `boxes`.

### Step 3: Update Config di SD Card ESP32

Edit file `config.txt` di SD Card ESP32:

```
SSID=your-wifi-network
PASS=replace-with-wifi-password
SERVER=http://192.168.137.1:5002
DEVICE_ID=BOX ELOTO 1
```

**PENTING**: Pastikan `SERVER` mengarah ke IP backend yang benar!

### Step 4: Upload Firmware ESP32

Compile dan upload firmware baru ke ESP32.

### Step 5: Restart ESP32

Restart ESP32 dan cek Serial Monitor.

### Step 6: Verifikasi

#### Cek Backend可以从 ESP32 diakses:
Buka browser di komputer yang sama dengan backend:
```
http://192.168.137.1:5002/
```
Harusnya muncul: `{"success":true,"service":"E-LOTO"}`

#### Cek koneksi backend:
```
http://192.168.137.1:5002/health/live
```
Harus muncul `{"success":true}`. Validasi token dilakukan oleh request telemetri ESP32, bukan endpoint publik.

#### Cek Serial Monitor ESP32:
Cari log seperti:
```
[CONFIG] Berhasil memuat konfigurasi dari SD Card.
[WIFI] Connected to your-wifi-network
[WIFI] IP Address: 192.168.137.176
```

Jika ada error 401 atau 400, cek ID perangkat di database dan ESP32.

## Troubleshooting

### Error: "ECONNREFUSED" atau timeout
- Backend tidak berjalan atau port salah
- Pastikan backend listen di `0.0.0.0:5002`

### Error: 401 Unauthorized
- ID pada header `X-Device-Id` tidak cocok dengan box terdaftar

### Error: 400 Validation Failed
- Field yang dikirim tidak valid
- Cek Serial Monitor untuk detail error

### Dashboard masih OFFLINE
- Tunggu 15-30 detik setelah ESP32 mulai mengirim telemetry
- Refresh dashboard (F5)
- Cek apakah `last_ping` di database sudah terbaru

## Cara Cek last_ping di Database

```sql
SELECT id_box, is_online, last_ping,
  TIMESTAMPDIFF(SECOND, last_ping, NOW()) AS age_seconds
FROM boxes
WHERE id_box = 'BOX ELOTO 1';
```

Jika `age_seconds` lebih dari 15, berarti telemetry tidak sampai.

## Ringkasan Alur

```
ESP32 → POST /api/boxes/BOX%20ELOTO%201/telemetry
  ├── Header: X-Device-Id: BOX ELOTO 1
  └── Backend terima & proses
      ├── Cocokkan ID perangkat dengan box terdaftar
      ├── Update is_online = 1
      └── Update last_ping = NOW()
          │
          ▼
Dashboard → GET /api/boxes
  └── Cek is_online == 1 && last_ping >= NOW() - 15s
      └── Tampilkan "ONLINE" ✓
```

## Catatan Penting

- **Gunakan token yang sama** di ESP32 dan database
- **Backend harus listen di 0.0.0.0**, bukan 127.0.0.1
- **Tunggu beberapa detik** setelah restart untuk sinkronisasi
- **Cek firewall** jika ESP32 tetap tidak bisa mengakses backend
