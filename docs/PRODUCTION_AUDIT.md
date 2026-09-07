# Audit dan perbaikan E-LOTO

Tanggal: 7 September 2026. Ruang lingkup aktif: backend Node.js, frontend React, layanan counting Python, dan firmware ESP32. `api/` serta `index.html` dikonfirmasi sebagai versi lama. Deployment hanya boleh menyajikan `frontend/dist`, bukan root repository atau folder PHP.

## Perubahan yang diterapkan

- Login diarahkan ke handler yang benar; sesi acak 256-bit disimpan sebagai hash di database, memakai cookie HttpOnly/SameSite dan Secure pada production. Logout dan perubahan kata sandi mencabut sesi. Identitas/peran diperiksa dari database pada setiap request; sessionStorage bukan sumber otorisasi.
- Semua API aktif memerlukan autentikasi. Mutasi memerlukan pemeriksaan peran dan CSRF untuk pengguna browser. Token perangkat terpisah per boks, disimpan sebagai SHA-256, dan tidak mengizinkan CRUD pengguna atau telemetri boks lain. Token bersama dalam bundle frontend dihapus.
- Login memiliki pembatasan IP tersendiri; request yang sudah terautentikasi dibatasi per akun/perangkat sehingga polling normal dan pengguna di balik NAT tidak saling menghabiskan kuota. Batas bawaan 300 request/menit/principal harus dievaluasi pada uji beban nyata. Limiter masih in-memory: deployment ini ditujukan untuk satu instance Node; beberapa replica memerlukan penyimpanan limiter bersama.
- Kredensial default firmware/kamera dihapus dari kode aktif. Firmware memakai HTTPS dengan CA dari SD dan token perangkat. Layanan counting mengirim identitas perangkat yang sama. HTTP status firmware memerlukan token; browser memperoleh status melalui snapshot telemetri backend, tanpa fetch ke IP database (menutup jalur SSRF).
- Perintah memiliki ID terpisah, batas antrean, masa berlaku 10 menit, dan ACK berdasarkan ID+boks. Hanya `SYNC_USERS` didukung; operasi ini aman diulang. Tidak ada perintah remote membuka relay. Perintah lama pada `boxes.pending_cmd` tidak dipindahkan/dieksekusi otomatis.
- Telemetri, log, snapshot antrean, dan nomor sesi disimpan dalam satu transaksi dengan kunci baris boks. `event_id` mencegah catatan ganda saat retry. Replay offline menyimpan bukti dan tidak menimpa status terkini; sesi replay yang tidak diketahui tetap NULL, bukan ditebak.
- Koordinat tanpa GPS fix tidak mengganti koordinat terakhir atau menyebabkan kegagalan NOT NULL. Snapshot menyimpan status GPS agar lokasi lama tidak dianggap fix baru. Registrasi RFID kembali mengisi buffer. State pendek firmware dinormalisasi untuk frontend.
- Penyimpanan tim memvalidasi pengawas/mekanik, mempertahankan jenis pemeliharaan, dan memakai transaksi. Kontrak `id_box` untuk laporan frontend diperbaiki. Fungsi model log yang hilang ditambahkan.
- Perubahan profil tidak mengosongkan fingerprint. Unggahan gambar dibatasi, didekode ulang, diubah ukuran, dan memakai nama unik. Kata sandi baru wajib minimal 12 karakter/maksimal 72 byte. Login plaintext lama ditolak; akun lama perlu reset password. Administrator terakhir dan personel yang tercatat aktif tidak dapat dihapus melalui endpoint penghapusan.
- Tombol override yang sebelumnya hanya memalsukan tampilan sukses dihapus. Waktu tapping buatan dihapus. Durasi sesi berasal dari waktu tersimpan server. Kondisi offline dan kamera kedaluwarsa ditampilkan sebagai tidak diketahui, bukan antrean kosong/jumlah nol. Popup peta dan ekspor HTML/CSV diberi escaping. State UI dipisahkan per sesi pengguna.
- Migrasi `sync({ force: true })` diganti runner migrasi berurutan, ledger, advisory lock, dan pemeriksaan baseline. Demo seed ditolak di production. Health readiness/startup menolak database yang tidak tersedia; shutdown menutup koneksi dengan tenggat.
- SheetJS diperbarui dari 0.18.5 ke 0.20.3 melalui [distribusi resmi SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/). Dependency uuid milik Sequelize dioverride ke 11.1.1, dengan pemeriksaan API v4. Lockfile root adalah sumber instalasi workspace.

## Batas verifikasi dan pekerjaan sebelum go-live

Ini audit kode dan pengujian lokal, bukan sertifikasi keselamatan sistem LOTO. Jangan menyatakan sistem siap production hanya karena tes berikut lulus.

- MySQL lokal `127.0.0.1:3306` menolak koneksi; Docker ditunda sesuai instruksi pengguna. Tidak ada migrasi, reset password, seed, atau perubahan data operasional yang dijalankan. Tes database memakai doubles: SQL, indeks, transaksi, baseline schema lama, dan perilaku MySQL nyata masih perlu integration test pada salinan database.
- Toolchain Arduino/TFT dan perangkat fisik tidak tersedia. Firmware belum dikompilasi/di-flash. Wajib menguji konfigurasi board/pin, sertifikat/TLS + waktu NTP, heap/task stack, SD penuh/gagal, putus daya ketika sesi aktif, relay saat boot/reboot, urutan RFID, dan pemulihan sesi. Perilaku elektrik relay tidak diubah atau diasumsikan aman oleh audit ini.
- Struktur antrean dan state firmware masih dibaca/diubah lintas task; validasi sinkronisasi dan konsistensi snapshot membutuhkan pengujian perangkat. Penyimpanan offline dapat gagal jika SD tidak tersedia/penuh atau mutex gagal diperoleh; belum ada jaminan delivery mutlak. Retry event baru idempotent; ID timestamp pada log offline versi lama bisa berulang antarboot. Arsipkan/import log lama secara terpisah sebelum memakai firmware baru.
- Replay offline belum memulihkan waktu dinding dan identitas sesi asli yang tidak disimpan firmware lama; jangan memakai waktu penerimaan sebagai waktu kejadian. Cache RFID saat offline tetap dapat memuat akses yang sudah dicabut di server sampai sinkronisasi berikutnya; kebijakan operasi offline dan pencabutan akses harus diuji/ditetapkan untuk lokasi kerja.
- Counting belum diuji dengan kamera/model/GPU nyata. Akurasi deteksi, cakupan ROI, reconnect RTSP, dan toleransi latency belum terukur. Dependensi Python masih berupa rentang versi; buat lock lingkungan yang diuji pada host target sebelum deployment.
- Tidak ada uji beban, pemulihan backup, penetration test deployment, atau validasi jaringan/TLS nyata. Indeks retensi event/log belum memiliki pekerjaan pengarsipan terjadwal; rencanakan retensi yang tidak memutus jaminan deduplikasi replay.
- Kredensial yang pernah tersimpan pada versi lama tetap ada dalam riwayat Git dan mungkin deployment lama. Rotasi kredensial nyata di server/perangkat memerlukan konfigurasi operator; audit ini tidak mengklaim sudah melakukan rotasi. Folder API lama tidak boleh ikut dilayani web server.

Petunjuk migrasi dan deployment: [DEPLOYMENT.md](DEPLOYMENT.md).

## Hasil pemeriksaan lokal

- 24 tes Node lulus: routing login, cookie sesi/logout, CSRF, peran, isolasi perangkat, transaksi, deduplikasi replay, ACK perintah, fingerprint, penghapusan pengguna, kontrak laporan, status kamera, serta escaping HTML/CSV. Database memakai doubles.
- 5 tes Python lulus: header identitas, isolasi boks, reset sesi, dan pencegahan publikasi hitungan kamera yang tidak tersedia/kedaluwarsa.
- Lint frontend: 0 warning/error. Build production berhasil; pemuatan halaman dipisah sehingga tidak ada warning chunk lebih dari 500 kB.
- `pnpm audit --prod`: 0 kerentanan pada lockfile setelah pembaruan. Ini hasil database advisory saat audit, bukan jaminan tidak ada kerentanan yang belum dilaporkan.
- Pemeriksaan sintaks JavaScript backend dan Python berhasil. `git diff --check` bersih.
- Dev dijalankan dengan `pnpm --parallel -r run dev`: frontend tersedia di port 3000; backend menunggu database yang belum aktif.
