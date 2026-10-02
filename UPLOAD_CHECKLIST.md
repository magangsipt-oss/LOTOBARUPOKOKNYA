# Checklist ESP32 dengan identitas IP

- [ ] ID boks firmware cocok dengan ID boks di database.
- [ ] IP Wi-Fi lokal ESP32 didaftarkan pada boks di dashboard.
- [ ] Setiap boks memakai IP berbeda; atur reservasi DHCP di router.
- [ ] Wi-Fi 2,4 GHz, endpoint server, NTP, dan TLS siap.
- [ ] Migrasi database dan backend versi terbaru sudah dipasang.
- [ ] Firmware `esp32/ELOTO_FIXED/ELOTO_FIXED.ino` versi IP sudah di-upload.
- [ ] Serial Monitor menunjukkan handshake berhasil dan telemetri diterima.
- [ ] Dashboard menampilkan boks online setelah telemetri masuk.

Firmware mengirim `X-Device-IP` otomatis. Tidak ada token untuk dimasukkan ke SD. Untuk langkah rinci, lihat [panduan deployment](docs/DEPLOYMENT.md) dan [troubleshooting](docs/TROUBLESHOOTING.md).
