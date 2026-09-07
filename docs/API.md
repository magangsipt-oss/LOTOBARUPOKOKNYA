# API aktif

Base path adalah `/api`. Dokumen ini merangkum endpoint utama; definisi route berada di [backend/routes](../backend/routes) dan aturan akses di [authorization.js](../backend/middleware/authorization.js).

## Autentikasi

`POST /api/users/login` menerima JSON SID/password dan mengembalikan data pengguna serta `csrfToken`; token sesi dikirim sebagai cookie HttpOnly. Browser memakai cookie tersebut dan header `X-CSRF-Token` untuk mutasi. `GET /api/users/me` memulihkan data pengguna dan CSRF. Logout memakai `POST /api/users/logout`; perubahan password memakai `POST /api/users/password` dan mencabut sesi pengguna.

Perangkat memakai header `X-Device-Token` berisi token asli yang diprovision untuk boksnya. Jangan menggunakan token perangkat sebagai identitas browser. Encode ID yang mengandung spasi ketika membentuk URL.

## Endpoint utama

Semua path di tabel relatif terhadap `/api`. Pembacaan oleh pengguna web yang terautentikasi diizinkan oleh middleware; mutasi mengikuti role dan validasi controller.

| Metode dan path | Fungsi / akses mutasi |
| --- | --- |
| `GET /users`, `GET /users/:sid` | Direktori pengguna |
| `POST /users`, `DELETE /users/:sid` | Kelola pengguna; admin |
| `PUT /users/:sid` | Admin, atau edit profil sendiri dengan field terbatas |
| `GET /boxes`, `GET /boxes/:idBox` | Snapshot boks |
| `POST /boxes`, `PUT /boxes/:idBox`, `DELETE /boxes/:idBox` | Kelola boks; admin |
| `POST /boxes/:idBox/telemetry` | Telemetri; hanya perangkat boks yang sama, wajib `event_id` |
| `POST /commands` | Antrekan `SYNC_USERS`; admin |
| `GET /commands/:idBox/pending` | Ambil perintah pending; perangkat hanya boks sendiri |
| `PATCH /commands/:idBox/clear` | ACK ID perintah; perangkat hanya boks sendiri, admin juga diizinkan |
| `GET /logs/tapping-history` | Riwayat tapping |
| `GET /logs/tapping-history/stats` | Statistik; perangkat wajib query `id_box` atau `idBox` boks sendiri |
| `POST /logs/people-counting` | Kirim count; perangkat dengan `id_box` sendiri |
| `GET /logs/people-counting/:idBox` | Count terbaru dan status stale |
| `GET /logs/people-counting/:idBox/history` | Riwayat counting |
| `GET /supervisor/team` | Baca tim melalui query `supervisor_sid` dan `id_box` |
| `POST /supervisor/team` | Simpan tim; admin atau pengawas dengan `supervisor_sid` sendiri |
| `GET /maintenance`, `POST /maintenance` | Baca maintenance; tambah oleh admin, pengawas, atau teknisi |
| `GET /refueling`, `POST /refueling/start` | Baca refueling; mulai melalui API oleh admin |
| `PATCH /refueling/:id` | Akhiri refueling; admin |
| `GET /stream` | Daftar stream dan status konfigurasi |
| `GET /stream/:idBox` | MJPEG melalui proxy terautentikasi |
| `GET /stream/proxy/:idBox` | Snapshot hardware dari database |

Perangkat juga diizinkan membaca `/users`, `/users/photo/:uid`, serta `POST /users/check-card`. Respons direktori untuk perangkat dibatasi pada atribut identitas/kartu yang dibutuhkan. Endpoint perangkat lain ditolak secara default. Role fuelman tidak otomatis memiliki izin mutasi refueling pada middleware saat ini.

Endpoint `PATCH /boxes/:idBox/state` masih terdaftar pada router, tetapi ditolak oleh aturan otorisasi saat ini. Jangan menggunakannya untuk kontrol perangkat.

## Kegagalan dan kesehatan

| Status | Makna umum |
| --- | --- |
| `400` | Payload atau parameter tidak valid |
| `401` | Sesi/token tidak valid atau kedaluwarsa |
| `403` | Role, identitas boks, origin, atau CSRF tidak diizinkan |
| `404` | Data, route, atau konfigurasi stream tidak ditemukan |
| `409` | Konflik aturan data, misalnya penghapusan saat sesi aktif |
| `429` | Rate limit tercapai |
| `500` | Kegagalan internal; periksa log server |
| `502`, `503` | Upstream stream atau layanan belum tersedia |

Di luar `/api`, `GET /health/live` memeriksa proses dan `GET /health/ready` memeriksa koneksi database. Health endpoint tidak memerlukan login pada aplikasi; batasi akses melalui reverse proxy sesuai kebutuhan operasional.

Implementasi client browser ada di [api.js](../frontend/src/services/api.js). Untuk payload rinci, gunakan controller terkait dan [validator telemetri](../backend/domain/telemetry.js); tabel ini bukan schema OpenAPI lengkap.
