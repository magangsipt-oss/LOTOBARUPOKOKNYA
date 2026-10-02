# Kontrak endpoint E-LOTO

Semua browser memakai basis API yang sama: `/api`. `VITE_API_URL` boleh diisi
dengan origin (`https://eloto.example.com`) atau basis lengkap
(`https://eloto.example.com/api`); frontend akan menormalkan keduanya menjadi
akhiran `/api`.

| Pemanggil | Method dan path | Otorisasi | Fungsi |
| --- | --- | --- | --- |
| ESP32 | `GET /api/boxes/{id_box}/device-handshake` | `X-Device-IP` | Membuktikan host backend dan kontrak `eloto-device-v1`; IP harus terdaftar untuk boks tersebut. |
| ESP32 | `POST /api/boxes/{id_box}/telemetry` | `X-Device-IP` | Mengirim event RFID, snapshot boks, dan replay offline. |
| ESP32 | `POST /api/users/check-card` | `X-Device-IP` | Verifikasi kartu yang belum ada di cache SD/RAM. |
| ESP32 | `GET /api/users` | `X-Device-IP` | Sinkronisasi cache personel ke SD. |
| ESP32 | `POST /api/loto/presence` | `X-Device-IP` | Laporan kehadiran BLE. |
| Browser | `GET /api/logs/tapping-history` | Cookie sesi | Membaca riwayat tap yang ditampilkan dashboard. |

Deploy backend baru dahulu; kode backend ini tetap berjalan saat kolom token
lama masih ada. Setelah readiness lolos, backup database lalu jalankan migrasi
`20261002-remove-device-token.cjs` di VPS. Unggah `ELOTO_FIXED.ino` untuk
mengaktifkan perangkat dengan autentikasi IP. IP Wi-Fi ESP32 harus sama dengan
IP yang didaftarkan di dashboard. Untuk jaringan LAN, `SERVER` dapat berupa
IPv4 privat backend pada port `5002`; production memakai HTTPS.
