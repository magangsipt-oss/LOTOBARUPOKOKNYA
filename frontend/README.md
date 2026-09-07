# Frontend E-LOTO

Dashboard React + Vite untuk backend E-LOTO. Panduan proyek lengkap ada di [README utama](../README.md) dan [indeks dokumentasi](../docs/README.md).

Dari root repository:

```bash
pnpm install --frozen-lockfile
pnpm --parallel -r run dev
```

Frontend tersedia di `http://localhost:3000`. Vite meneruskan `/api` ke backend `127.0.0.1:5002`, yang membutuhkan MySQL dan migrasi. Untuk menjalankan frontend saja: `pnpm --filter frontend run dev`.

```bash
pnpm --filter frontend lint
pnpm --filter frontend build
```

Hasil build berada di `frontend/dist/`. `VITE_API_URL` default `/api`; jangan masukkan rahasia ke environment Vite. Autentikasi menggunakan cookie server dan CSRF, dengan pemulihan sesi melalui `/api/users/me`.

Direktori `src/pages` berisi halaman, `src/components` komponen UI, `src/context` state aplikasi/autentikasi, `src/services` client API, dan `src/utils` helper. Lihat [panduan deployment](../docs/DEPLOYMENT.md) untuk penyajian SPA, HTTPS, dan proxy stream.
