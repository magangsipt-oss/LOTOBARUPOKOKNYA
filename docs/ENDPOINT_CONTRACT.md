# Kontrak endpoint E-LOTO

Semua browser memakai basis API yang sama: `/api`. `VITE_API_URL` boleh diisi
dengan origin (`https://eloto.example.com`) atau basis lengkap
(`https://eloto.example.com/api`); frontend akan menormalkan keduanya menjadi
akhiran `/api`.

| Pemanggil | Method dan path | Otorisasi | Fungsi |
| --- | --- | --- | --- |
| ESP32 | `GET /api/boxes/{id_box}/device-handshake` | `X-Device-Id` | Membuktikan host backend dan kontrak `eloto-device-v1` sebelum telemetri. |
| ESP32 | `POST /api/boxes/{id_box}/telemetry` | `X-Device-Id` | Mengirim event RFID, snapshot boks, dan replay offline. |
| ESP32 | `POST /api/boxes/{id_box}/pending-cards` | `X-Device-Id` | Menyinkronkan UID kartu pending dari `/pending_cards.csv` ke buffer dashboard; hanya box sendiri. |
| ESP32 | `POST /api/users/check-card` | `X-Device-Id` | Verifikasi kartu yang belum ada di cache SD/RAM. |
| ESP32 | `GET /api/users` | `X-Device-Id` | Sinkronisasi cache personel ke SD. |
| ESP32 | `POST /api/loto/presence` | `X-Device-Id` | Laporan kehadiran BLE. |
| Browser | `GET /api/logs/tapping-history` | Cookie sesi | Membaca riwayat tap yang ditampilkan dashboard. |

Daftar personel yang tersinkron disimpan ESP32 di `/users.csv` untuk lookup lokal saat offline. UID baru disimpan idempoten di `/pending_cards.csv`; setelah endpoint pending-cards mengonfirmasi UID masuk ke database, entri lokal dihapus. Data kartu baru tetap belum berwenang untuk tap sampai personel didaftarkan secara resmi.

Urutan rilis wajib: deploy backend terlebih dahulu, lalu unggah
`ELOTO_FIXED.ino`. Firmware baru menolak backend lama yang belum menyediakan
endpoint handshake. Untuk jaringan saat ini, `SERVER` pada SD tetap harus
berupa IPv4 privat backend LAN pada port `5002`; batasi perangkat ke jaringan
tepercaya karena ID boks bukan rahasia.
