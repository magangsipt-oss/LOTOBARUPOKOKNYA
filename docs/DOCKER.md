# E-LOTO di Docker

Tiga container, diatur oleh `compose.yaml`:

| Service | Isi | Data tetap (volume) |
|---|---|---|
| `db` | MySQL 8.0.46, hanya di `127.0.0.1:3306` | `db_data` |
| `backend` | API Node.js (`backend/`) | `uploads`, `legacy_uploads` (foto) |
| `web` | Caddy: dashboard React, HTTPS otomatis, proxy `/api` ke backend | `caddy_data` (sertifikat) |

`counting/` (YOLO kamera) tidak ikut; program itu jalan di jaringan lokal dekat kamera.

HTTPS:
- Domain (`ELOTO_DOMAIN`, `www.` → domain) dapat sertifikat Let's Encrypt biasa.
- IP server (`ELOTO_IP`) dapat sertifikat IP Let's Encrypt profil `shortlived` (6 hari, diperpanjang otomatis oleh Caddy). Box memakai alamat ini: hanya `/api/` yang dilayani; halaman lain dialihkan ke domain.
- Port 80 dan 443 harus terbuka di firewall server.

## Tes di laptop

```bash
cp .env.example .env            # isi DB_PASSWORD dan MYSQL_ROOT_PASSWORD
docker compose -f compose.yaml -f compose.local.yaml up -d --build db
docker compose -f compose.yaml -f compose.local.yaml run --rm migrate
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

Buka https://localhost:8443 (peringatan sertifikat wajar: sertifikat lokal). MySQL di `127.0.0.1:3308`.
Buat admin pertama:

```bash
docker compose -f compose.yaml -f compose.local.yaml run --rm \
  -e ELOTO_USER_SID=Admin -e ELOTO_NEW_PASSWORD='minimal-12-karakter' migrate node scripts/bootstrap-admin.js
```

Matikan: `docker compose -f compose.yaml -f compose.local.yaml down` (tambah `-v` untuk menghapus datanya juga).

## Server

1. Pasang Docker: https://docs.docker.com/engine/install/ubuntu/
2. Salin repo ke server, lalu `cp .env.example .env && chmod 600 .env` dan isi `ELOTO_DOMAIN`, `ELOTO_IP`, password.
3. `docker compose up -d --build db && docker compose run --rm migrate && docker compose up -d --build`
4. Cek: `docker compose ps` (semua `healthy`/`running`), `docker compose logs -f web` (sertifikat terbit).

Perintah harian:

```bash
docker compose ps                          # status
docker compose logs -f backend             # log backend
docker compose up -d --build               # pasang versi kode terbaru
docker compose run --rm migrate            # setelah ada migrasi baru
docker compose run --rm -e ELOTO_USER_SID=SID -e ELOTO_NEW_PASSWORD='...' migrate node scripts/reset-password.js
```

Import personel HSE (file berisi data pribadi; simpan di luar repo, misalnya `/opt/eloto-archive/`):

```bash
docker compose run --rm -v /path/ke/hse-export:/data:ro migrate node scripts/import-hse-employees.js /data/mtl-employees.hse.json           # dry-run
docker compose run --rm -v /path/ke/hse-export:/data:ro migrate node scripts/import-hse-employees.js /data/mtl-employees.hse.json --apply   # tulis
```

## Production saat ini

- Server: `admin@103.139.192.146` (IDCloudHost, Ubuntu 24.04), aplikasi di `/opt/eloto`, rahasia di `/opt/eloto/.env`.
- SSH hanya dengan key (login password dimatikan di `/etc/ssh/sshd_config.d/00-eloto-hardening.conf`).
- Arsip dari VPS lama: `/opt/eloto-archive/`.

## Deploy otomatis (GitHub Actions)

Push ke `main` yang mengubah `backend/`, `frontend/`, `docker/`, `compose.yaml`, atau lockfile menjalankan
`.github/workflows/deploy-docker.yml`. Workflow mengirim arsip kode lewat SSH; server menjalankan
`/opt/eloto-deploy/deploy.sh` (salinan `ops/deploy-docker.sh`), yang:

1. menyimpan image yang sedang jalan sebagai `:previous`,
2. menyalin kode ke `/opt/eloto` (kecuali `.env`), build, lalu `docker compose up -d --wait`,
3. bila container baru tidak sehat dalam 180 detik, kembali ke image `:previous`.

Key GitHub di `~/.ssh/authorized_keys` dikunci ke skrip itu (`command="/opt/eloto-deploy/deploy.sh",restrict`),
jadi key itu tidak bisa membuka shell. Secret repo: `DOCKER_DEPLOY_SSH_KEY`, `DOCKER_DEPLOY_KNOWN_HOSTS`.

Migrasi database tetap manual: setelah deploy yang membawa migrasi baru, backup dulu, lalu
`docker compose run --rm migrate` dan `docker compose up -d`.

Bila `ops/deploy-docker.sh` berubah, pasang ulang di server:
`ssh admin@103.139.192.146 'cat > /opt/eloto-deploy/deploy.sh' < ops/deploy-docker.sh`.

## Backup

```bash
docker compose exec -T db sh -c 'exec mysqldump --single-transaction --routines --triggers --no-tablespaces -uroot -p"$MYSQL_ROOT_PASSWORD" eloto_db' | gzip > eloto_db-$(date +%F).sql.gz
docker run --rm -v eloto_uploads:/src:ro -v "$PWD":/out alpine tar -czf /out/uploads-$(date +%F).tar.gz -C /src .
```

Jangan pernah `docker compose down -v` di server: `-v` menghapus database dan foto.

## DBeaver

Sama seperti sebelumnya: `ssh -N -L 3307:127.0.0.1:3306 <user>@<server>`, lalu DBeaver ke `localhost:3307`.
