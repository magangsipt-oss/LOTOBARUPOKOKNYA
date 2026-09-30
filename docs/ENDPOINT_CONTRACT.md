# Kontrak endpoint E-LOTO

Semua browser memakai basis API yang sama: `/api`. `VITE_API_URL` boleh diisi
dengan origin (`https://eloto.example.com`) atau basis lengkap
(`https://eloto.example.com/api`); frontend akan menormalkan keduanya menjadi
akhiran `/api`.

| Pemanggil | Method dan path | Otorisasi | Fungsi |
| --- | --- | --- | --- |
| ESP32 | `GET /api/boxes/{id_box}/device-handshake` | `X-Device-Token` | Membuktikan host backend dan kontrak `eloto-device-v1` sebelum telemetri. |
| ESP32 | `POST /api/boxes/{id_box}/telemetry` | `X-Device-Token` | Mengirim event RFID, snapshot boks, dan replay offline. |
| ESP32 | `POST /api/users/check-card` | `X-Device-Token` | Verifikasi kartu yang belum ada di cache SD/RAM. |
| ESP32 | `GET /api/users` | `X-Device-Token` | Sinkronisasi cache personel ke SD. |
| ESP32 | `POST /api/loto/presence` | `X-Device-Token` | Laporan kehadiran BLE. |
| Browser | `GET /api/logs/tapping-history` | Cookie sesi | Membaca riwayat tap yang ditampilkan dashboard. |

Urutan rilis wajib: deploy backend terlebih dahulu, lalu unggah
`ELOTO_FIXED.ino`. Firmware baru menolak backend lama yang belum menyediakan
endpoint handshake. Untuk jaringan saat ini, `SERVER` pada SD tetap harus
berupa IPv4 privat backend LAN pada port `5002`; firmware ini tidak boleh
mengirim token perangkat melalui HTTP publik.
