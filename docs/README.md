# Dokumentasi E-LOTO

Dokumentasi ini menjelaskan implementasi aktif di `frontend/`, `backend/`, `counting/`, dan `esp32/`. Folder `api/` dan `index.html` root adalah peninggalan versi lama.

| Kebutuhan | Panduan |
| --- | --- |
| Menjalankan proyek pertama kali | [README utama](../README.md) |
| Memahami komponen dan alur data | [Arsitektur](ARCHITECTURE.md) |
| Mengisi environment dan konfigurasi SD | [Konfigurasi](CONFIGURATION.md) |
| Mengintegrasikan browser atau perangkat | [API](API.md) |
| Migrasi, akun admin, token perangkat, deployment | [Deployment](DEPLOYMENT.md) |
| Menangani kegagalan startup, login, dan stream | [Troubleshooting](TROUBLESHOOTING.md) |
| Menilai hasil pengujian dan pekerjaan sebelum go-live | [Audit production](PRODUCTION_AUDIT.md) |

Urutan persiapan: konfigurasi database → migrasi → bootstrap admin → jalankan web → daftarkan boks → provision token → konfigurasi perangkat/counting → uji integrasi. Docker belum termasuk pekerjaan saat ini.

Dokumentasi tidak menggantikan validasi keselamatan LOTO di perangkat dan lokasi penggunaan. Hasil tes lokal serta pekerjaan yang belum diverifikasi dicatat terpisah dalam audit.
