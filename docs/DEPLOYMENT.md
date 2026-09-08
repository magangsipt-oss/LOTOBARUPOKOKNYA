# Menjalankan dan memasang E-LOTO

## Development

Gunakan workspace root dan lockfile root:

```bash
pnpm install --frozen-lockfile
pnpm --parallel -r run dev
```

Frontend: `http://localhost:3000`. Backend: `127.0.0.1:5002`. Vite menyediakan proxy `/api`; file `frontend/.env.production` menetapkan `/api` untuk build production. Jika memakai `.env` frontend sendiri, gunakan hostname frontend/backend yang konsisten agar cookie sesi bisa dikirim.

Sebelum backend dapat berjalan, konfigurasi `backend/.env` berdasarkan `backend/.env.example` dan siapkan MySQL. Backend sengaja berhenti jika database atau tabel keamanan belum tersedia. Docker belum disiapkan sesuai instruksi pengguna.

## Migrasi database

1. Buat backup dan uji restore pada database terpisah. Jalankan perubahan pertama pada salinan database dan hentikan penulisan perangkat selama cutover; lakukan ketika tidak ada sesi LOTO aktif.
2. Pastikan `.env` menunjuk database yang benar. Gunakan akun migrasi dengan hak DDL hanya saat migrasi, lalu akun aplikasi dengan hak terbatas untuk runtime.
3. Database kosong: `pnpm --filter backend run migrate`.
4. Database yang sudah memiliki schema lama: periksa kesesuaian struktur terlebih dahulu, lalu `pnpm --filter backend run migrate -- --baseline-existing`. Jika pnpm meneruskan pemisah `--`, runner tetap membaca flag dari seluruh argv. Flag baseline hanya boleh digunakan sebelum ledger migrasi terisi; runner memeriksa seluruh kolom baseline sebelum mengadopsinya. Schema yang berbeda harus direkonsiliasi melalui migrasi yang ditinjau, bukan dipaksa ditimpa.
5. Periksa tabel `eloto_migrations`, `web_sessions`, `device_events`, `device_commands`, `people_counting_latest`, serta kolom baru pada `boxes` dan `supervisor_box_team`.

MySQL tidak memberi rollback atomik untuk seluruh rangkaian DDL. Runner memakai koneksi terkunci dan pemeriksaan indeks/kolom agar langkah yang sudah selesai dapat dilewati ketika diulang, tetapi kegagalan DDL tetap perlu diperiksa sebelum retry. Tidak ada `sync(force)` atau penghapusan tabel otomatis pada runner baru.

Akun plaintext lama tidak lagi bisa login. Reset kata sandi akun tersebut dengan password baru yang kuat; password reset tidak boleh memakai SID. Skrip tidak mencetak kata sandi:

```bash
export ELOTO_USER_SID=Admin
read -rs ELOTO_NEW_PASSWORD
export ELOTO_NEW_PASSWORD
pnpm --filter backend run reset-password
unset ELOTO_NEW_PASSWORD
```

Untuk database baru tanpa administrator, gunakan `pnpm --filter backend run bootstrap-admin` dengan `ELOTO_USER_SID`. Akun dibuat tanpa kartu RFID otomatis dan memakai SID sebagai password awal. `seed` adalah data demo dan ditolak pada production.

## Kredensial perangkat dan counting

Buat token acak kriptografis terpisah untuk setiap boks (minimal 32 karakter). Simpan di pengelola rahasia; jangan menaruh token dalam frontend atau Git.

```bash
export ELOTO_BOX_ID='BOX ELOTO 1'
read -rs ELOTO_DEVICE_TOKEN
export ELOTO_DEVICE_TOKEN
pnpm --filter backend run provision-device
unset ELOTO_DEVICE_TOKEN
```

Boks harus sudah terdaftar. Database menyimpan hash token. Pasang token asli pada `/config.txt` di SD ESP32 menggunakan format `esp32/config.example.txt`. Pasang sertifikat CA yang memvalidasi domain API sebagai `/server_ca.pem`. `SERVER` harus memakai HTTPS; firmware tidak menggunakan `setInsecure`. Host perangkat harus dapat menyinkronkan waktu NTP agar validasi sertifikat berhasil. Token baru menggantikan token lama; lakukan pembaruan server, firmware, dan counting secara terkoordinasi.

Isi `counting/.env` berdasarkan `counting/.env.example` bila menjalankan lewat `pnpm dev:counting` (atau `pnpm dev` untuk seluruh layanan development). Untuk layanan yang menjalankan Python langsung, export konfigurasi ke environment proses. Set URL RTSP dan kredensial kamera melalui environment. Gunakan port MJPEG berbeda per boks dan petakan secara eksplisit dalam `MJPEG_PORTS` backend. Server MJPEG hanya bind loopback.

Antrean perintah baru hanya menerima `SYNC_USERS`. Perangkat melakukan refresh lalu ACK ID perintah; retry tidak membuka relay. Tidak ada migrasi otomatis perintah lama, dan tidak ada fitur remote override keselamatan.

## Production tanpa Docker

- Sajikan **hanya** `frontend/dist`. Jangan jadikan root repository, `api/`, `.git`, `.env`, atau firmware sebagai document root.
- Jalankan backend sebagai pengguna OS terbatas dengan `NODE_ENV=production`, `FRONTEND_URL=https://domain-aktual`, dan akun database non-root dengan password kuat. Binding backend tetap loopback.
- Terminasi HTTPS pada reverse proxy. Proxy `/api/` ke `http://127.0.0.1:5002/api/`. Pertahankan header `Origin` dan cookie; tetapkan `TRUST_PROXY=loopback` hanya untuk proxy lokal yang benar-benar dipercaya.
- Cookie production menggunakan `__Host-eloto_session`, Secure, HttpOnly, SameSite=Strict. Gunakan frontend dan API pada origin yang sama. Jangan memindahkan token sesi ke localStorage atau URL gambar/stream.
- Proxy stream memerlukan buffering dimatikan. Atur timeout stream, batas request body 8 MB, dan header keamanan pada penyajian frontend.
- Probe `/health/live` untuk proses dan `/health/ready` untuk koneksi database. Pakai process manager yang meneruskan SIGTERM; backend menutup koneksi pada shutdown.
- Ambil backup database/media secara berkala, uji restore, dan siapkan retensi log/event. Jangan menghapus receipt deduplikasi selama perangkat masih mungkin mengirim replay yang bersangkutan.

Contoh lokasi Nginx di dalam virtual host HTTPS yang telah dikonfigurasi:

```nginx
root /srv/eloto/frontend/dist;
client_max_body_size 8m;

location /api/ {
    proxy_pass http://127.0.0.1:5002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 60s;
}
location /health/ {
    allow 127.0.0.1;
    deny all;
    proxy_pass http://127.0.0.1:5002;
}
location ~ /\. { deny all; }
location ~ \.php$ { return 410; }
location / { try_files $uri $uri/ /index.html; }
```

Contoh ini bukan konfigurasi sertifikat lengkap. Uji pada hostname dan jaringan target sebelum dipakai.

## Pemeriksaan

```bash
pnpm --filter backend test
pnpm --filter frontend lint
pnpm --filter frontend build
python3 -m unittest discover -s counting/tests -v
pnpm audit --prod
```

Tes Node memakai server localhost sementara dan database tiruan; tidak mengubah database operasional. Tes Python tidak memerlukan kamera, model, atau GPU. Hasil pengujian dan batas audit ada di [PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md). Pengujian database nyata, compile firmware, fault injection perangkat, dan uji lapangan tetap diperlukan sebelum go-live.
