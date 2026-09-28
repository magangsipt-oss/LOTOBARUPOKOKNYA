# Setup kredensial perangkat ESP32

## 1. Buat token unik

Jangan menaruh token di argumen CLI, source code, dokumentasi, atau Git.

```bash
read -rs ELOTO_DEVICE_TOKEN
export ELOTO_DEVICE_TOKEN
export ELOTO_BOX_ID='BOX ELOTO 1'
```

Gunakan nilai acak minimal 32 karakter, misalnya hasil `openssl rand -hex 32` yang disimpan langsung ke secret manager.

## 2. Provision backend

```bash
pnpm --filter backend run provision-device
unset ELOTO_DEVICE_TOKEN
```

Database menyimpan SHA-256 token. Token plaintext hanya dipasang pada SD perangkat.

## 3. Siapkan SD ESP32

Salin `esp32/config.example.txt` menjadi `/config.txt` pada SD lalu isi nilai nyata:

```text
DEVICE_ID=BOX ELOTO 1
WIFI_1_SSID=your-primary-wifi
WIFI_1_PASS=your-primary-wifi-password
WIFI_2_SSID=your-backup-wifi
WIFI_2_PASS=your-backup-wifi-password
SERVER=https://eloto.example.com
TOKEN=replace-with-the-provisioned-token
```

Untuk HTTPS, pasang CA yang memvalidasi hostname server sebagai `/server_ca.pem`. Firmware menyinkronkan waktu NTP dan tidak memakai `setInsecure`.

HTTP hanya diterima untuk alamat LAN privat dan ditujukan untuk development. Token lewat HTTP tidak terenkripsi, jadi jangan gunakan mode tersebut pada jaringan tidak tepercaya atau production.

## 4. Verifikasi

Upload firmware, restart ESP32, lalu periksa Serial Monitor:

```text
[CONFIG] WiFi profiles: 2
[CONFIG] Server: https://eloto.example.com/
[CONFIG] Token: configured
[CONFIG] TLS CA: configured
```

Dashboard harus menampilkan boks online setelah telemetri berhasil. Respons `401` berarti token SD dan hash database tidak cocok. Timeout biasanya berarti `SERVER`, firewall, DNS, CA, atau waktu NTP bermasalah.

Rotasi token yang pernah masuk Git atau log. Riwayat Git lama tetap menyimpan nilai yang sudah pernah dikomit.
