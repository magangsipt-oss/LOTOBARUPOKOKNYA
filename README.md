# E-LOTO

Aplikasi pemantauan Lockout/Tagout dengan dashboard web, API Node.js, perangkat ESP32, dan people counting dari kamera. Dashboard menampilkan status boks, pekerja, riwayat tapping, maintenance, refueling, dan hasil counting.

**Status:** penguatan kode dan pengujian lokal sudah dilakukan, tetapi kelayakan production belum dinyatakan. Migrasi pada MySQL nyata, kompilasi firmware, dan pengujian perangkat masih diperlukan. Lihat [hasil dan batas audit](docs/PRODUCTION_AUDIT.md).

## Struktur proyek

| Lokasi | Fungsi |
| --- | --- |
| `frontend/` | Dashboard React + Vite; hasil build di `frontend/dist/` |
| `backend/` | API Express, autentikasi, akses MySQL, migrasi, dan tes |
| `counting/` | Worker Python untuk RTSP, deteksi orang, dan MJPEG |
| `esp32/` | Firmware dan contoh konfigurasi SD perangkat |
| `docs/` | Panduan pengembangan, integrasi, dan operasional |

## Mulai development

Siapkan Node.js, pnpm, dan MySQL. Workspace mencantumkan pnpm `11.25.0` pada paket backend. Python dan dependency `counting/requirements.txt` diperlukan: `pnpm dev` menjalankan frontend, backend, dan people counting sekaligus. Isi `counting/.env` berdasarkan contoh sebelum menjalankan. Firmware ESP32 tetap dijalankan terpisah.

Jalankan dari root repository:

```bash
pnpm install --frozen-lockfile
```

Buat `backend/.env` berdasarkan [contoh konfigurasi backend](backend/.env.example), lalu isi koneksi MySQL. Gunakan database development terpisah. Konfigurasi frontend tersedia di [frontend/.env.example](frontend/.env.example); URL API bawaan adalah `/api`.

Untuk **database development kosong yang sudah dibuat**, jalankan:

```bash
pnpm --filter backend run migrate
export ELOTO_USER_SID=Admin
read -rs ELOTO_NEW_PASSWORD
export ELOTO_NEW_PASSWORD
pnpm --filter backend run bootstrap-admin
unset ELOTO_NEW_PASSWORD
```

Masukkan kata sandi minimal 12 karakter saat `read` menunggu input; ketikan tidak ditampilkan. Untuk database lama, ikuti [prosedur baseline dan backup](docs/DEPLOYMENT.md), bukan prosedur database kosong.

Jalankan aplikasi:

```bash
pnpm --parallel -r run dev
```

Buka **http://localhost:3000**. Vite meneruskan `/api` ke backend pada `127.0.0.1:5002`. Backend hanya dapat start setelah MySQL, konfigurasi, dan migrasi siap. Login memakai akun yang dibuat melalui bootstrap, bukan kredensial demo bawaan.

## Perintah rutin

Semua perintah berikut dijalankan dari root repository.

| Perintah | Kegunaan |
| --- | --- |
| `pnpm --parallel -r run dev` | Jalankan frontend dan backend development |
| `pnpm --filter backend test` | Tes backend dan helper dengan database tiruan |
| `pnpm --filter frontend lint` | Periksa kode frontend |
| `pnpm --filter frontend build` | Bangun aset production ke `frontend/dist/` |
| `python3 -m unittest discover -s counting/tests -v` | Tes sinkronisasi counting tanpa kamera |
| `pnpm audit --prod` | Periksa advisori dependency Node production |
| `pnpm --filter backend start` | Jalankan backend tanpa mode watch |

## Dokumentasi

Mulai dari [indeks dokumentasi](docs/README.md):

- [Arsitektur dan alur data](docs/ARCHITECTURE.md)
- [Konfigurasi backend, frontend, counting, dan ESP32](docs/CONFIGURATION.md)
- [Kontrak autentikasi dan endpoint utama](docs/API.md)
- [Migrasi, akun, provisioning, dan deployment](docs/DEPLOYMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Audit production dan batas verifikasi](docs/PRODUCTION_AUDIT.md)

Docker ditunda. Deployment web menggunakan `frontend/dist/` dan backend aktif; jangan menyajikan root repository atau folder PHP lama sebagai document root.
