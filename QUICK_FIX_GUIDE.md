# Perbaikan cepat ESP32 offline

Identitas ESP32 sekarang memakai IP Wi-Fi lokal yang didaftarkan pada boks di dashboard. Token perangkat tidak digunakan.

1. Lihat IP ESP32 di layar perangkat atau Serial Monitor.
2. Daftarkan IP yang sama pada kolom **IP Address ESP32** di dashboard. Setiap boks harus memiliki IP berbeda.
3. Buat reservasi DHCP pada router agar alamat ESP32 tetap sama setelah restart.
4. Pastikan ESP32 dan server dapat menjangkau endpoint backend yang dikonfigurasi. Firmware menambahkan header `X-Device-IP` otomatis pada request.
5. Jika backend mengembalikan `401`, cocokkan lagi IP ESP32 dengan IP di dashboard dan pastikan IP itu belum dipakai boks lain.

Untuk upgrade pertama ke alur IP, jalankan migrasi database lalu deploy backend dan upload firmware `ELOTO_FIXED` terbaru. Setelah itu, perubahan IP yang didaftarkan tidak memerlukan token atau perubahan SD. Lihat [panduan deployment](docs/DEPLOYMENT.md) dan [troubleshooting](docs/TROUBLESHOOTING.md).
