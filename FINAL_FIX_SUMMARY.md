# Ringkasan alur perangkat E-LOTO saat ini

ESP32 memakai ID boks yang sama dengan database dan IP Wi-Fi lokal yang didaftarkan di dashboard. Firmware menambahkan header `X-Device-IP` untuk semua request backend; backend membatasi operasi ke boks yang terdaftar pada IP tersebut.

Tidak ada provisioning atau penyimpanan token perangkat. Counting tidak diperlukan pada alur dashboard dan ESP32.

Untuk upgrade dari firmware lama, jalankan migrasi database dan deploy backend baru, lalu upload firmware `ELOTO_FIXED` yang mendukung identitas IP. Gunakan reservasi DHCP untuk menjaga IP perangkat tetap.

- Setup: [panduan deployment](docs/DEPLOYMENT.md)
- Konfigurasi: [CONFIGURATION.md](docs/CONFIGURATION.md)
- Troubleshooting: [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
