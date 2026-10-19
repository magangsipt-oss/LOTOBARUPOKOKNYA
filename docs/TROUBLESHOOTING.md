# Troubleshooting

## Backend gagal start dengan ECONNREFUSED

Jika alamatnya `127.0.0.1:3306`, backend belum dapat menghubungi MySQL. Periksa layanan MySQL, `DB_HOST`, `DB_PORT`, dan jaringan dari host backend. Frontend Vite dapat tetap berjalan walaupun backend gagal. Perintah dev pnpm tidak membuat atau menjalankan database.

## Tabel keamanan atau migrasi belum tersedia

Periksa database tujuan pada `backend/.env`, lalu ikuti [prosedur migrasi](DEPLOYMENT.md). Database lama memerlukan pemeriksaan baseline. Jika migrasi berhenti di tengah DDL, periksa schema dan ledger sebelum retry; jangan menghapus database untuk melewati error.

## Login gagal atau sesi selalu hilang

Pastikan akun ada dan memiliki password bcrypt. Akun baru wajib diberi password unik minimal 12 karakter. Password plaintext lama perlu direset melalui skrip. Gunakan host yang konsisten saat membuka frontend. Pada production, cookie Secure membutuhkan HTTPS dan konfigurasi proxy yang benar. Setelah password diubah, login ulang karena sesi dicabut.

## Respons 403 saat menyimpan

Periksa role akun, header `X-CSRF-Token`, dan origin frontend. Login ulang atau muat ulang aplikasi untuk memulihkan CSRF lewat `/users/me`. Untuk perangkat, pastikan `X-Device-Id` sama persis dengan ID boks yang terdaftar dan request hanya dapat dijangkau dari jaringan tepercaya. Izin UI tidak menggantikan pemeriksaan server.

## ESP32 tidak mencapai backend atau mendapat 401

Untuk LAN development, pastikan backend bind ke `0.0.0.0:5002` dan firewall mengizinkan TCP 5002 hanya pada jaringan privat. Untuk VPS BiznetGIO, firmware production sudah memakai `https://103.197.188.61` dan root CA ISRG Root X1 bawaan; `config.txt` dan `/server_ca.pem` bersifat override opsional. Jangan membuka port 5002 ke internet.

Firmware mencoba ulang handshake backend setiap 15 detik selama Wi-Fi tersambung dan memverifikasi TLS. Jika satu profil Wi-Fi belum tersambung selama 15 detik, firmware berpindah ke profil berikutnya. ESP32 ini hanya mendukung hotspot 2,4 GHz; aktifkan mode kompatibilitas/2,4 GHz pada ponsel, gunakan WPA2, tampilkan SSID, lalu cocokkan nama dan password persis di `network_secrets.local.h` atau `/config.txt`. Serial Monitor menampilkan nomor profil, status Wi-Fi, dan SSID tujuan tanpa mencetak password. `HTTP -1` berarti koneksi transport ke backend tidak mendapat respons, bukan kegagalan asosiasi Wi-Fi. Jika handshake menghasilkan 401, pastikan `DEVICE_ID` lokal sama dengan ID boks yang terdaftar. Jangan mengatasi kegagalan dengan `setInsecure()` atau HTTP publik.

Untuk penolakan kartu, bedakan log `[RFID] Online card lookup ... HTTP=404` dari `[RFID] Backend confirms UID is unregistered`: firmware hanya menyatakan kartu tidak terdaftar jika endpoint mengembalikan kontrak JSON `success:false` dan `is_valid:false`. HTTP 404 tanpa kontrak tersebut berarti endpoint/backend yang dituju tidak cocok; pastikan `url=` di log mengarah ke backend aktif. Saat Wi-Fi terhubung dan memiliki IP, backend tetap menjadi sumber verifikasi; cache lokal hanya digunakan ketika perangkat benar-benar kehilangan jaringan. Pengawas dan Mekanik hanya dapat tap pada layar sesi LOTO aktif, sedangkan Petugas BBM dapat tap dari tampilan lain selama kartunya terverifikasi. Kartu baru hanya masuk antrean pendaftaran jika di-tap pada layar **Daftar Kartu**; pemindaian baru yang ditolak pada layar lain tidak masuk antrean.

GPS memakai receiver pada ESP32 (UART RX 16/TX 17). Firmware kini menyalakan inisialisasi receiver sebelum proses SD, mencoba ulang komunikasi AT, memeriksa data GNSS setiap detik, dan mencetak jumlah satelit/HDOP saat sedang mencari fix. Fix akurat tetap mensyaratkan minimal 4 satelit terpakai dan HDOP <= 2.5; jangan menurunkan syarat ini untuk sekadar membuat status terlihat cepat. Untuk cold start, letakkan antena di luar ruangan dengan langit terbuka dan sisi antena menghadap ke atas. Pastikan antena GPS terpasang pada konektor yang benar, kabelnya tidak terlipat/terlepas, dan catu daya modul stabil. Bangunan, atap logam, kendaraan, serta antena aktif tanpa suplai bias dapat memperlambat atau mencegah fix; perangkat lunak tidak dapat menggantikan sinyal satelit. Jika belum fix, periksa `[GPS] Acquiring fix ... sats_used=... sats_view=... hdop=...`; `sats_view=0` biasanya mengarah ke antena/kabel/lokasi atau suplai, sedangkan satelit terlihat tetapi belum terpakai berarti receiver masih mengumpulkan data atau kondisi langit belum cukup baik.

## ESP32 tidak membaca konfigurasi SD

Pastikan layar menunjukkan `SD OK` dan Serial Monitor menampilkan `[SD] Mounted and read/write verified`. Jika memakai konfigurasi SD, letakkan file sebagai `/config.txt` di root SD atau `/SD_CARD_CONFIG/config.txt`; nama `.txt.txt` juga dideteksi untuk kasus ekstensi Windows tersembunyi. Tanpa file itu, pesan `[CONFIG] No config.txt; using compiled ... defaults` normal untuk firmware production, asalkan header rahasia lokal sudah diisi saat upload. Baris konfigurasi memakai format `KEY=VALUE`. Placeholder `your-...` dan `replace-with-...` diabaikan. Log tidak mencetak password atau token.

## Video tidak muncul atau counting stale

Pastikan worker Python berjalan dengan environment RTSP. `counting/.env` dimuat otomatis oleh `pnpm dev`/`pnpm dev:counting`; menjalankan Python langsung memerlukan environment yang diexport. Cocokkan ID boks dan `ELOTO_MJPEG_PORT` dengan `MJPEG_PORTS` backend. MJPEG Python bind ke loopback, sehingga backend harus dapat menjangkaunya melalui `127.0.0.1`.

Endpoint stream tanpa pemetaan mengembalikan 404; upstream tidak tersedia dapat menghasilkan 502/503. Data count yang belum ada atau stale tidak berarti area kosong. Periksa kamera, model, frame terbaru, dan koneksi API sebelum menafsirkan hasil deteksi.

## Perintah SYNC_USERS tetap pending

Pastikan perangkat online dan ID boks cocok. ACK dikirim setelah sinkronisasi berhasil. Periksa ID perintah saat ACK; pending command kedaluwarsa setelah sepuluh menit. Perintah lama di penyimpanan legacy tidak dipindahkan otomatis ke antrean baru.

## Checklist saat melaporkan masalah

Sertakan waktu dan zona waktu, komponen, langkah reproduksi, status HTTP, ID boks bila relevan, serta log error yang sudah disunting. Hapus password, cookie, dan kredensial RTSP dari laporan. Catat apakah masalah terjadi pada database development atau perangkat nyata agar hasil tes tidak disalahartikan.
