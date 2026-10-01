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

Seeder demo memerlukan `ELOTO_DEMO_PASSWORD` minimal 12 karakter dan tidak boleh dipakai untuk production.

MySQL tidak memberi rollback atomik untuk seluruh rangkaian DDL. Runner memakai koneksi terkunci dan pemeriksaan indeks/kolom agar langkah yang sudah selesai dapat dilewati ketika diulang, tetapi kegagalan DDL tetap perlu diperiksa sebelum retry. Tidak ada `sync(force)` atau penghapusan tabel otomatis pada runner baru.

Akun plaintext lama tidak lagi bisa login. Reset kata sandi akun tersebut dengan password baru yang kuat; password reset tidak boleh memakai SID. Skrip tidak mencetak kata sandi:

```bash
export ELOTO_USER_SID=Admin
read -rs ELOTO_NEW_PASSWORD
export ELOTO_NEW_PASSWORD
pnpm --filter backend run reset-password
unset ELOTO_NEW_PASSWORD
```

Untuk database baru tanpa administrator, isi `ELOTO_USER_SID` dan `ELOTO_NEW_PASSWORD` lalu jalankan `pnpm --filter backend run bootstrap-admin`. Password minimal 12 karakter, maksimal 72 byte, dan tidak boleh sama dengan SID. `seed` adalah data demo dan ditolak pada production.

## Kredensial perangkat dan counting

Buat token acak kriptografis terpisah untuk setiap boks (minimal 32 karakter). Simpan di pengelola rahasia; jangan menaruh token dalam frontend atau Git.

```bash
export ELOTO_BOX_ID='BOX ELOTO 1'
read -rs ELOTO_DEVICE_TOKEN
export ELOTO_DEVICE_TOKEN
pnpm --filter backend run provision-device
unset ELOTO_DEVICE_TOKEN
```

Boks harus sudah terdaftar. Database menyimpan hash token. Pasang token asli pada `/config.txt` di SD ESP32 menggunakan format `esp32/config.example.txt`; nilai `TOKEN` di SD menggantikan fallback compile lokal. Untuk VPS, set `SERVER=https://domain-anda`, salin root CA sertifikat tepercaya ke `/server_ca.pem` pada SD, lalu pastikan ESP32 dapat menjangkau DNS dan NTP. Sketch memverifikasi CA dan nama host; jangan mengekspos backend port `5002` ke internet. HTTP hanya untuk IP privat di LAN tepercaya. Tanpa `SERVER` valid, firmware tidak menebak host atau memindai subnet. Rotasi token mengganti token lama, jadi perbarui server dan SD perangkat secara terkoordinasi sebelum operasi dilanjutkan.

Isi `counting/.env` berdasarkan `counting/.env.example` bila menjalankan lewat `pnpm dev:counting` (atau `pnpm dev` untuk seluruh layanan development). Untuk layanan yang menjalankan Python langsung, export konfigurasi ke environment proses. Set URL RTSP dan kredensial kamera melalui environment. Gunakan port MJPEG berbeda per boks dan petakan secara eksplisit dalam `MJPEG_PORTS` backend. Server MJPEG hanya bind loopback.

Antrean perintah baru hanya menerima `SYNC_USERS`. Perangkat melakukan refresh lalu ACK ID perintah; retry tidak membuka relay. Tidak ada migrasi otomatis perintah lama, dan tidak ada fitur remote override keselamatan.

## Production tanpa Docker

- Sajikan **hanya** `frontend/dist`. Jangan jadikan root repository, `api/`, `.git`, `.env`, atau firmware sebagai document root.
- Jalankan backend sebagai pengguna OS terbatas dengan `NODE_ENV=production`, `FRONTEND_URL` yang sama dengan origin HTTPS publik, dan akun database non-root dengan password kuat. Binding backend tetap loopback.
- Terminasi HTTPS pada reverse proxy. Proxy `/api/` ke `http://127.0.0.1:5002/api/`. Pertahankan `Host`, `Origin`, cookie, dan header `X-Device-Token`; backend production mempercayai proxy loopback secara default. Jangan membuka port backend `5002` ke internet.
- Cookie production menggunakan `__Host-eloto_session`, Secure, HttpOnly, SameSite=Lax. Sajikan frontend dan API pada origin yang sama (`VITE_API_URL=/api`). Jangan memindahkan token sesi ke localStorage atau URL gambar/stream.
- Proxy stream memerlukan buffering dimatikan. Atur timeout stream, batas request body 8 MB, dan header keamanan pada penyajian frontend.
- Probe `/health/live` untuk proses dan `/health/ready` untuk koneksi database. Pakai process manager yang meneruskan SIGTERM; backend menutup koneksi pada shutdown.
- Ambil backup database/media secara berkala, uji restore, dan siapkan retensi log/event. Jangan menghapus receipt deduplikasi selama perangkat masih mungkin mengirim replay yang bersangkutan.

VPS `103.197.188.61` saat ini menyajikan aplikasi di `https://103.197.188.61` memakai sertifikat IP Let’s Encrypt. Sertifikat IP memakai profil `shortlived` dan berlaku sekitar 160 jam. Pertahankan Certbot minimal 5.4, timer renewal otomatis, hook reload Nginx, serta akses inbound port 80 untuk challenge HTTP-01 dan port 443 untuk aplikasi. Lihat panduan [Let’s Encrypt untuk sertifikat IP di Certbot](https://letsencrypt.org/2026/03/11/shorter-certs-certbot).

Contoh lokasi Nginx di dalam virtual host HTTPS yang telah dikonfigurasi:

```nginx
root /srv/eloto/current/frontend/dist;
client_max_body_size 8m;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy strict-origin-when-cross-origin always;

location /api/ {
    proxy_pass http://127.0.0.1:5002;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Device-Token $http_x_device_token;
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

## Deploy dari GitHub Actions ke BiznetGIO

Workflow [deploy-biznetgio.yml](../.github/workflows/deploy-biznetgio.yml) mengirim build frontend dan source backend dari branch `main` melalui SSH. Perubahan pada FE/BE di `main` otomatis memicu deploy; deploy manual tersedia dari tab **Actions**. Counting worker tidak dijalankan oleh workflow ini. Untuk migrasi awal, jalankan manual dengan `activate` mati agar backend tidak dinyalakan sebelum skema database ditinjau.

### Rahasia GitHub

Di repository, buka **Settings → Secrets and variables → Actions → New repository secret**, lalu isi:

- `DEPLOY_SSH_KEY`: isi private key SSH lengkap untuk akun `admin123`. Private key tidak perlu dikirim ke chat atau disimpan di Git.
- `DEPLOY_KNOWN_HOSTS`: baris host key SSH untuk `103.197.188.61` pada port 22. Pertahankan baris mentah dari `ssh-keyscan` setelah fingerprint-nya dicocokkan lewat console/provider; jangan langsung percaya hasil scan yang belum diverifikasi. Workflow menerima format host standar untuk port 22 maupun `[103.197.188.61]:22`.

Key harus cocok dengan public key yang terpasang untuk akun `admin123` pada VPS dan dapat dibaca `ssh-keygen` tanpa passphrase.

### Persiapan VPS satu kali

Instruksi ini untuk Linux dengan systemd, Node.js 22+, Corepack/pnpm 11.25.0, MySQL yang sudah dibuat, dan Nginx/TLS pada domain production. Bila OS VPS berbeda, sesuaikan pemasangan paket dan lokasi executable sebelum deploy.

Siapkan direktori agar `admin123` dapat menulis release dan Nginx (`www-data`) dapat membaca hasil frontend:

```bash
sudo install -d -o admin123 -g www-data -m 2750 \
  /srv/eloto /srv/eloto/incoming /srv/eloto/releases /srv/eloto/shared \
  /srv/eloto/shared/uploads /srv/eloto/shared/legacy-uploads
sudo touch /srv/eloto/shared/backend.env
sudo chown admin123:admin123 /srv/eloto/shared/backend.env
sudo chmod 0600 /srv/eloto/shared/backend.env
```

Sebelum migrasi atau aktivasi, isi `/srv/eloto/shared/backend.env` di VPS dengan `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=5002`, `FRONTEND_URL` untuk origin HTTPS publik, akun MySQL non-root, password kuat, dan `MJPEG_PORTS={}` bila counting memang tidak dijalankan. Untuk deploy IP langsung, gunakan `FRONTEND_URL=https://103.197.188.61`; domain juga dapat digunakan bila DNS dan sertifikatnya disiapkan. Mode persiapan release (`activate` mati) tidak memerlukan file ini terisi; mode aktivasi akan menolak file kosong. Jangan commit atau mengirim file ini. Pastikan Nginx memakai konfigurasi HTTPS yang sesuai.

Setelah workflow pertama selesai dengan `activate` mati, file service tersedia pada release yang tercetak di log Actions. Pasang unit itu dari VPS:

```bash
sudo install -m 0644 /srv/eloto/releases/<release-id>/ops/systemd/eloto-backend.service /etc/systemd/system/eloto-backend.service
sudo systemctl daemon-reload
sudo systemctl enable eloto-backend.service
```

Agar Actions hanya dapat restart dan memeriksa service tersebut, tambahkan aturan sempit melalui `sudo visudo -f /etc/sudoers.d/eloto-deploy`:

```sudoers
admin123 ALL=(root) NOPASSWD: /usr/bin/systemctl restart eloto-backend.service, /usr/bin/systemctl is-active eloto-backend.service
```

Pastikan aplikasi dapat terhubung ke MySQL sebelum activation. Untuk database baru, jalankan workflow dengan `activate` mati; setelah paket siap dan backup/schema ditinjau, pasang service lalu jalankan migrasi:

```bash
cd /srv/eloto/releases/<release-id>
corepack pnpm --filter backend run migrate
```

`<release-id>` tercetak pada log job Actions. Setelah migrasi selesai, jalankan workflow lagi dengan `activate` dicentang. Deployment aktif mengganti symlink release, restart backend, memeriksa `/health/ready`, dan mengembalikan release sebelumnya bila pemeriksaan gagal. Workflow tidak menjalankan migrasi otomatis dan tidak menghapus release lama.

### Menjalankan deploy

1. Pastikan rahasia Actions di atas terisi dan VPS memenuhi persiapan satu kali sebelum mengubah FE/BE di `main`.
2. Untuk deploy awal, buka **Actions → Deploy E-LOTO to BiznetGIO → Run workflow**, pilih `main`, lalu biarkan `activate` mati.
3. Selesaikan migrasi database dan persiapan service. Jalankan workflow manual lagi dengan `activate` dicentang; push FE/BE berikutnya ke `main` akan deploy otomatis.

SSH dan file workflow saja belum cukup untuk go-live jika domain/TLS, database, atau Node.js VPS belum disiapkan. Jangan push perubahan aplikasi ke `main` sebelum dua Actions secrets tersedia, karena job otomatis akan gagal saat SSH.

## Pemeriksaan

```bash
pnpm --filter backend test
pnpm --filter frontend lint
pnpm --filter frontend build
python3 -m unittest discover -s counting/tests -v
pnpm audit --prod
```

Tes Node memakai server localhost sementara dan database tiruan; tidak mengubah database operasional. Tes Python tidak memerlukan kamera, model, atau GPU. Hasil pengujian dan batas audit ada di [PRODUCTION_AUDIT.md](PRODUCTION_AUDIT.md). Pengujian database nyata, compile firmware, fault injection perangkat, dan uji lapangan tetap diperlukan sebelum go-live.
