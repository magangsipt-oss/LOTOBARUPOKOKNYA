# Ringkasan sinkronisasi ESP32 dan backend

Alur aktif mengenali boks dari IP Wi-Fi lokal ESP32. Firmware mengirim IP tersebut secara otomatis dalam header `X-Device-IP`; backend mencocokkannya dengan IP unik yang terdaftar di dashboard.

ID boks pada firmware tetap harus sama dengan ID boks di database untuk path telemetri. IP perangkat harus tetap, jadi atur reservasi DHCP. Counting tidak diperlukan pada alur ini.

Untuk upgrade pertama, jalankan migrasi database dan deploy backend versi terbaru, lalu upload firmware IP terbaru. Setelah upgrade, tidak ada token perangkat yang perlu disalin ke SD atau diperbarui saat IP boks diubah di dashboard.

Lihat [panduan cepat](QUICK_FIX_GUIDE.md), [konfigurasi](docs/CONFIGURATION.md), dan [troubleshooting](docs/TROUBLESHOOTING.md).
