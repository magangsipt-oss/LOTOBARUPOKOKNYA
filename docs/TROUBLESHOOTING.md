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

Pastikan backend development bind ke `0.0.0.0:5002`, firewall komputer mengizinkan TCP 5002 pada jaringan privat, dan `SERVER` pada SD berisi IPv4 privat komputer backend. Dari perangkat lain di Wi-Fi yang sama, buka `http://<IP-backend>:5002/health/live`; respons sukses membuktikan jalur jaringan ke backend. Jika koneksi sampai tetapi mendapat 401, cocokkan token SD dengan token boks yang diprovision. Firmware `ELOTO_FIXED` saat ini belum mendukung HTTPS.

## ESP32 tidak membaca konfigurasi SD

Pastikan layar menunjukkan `SD OK` dan Serial Monitor menampilkan `[SD] Mounted and read/write verified`, lalu `[CONFIG] Reading ...`. Letakkan file sebagai `/config.txt` di root SD atau `/SD_CARD_CONFIG/config.txt`; nama `.txt.txt` juga dideteksi untuk kasus ekstensi Windows tersembunyi. Baris konfigurasi memakai format `KEY=VALUE`. Placeholder `your-...` dan `replace-with-...` diabaikan. Log hanya menampilkan apakah kredensial dimuat, tidak mencetak password atau token.

## Video tidak muncul atau counting stale

Pastikan worker Python berjalan dengan environment RTSP dan token yang benar. `counting/.env` dimuat otomatis oleh `pnpm dev`/`pnpm dev:counting`; menjalankan Python langsung memerlukan environment yang diexport. Cocokkan ID boks dan `ELOTO_MJPEG_PORT` dengan `MJPEG_PORTS` backend. MJPEG Python bind ke loopback, sehingga backend harus dapat menjangkaunya melalui `127.0.0.1`.

Endpoint stream tanpa pemetaan mengembalikan 404; upstream tidak tersedia dapat menghasilkan 502/503. Data count yang belum ada atau stale tidak berarti area kosong. Periksa kamera, model, frame terbaru, dan koneksi API sebelum menafsirkan hasil deteksi.

## Perintah SYNC_USERS tetap pending

Pastikan perangkat online, token valid, dan pembaruan cache SD berhasil. ACK dikirim setelah sinkronisasi berhasil. Periksa ID perintah saat ACK; pending command kedaluwarsa setelah sepuluh menit. Perintah lama di penyimpanan legacy tidak dipindahkan otomatis ke antrean baru.

## Checklist saat melaporkan masalah

Sertakan waktu dan zona waktu, komponen, langkah reproduksi, status HTTP, ID boks bila relevan, serta log error yang sudah disunting. Hapus password, cookie, token perangkat, dan kredensial RTSP dari laporan. Catat apakah masalah terjadi pada database development atau perangkat nyata agar hasil tes tidak disalahartikan.
