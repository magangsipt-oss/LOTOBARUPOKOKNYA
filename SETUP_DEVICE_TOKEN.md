# Setup Device Token untuk ESP32

## Langkah 1: Generate Token

Gunakan token yang kuat dan unik. Contoh:
```
ESP32-ELOTO-BOX1-SECRET-TOKEN-2024
```

Atau generate random token:
```bash
openssl rand -hex 32
```

## Langkah 2: Update Database

### Option A: Manual SQL
```sql
-- Hash token dengan SHA-256
UPDATE boxes
SET device_token = SHA2('ESP32-ELOTO-BOX1-SECRET-TOKEN-2024', 256)
WHERE id_box = 'BOX ELOTO 1';
```

### Option B: Using Node.js
```javascript
import crypto from 'crypto';
const token = 'ESP32-ELOTO-BOX1-SECRET-TOKEN-2024';
const hash = crypto.createHash('sha256').update(token).digest('hex');
console.log('Hash:', hash);

// Update database
await pool.query('UPDATE boxes SET device_token = ? WHERE id_box = ?', [hash, 'BOX ELOTO 1']);
```

## Langkah 3: Update ESP32 Config

### Di SD Card (config.txt)
```
SSID=vivoV29
PASS=112233445566
SERVER=192.168.137.1:5002
TOKEN=ESP32-ELOTO-BOX1-SECRET-TOKEN-2024
```

### Atau Hardcode di Firmware
Edit file `ELOTO_FIXED.ino`:
```cpp
String device_token = "ESP32-ELOTO-BOX1-SECRET-TOKEN-2024";
```

## Langkah 4: Restart ESP32

1. Upload firmware baru
2. Restart ESP32
3. Cek Serial Monitor untuk memastikan tidak ada error

## Verifikasi

### Cek dari Database
```sql
SELECT id_box, device_token FROM boxes WHERE id_box = 'BOX ELOTO 1';
```

### Cek dari ESP32
Buka Serial Monitor dan cari:
```
[CONFIG] Berhasil memuat konfigurasi dari SD Card.
```

### Cek dari Dashboard
- Buka Dashboard
- Device harusnya menunjukkan "ONLINE"
- Klik device untuk melihat status

## Troubleshooting

### Error: "Silakan login atau gunakan kredensial perangkat yang valid"
- Token di ESP32 tidak cocok dengan di database
- Pastikan token di-hash dengan SHA-256

### Error: "Origin tidak diizinkan"
- CORS configuration sudah diperbaiki
- Pastikan backend menggunakan versi terbaru

### Device tetap OFFLINE
1. Cek Serial Monitor untuk error
2. Pastikan backend berjalan
3. Pastikan network ESP32 bisa mengakses backend
4. Cek firewall atau blocking

## Security Notes

- **Jangan commit token ke version control**
- **Gunakan environment variables di production**
- **Rotate token secara berkala**
- **Monitor log untuk aktivitas mencurigakan**
