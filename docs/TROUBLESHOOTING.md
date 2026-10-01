# Troubleshooting

## Backend gagal start dengan ECONNREFUSED

Jika alamatnya `127.0.0.1:3306`, backend belum dapat menghubungi MySQL. Periksa layanan MySQL, `DB_HOST`, `DB_PORT`, dan jaringan dari host backend. Frontend Vite dapat tetap berjalan walaupun backend gagal. Perintah dev pnpm tidak membuat atau menjalankan database.

## Tabel keamanan atau migrasi belum tersedia

Periksa database tujuan pada `backend/.env`, lalu ikuti [prosedur migrasi](DEPLOYMENT.md). Database lama memerlukan pemeriksaan baseline. Jika migrasi berhenti di tengah DDL, periksa schema dan ledger sebelum retry; jangan menghapus database untuk melewati error.

## Login gagal atau sesi selalu hilang

Pastikan akun ada dan memiliki password bcrypt. Akun baru wajib diberi password unik minimal 12 karakter. Password plaintext lama perlu direset melalui skrip. Gunakan host yang konsisten saat membuka frontend. Pada production, cookie Secure membutuhkan HTTPS dan konfigurasi proxy yang benar. Setelah password diubah, login ulang karena sesi dicabut.

## Respons 403 saat menyimpan

Periksa role akun, header `X-CSRF-Token`, dan origin frontend. Login ulang atau muat ulang aplikasi untuk memulihkan CSRF lewat `/users/me`. Untuk perangkat, pastikan token cocok dengan ID boks pada path, query, atau payload. Izin UI tidak menggantikan pemeriksaan server.

## ESP32 tidak mencapai backend atau mendapat 401

Untuk LAN development, pastikan backend bind ke `0.0.0.0:5002` dan firewall mengizinkan TCP 5002 hanya pada jaringan privat. Untuk VPS BiznetGIO, firmware production sudah memakai `https://103.197.188.61` dan root CA ISRG Root X1 bawaan; `config.txt` dan `/server_ca.pem` bersifat override opsional. Jangan membuka port 5002 ke internet.

Firmware mencoba ulang handshake backend setiap 15 detik selama Wi-Fi tersambung, mempertahankan verifikasi TLS dan token perangkat. Jika profil Wi-Fi gagal selama 45 detik, firmware berpindah ke profil berikutnya; pastikan hotspot 2,4 GHz aktif dan memiliki internet. `HTTP -1` berarti koneksi transport tidak mendapat respons; versi firmware terbaru juga mencetak rincian TLS di Serial Monitor. Jika handshake menghasilkan 401, transport sudah mencapai server tetapi ID/token lokal tidak cocok dengan boks; jangan kirim token ke log atau chat. Jangan mengatasi kegagalan dengan `setInsecure()` atau HTTP publik.

GPS memakai receiver pada ESP32 (UART RX 16/TX 17) dan hanya mengirim koordinat setelah mendapat satellite fix. Untuk memperoleh fix awal, nyalakan perangkat di area terbuka; bila `gps_fix=false` terus di luar ruangan, periksa kabel dan antena GPS.

## ESP32 tidak membaca konfigurasi SD

Pastikan layar menunjukkan `SD OK` dan Serial Monitor menampilkan `[SD] Mounted and read/write verified`. Jika memakai konfigurasi SD, letakkan file sebagai `/config.txt` di root SD atau `/SD_CARD_CONFIG/config.txt`; nama `.txt.txt` juga dideteksi untuk kasus ekstensi Windows tersembunyi. Tanpa file itu, pesan `[CONFIG] No config.txt; using compiled ... defaults` normal untuk firmware production, asalkan header rahasia lokal sudah diisi saat upload. Baris konfigurasi memakai format `KEY=VALUE`. Placeholder `your-...` dan `replace-with-...` diabaikan. Log tidak mencetak password atau token.

## Video tidak muncul atau counting stale

Pastikan worker Python berjalan dengan environment RTSP dan token yang benar. `counting/.env` dimuat otomatis oleh `pnpm dev`/`pnpm dev:counting`; menjalankan Python langsung memerlukan environment yang diexport. Cocokkan ID boks dan `ELOTO_MJPEG_PORT` dengan `MJPEG_PORTS` backend. MJPEG Python bind ke loopback, sehingga backend harus dapat menjangkaunya melalui `127.0.0.1`.

Endpoint stream tanpa pemetaan mengembalikan 404; upstream tidak tersedia dapat menghasilkan 502/503. Data count yang belum ada atau stale tidak berarti area kosong. Periksa kamera, model, frame terbaru, dan koneksi API sebelum menafsirkan hasil deteksi.

## Perintah SYNC_USERS tetap pending

Pastikan perangkat online, token valid, dan pembaruan cache SD berhasil. ACK dikirim setelah sinkronisasi berhasil. Periksa ID perintah saat ACK; pending command kedaluwarsa setelah sepuluh menit. Perintah lama di penyimpanan legacy tidak dipindahkan otomatis ke antrean baru.

## Checklist saat melaporkan masalah

Sertakan waktu dan zona waktu, komponen, langkah reproduksi, status HTTP, ID boks bila relevan, serta log error yang sudah disunting. Hapus password, cookie, token perangkat, dan kredensial RTSP dari laporan. Catat apakah masalah terjadi pada database development atau perangkat nyata agar hasil tes tidak disalahartikan.
