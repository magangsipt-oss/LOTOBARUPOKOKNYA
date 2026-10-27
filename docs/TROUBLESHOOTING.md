# Troubleshooting

## Backend gagal start dengan ECONNREFUSED

Jika alamatnya `127.0.0.1:3306`, backend belum dapat menghubungi MySQL. Periksa layanan MySQL, `DB_HOST`, `DB_PORT`, dan jaringan dari host backend. Frontend Vite dapat tetap berjalan walaupun backend gagal. Perintah dev pnpm tidak membuat atau menjalankan database.

## Tabel keamanan atau migrasi belum tersedia

Periksa database tujuan pada `backend/.env`, lalu ikuti [prosedur migrasi](DEPLOYMENT.md). Database lama memerlukan pemeriksaan baseline. Jika migrasi berhenti di tengah DDL, periksa schema dan ledger sebelum retry; jangan menghapus database untuk melewati error.

## Login gagal atau sesi selalu hilang

Pastikan akun ada dan memiliki password bcrypt. Akun baru wajib diberi password unik minimal 12 karakter. Password plaintext lama perlu direset melalui skrip. Gunakan host yang konsisten saat membuka frontend. Pada production, cookie Secure membutuhkan HTTPS dan konfigurasi proxy yang benar. Setelah password diubah, login ulang karena sesi dicabut.

## Respons 403 saat menyimpan

Periksa role akun, header `X-CSRF-Token`, dan origin frontend. Login ulang atau muat ulang aplikasi untuk memulihkan CSRF lewat `/users/me`. Untuk perangkat, pastikan `X-Device-Id` sama persis dengan ID boks yang terdaftar dan request hanya dapat dijangkau dari jaringan tepercaya. Izin UI tidak menggantikan pemeriksaan server.

## ESP32 tidak mencapai backend atau mendapat 401

Untuk LAN development, pastikan backend bind ke `0.0.0.0:5002` dan firewall mengizinkan TCP 5002 hanya pada jaringan privat. Untuk VPS BiznetGIO, firmware production sudah memakai `https://103.197.188.61` dan root CA ISRG Root X1 bawaan; `config.txt` dan `/server_ca.pem` bersifat override opsional. Jangan membuka port 5002 ke internet.

Firmware mencoba ulang handshake backend setiap 15 detik selama Wi-Fi tersambung dan memverifikasi TLS. Jika satu profil Wi-Fi belum tersambung selama 15 detik, firmware berpindah ke profil berikutnya. ESP32 ini hanya mendukung hotspot 2,4 GHz; aktifkan mode kompatibilitas/2,4 GHz pada ponsel, gunakan WPA2, tampilkan SSID, lalu cocokkan nama dan password persis di `network_secrets.local.h` atau `/config.txt`. Serial Monitor menampilkan nomor profil, status Wi-Fi, dan SSID tujuan tanpa mencetak password. `HTTP -1` berarti koneksi transport ke backend tidak mendapat respons, bukan kegagalan asosiasi Wi-Fi. Jika handshake menghasilkan 401, pastikan `DEVICE_ID` lokal sama dengan ID boks yang terdaftar. Jangan mengatasi kegagalan dengan `setInsecure()` atau HTTP publik.

Jika log menunjukkan `SSL - Memory allocation failed`, Wi-Fi sudah tersambung tetapi koneksi TLS gagal sebelum API VPS dapat mengirim data. Firmware menggunakan `ESP_SSLClient` dengan buffer kirim 512 byte dan buffer terima 16 KB untuk menekan penggunaan RAM; verifikasi CA, masa berlaku sertifikat, dan IP SAN tetap aktif. Pastikan sketch versi terbaru telah di-upload, lalu periksa log `[TLS]` dan `[RFID]` saat tap.

Untuk penolakan kartu, bedakan log `[RFID] Online card lookup ... HTTP=404` dari `[RFID] Backend confirms UID is unregistered`: firmware hanya menyatakan kartu tidak terdaftar jika endpoint mengembalikan kontrak JSON `success:false` dan `is_valid:false`. HTTP 404 tanpa kontrak tersebut berarti endpoint/backend yang dituju tidak cocok; pastikan `url=` di log mengarah ke backend aktif. Saat Wi-Fi terhubung dan memiliki IP, backend tetap menjadi sumber verifikasi; cache lokal hanya digunakan ketika perangkat benar-benar kehilangan jaringan. Pengawas dan Mekanik hanya dapat tap pada layar sesi LOTO aktif, sedangkan Petugas BBM dapat tap dari tampilan lain selama kartunya terverifikasi. Kartu baru hanya masuk antrean pendaftaran jika di-tap pada layar **Daftar Kartu**; pemindaian baru yang ditolak pada layar lain tidak masuk antrean.

## SIM808 berkedip tetapi GPS belum mendapat posisi

LED **NETLIGHT** pada SIM808 menunjukkan jaringan GSM/GPRS, sehingga kedipnya tidak membuktikan GPS sudah mendapat fix. GNSS perlu dinyalakan dan dibaca melalui UART ESP32 RX **16** / TX **17**, **9600 baud** sebagai baud awal. Bila tidak ada jawaban, firmware mencoba 115200, 57600, 38400, 19200, 4800, 2400, 1200, 230400 dan 460800 baud, lalu memakai baud yang menjawab `OK`. Pengujian ini hanya mengubah baud UART ESP32, tanpa menulis konfigurasi baud SIM808. TX modul menuju RX ESP32, RX modul menuju TX ESP32, dengan ground bersama. Identifikasi LED pada board pembawa karena tidak semua LED memakai fungsi NETLIGHT. Lihat [SIM808 Hardware Design](https://simcom.ee/documents/SIM808/SIM808_Hardware%20Design_V1.03.pdf).

Firmware dengan penanda `[BUILD] ELOTO_FIXED GPS_SIM808_DIAG_V3` memulai GPS sebelum pekerjaan SD, memeriksa `OK`/`ERROR`/timeout setiap perintah AT, dan memastikan jawaban `AT+CGNSPWR?` menunjukkan daya GNSS ON. Perintah AT awal dicoba maksimal lima kali. Program tidak mematikan GNSS, memaksa cold start, atau me-restart ESP32 hanya karena belum ada fix.

Pembacaan `AT+CGNSINF` berlangsung setiap satu detik, termasuk setelah kualitas akurat (minimal empat satelit terpakai, HDOP <= 2.5). Respons yang sudah masuk ke UART dibaca hingga lengkap sebelum memutuskan timeout, termasuk jika layar/jaringan sempat menahan loop. Respons tanpa fix segera membatalkan status fix. Tanpa posisi baru selama 15 detik, status fix kedaluwarsa, termasuk setelah posisi pernah akurat. UTC GNSS yang membeku tidak memperpanjang umur posisi. Koordinat sebelumnya tetap menjadi riwayat dan tidak dikirim sebagai fix terkini.


Versi V3 mencoba komunikasi setelah jeda awal 200 ms, dengan retry untuk receiver yang belum siap. Inisialisasi membaca status `CGNSPWR?` lebih dahulu: jika GNSS sudah ON, pencarian diteruskan tanpa mengirim ulang aktivasi daya; jika OFF, daya dinyalakan dan diperiksa kembali. Program juga meminta interval navigasi 1 Hz melalui `AT+CGNSCMD=0,"$PMTK220,1000*1F"`. Jawaban `OK` pada perintah itu hanya membuktikan perintah diteruskan oleh modem, bukan ACK bahwa mesin GNSS menerapkannya. Jika opsi ditolak, pembacaan posisi tetap berjalan dengan pengaturan receiver yang ada.

Log pencarian V3 menampilkan `cn0_max_dbhz`, validitas field satelit, `search_s`, serta satu baris `[GPS RAW]` setiap sepuluh detik saat belum fix. HDOP/CN0 yang tidak dilaporkan dicetak `NA`; angka HDOP 99.90 pada log V2 dapat merupakan nilai pengganti untuk field kosong. `search_s` adalah lama pemantauan sejak kondisi tanpa fix, bukan pengukuran TTFF sejak daya GNSS pertama dinyalakan. Field `gps_*_valid` pada `/status` membedakan data yang dilaporkan receiver dari nilai pengganti. Kualitas fix tetap memakai ambang yang sama. Perubahan ini mengoptimalkan kesinambungan dan pembacaan data, bukan memperkuat RF antena.

Pemulihan komunikasi dilakukan setelah 20 detik tanpa respons navigasi valid dan minimal dua transaksi baca gagal, atau jika respons menyatakan mesin GNSS mati, dengan jeda minimum 45 detik antarpercobaan. Jawaban valid yang masih mencari satelit **tidak** memicu pemulihan. Ini mengatasi konflik lama antara interval baca lima menit dan pemulihan setelah 60 detik.

Uji dengan Serial Monitor **115200 baud**, antena GPS terpasang di konektor **GPS_ANT**, sisi penerimanya menghadap langit terbuka, dan alat diam. Beri waktu pengamatan 10–15 menit saat cold start; ini waktu uji, bukan jaminan mendapat fix.

| Hasil log | Arti dan tindak lanjut |
|---|---|
| `[GPS AT] AT -> TIMEOUT` | Komunikasi SIM808 belum terbukti. Periksa suplai, status nyala/PWRKEY board, ground, TX/RX dan baud; belum dapat menyimpulkan masalah satelit. |
| `CGNSPWR` error atau `power=0` | GNSS belum menyala. Periksa dukungan perintah pada firmware SIM808 dan kestabilan suplai. |
| `status=NO_FIX`, `sats_view=0`, `sats_used=0` terus di luar ruangan | Modul menjawab, tetapi belum melaporkan satelit GPS terlihat. Periksa antena/konektor/kabel, suplai bias antena aktif pada board pembawa, penghalang logam dan suplai daya. Angka ini belum membuktikan antena rusak. |
| Satelit terlihat, tetapi `sats_used` belum cukup atau HDOP tinggi | Receiver masih mencari solusi posisi/kualitas belum cukup. Pertahankan langit terbuka dan daya stabil; hindari reset berulang. |
| `[GPS] FIX latitude=... longitude=...` | Receiver melaporkan posisi valid; pastikan UTC/posisi terus diperbarui dan uji kembali setelah antena tertutup untuk memastikan fix hilang sebagaimana mestinya. |

Jika AT dan daya GNSS normal tetapi tetap nol satelit dalam uji di langit terbuka, bandingkan dengan antena kompatibel yang diketahui berfungsi. Ukur suplai pada modul saat beban bekerja; cocokkan kebutuhan input dengan board pembawa, karena pin VBAT SIM808 dan input board ber-regulator dapat berbeda. Perangkat lunak tidak dapat memperbaiki antena atau suplai yang gagal. Simpan baris `[GPS AT]`, `[GPS]` serta jenis board untuk menindaklanjuti penyebab perangkat keras. Susunan field navigasi mengikuti [SIMCom GNSS Application Note, tabel 2-3](https://simcom.ee/documents/SIM800x/SIM800%20Series_GNSS_Application%20Note%20V1.00.pdf).


Uji langsung **27 Oktober 2026 (WITA)** pada perangkat USB dengan firmware `GPS_SIM808_DIAG_V2`: unggah berhasil dan hash flash terverifikasi. UART 9600, 115200, 57600, 38400, 19200, 4800, 2400, 1200, 230400, dan 460800 telah dicoba; seluruh percobaan AT menerima **0 byte**, tanpa `OK`. Ini membuktikan komunikasi AT pada jalur yang diuji belum terbentuk; belum membuktikan GNSS/antena rusak atau jumlah satelit nol. Pemeriksaan berikutnya adalah suplai/status nyala modul, UART AT yang dipakai, level sinyal, dan jalur TX/RX/ground. Jika modem pernah dikonfigurasi sleep (`AT+CSCLK=1`), keadaan DTR juga perlu diperiksa sesuai skema board; manual SIM808 menjelaskan UART tidak dapat diakses selama sleep dan DTR rendah membangunkannya. Pin DTR belum terhubung ke GPIO dalam firmware ini, sehingga program tidak dapat mengendalikannya. Konfirmasi skema board sebelum mengubah kabel.


Uji pembeda berikutnya pada tanggal yang sama menggunakan sketch sementara tanpa Wi-Fi/BLE/SD/TFT: loopback internal UART2 ESP32 **PASS**, dengan empat byte `AT\r\n` kembali utuh. Setelah loopback dimatikan, 20 percobaan AT pada sepuluh baud tetap menerima **0 byte**; sampling RX GPIO16 tetap HIGH tanpa transisi teramati selama tiap jendela uji. Ini memverifikasi pengendali UART ESP32 secara internal, bukan kesehatan pad GPIO, kabel, level tegangan, atau SIM808. Pengguna mengonfirmasi daya dari 5V/USB masuk ke input papan berlabel 5V/VIN; tegangan aktual di bawah beban dan kapasitas arus belum diukur. Suplai tetap hipotesis, belum penyebab yang terbukti. Firmware E-LOTO `GPS_SIM808_DIAG_V2` telah dikembalikan setelah tes dan hash penulisan flash terverifikasi.


Laporan serial pengguna berikutnya pada tanggal yang sama menunjukkan `AT -> OK` pada 9600 baud, semua perintah konfigurasi GNSS menjawab `OK`, dan `power=1`, dengan `NO_FIX` serta satelit nol. Pengguna menyatakan alat baru dinyalakan dan belum menjalani uji 10–15 menit. Bukti ini memperbarui diagnosis saat ini: komunikasi AT sudah berfungsi, sedangkan penerimaan satelit belum terverifikasi. Hasil 0 byte pada pengujian terdahulu tetap merupakan catatan kondisi saat tes itu dilakukan. Uji antena di langit terbuka tanpa restart diperlukan sebelum menyimpulkan kerusakan antena/modul atau kecepatan mendapatkan fix.


Uji langsung V3 setelah unggah dan verifikasi flash: SIM808 menjawab AT pada 9600 baud sekitar 1,1 detik sejak pemantauan boot dimulai. Status daya GNSS yang sudah ON dipertahankan, dan perintah permintaan interval 1 Hz mendapat `OK` dari modem. Ini waktu inisialisasi pada modul yang sebelumnya sudah menyala, bukan waktu mendapatkan fix. Data mentah terus berubah, tetapi masih `fix=0`, satelit terlihat/terpakai masing-masing `0`, HDOP/CN0 kosong, dan UTC receiver masih bertanggal 1980. Kondisi ini belum membuktikan lokasi/antena baik atau rusak; pengujian di langit terbuka tetap diperlukan. Waktu GPS yang belum sinkron tidak digunakan untuk mengatur jam HTTPS.


Bukti lanjutan: log pengguna mencapai `search_s=2112` (35 menit 12 detik) dengan satelit nol. Uji NMEA langsung sekitar 57 detik kemudian dilakukan memakai sketch sementara tanpa Wi-Fi/BLE/SD/TFT. Receiver mengirim 57 pesan GSV, seluruhnya melaporkan nol satelit terlihat (`$GPGSV,1,1,00*79`), dan GSA tetap mode 1/tanpa fix. Seluruh 192 frame NMEA yang dicatat lolos checksum. Query receiver menjawab `PMTK514` dengan GSV/RMC aktif dan `PMTK500,1000,...` yang mengonfirmasi interval 1000 ms; versi GNSS `AXN_2.32_3337_15010801`, modem `1418B05SIM808M32`. Jadi nol satelit bukan hasil parser E-LOTO atau keluaran GSV yang dinonaktifkan; gejala tetap ada pada uji tanpa radio Wi-Fi/BLE ESP32. Firmware E-LOTO V3 dikembalikan dan flash terverifikasi setelah tes. Penyebab fisik belum terpisahkan antara penghalang, antena/konektor/kabel/bias, suplai, gangguan RF lain, atau bagian RF receiver; kondisi langit terbuka belum dikonfirmasi pengguna. Uji antena kompatibel yang diketahui berfungsi di lokasi terbuka dan pengukuran suplai adalah pembeda berikutnya.

Pengguna kemudian mengonfirmasi antena berada di luar dengan langit terbuka selama pengujian 35 menit tersebut. Satu cold restart GNSS terkontrol (`PMTK103`, bukan factory reset) diuji memakai sketch minimal: pesan startup receiver teramati, lalu 180 pesan GSV selama 180 detik tetap melaporkan nol satelit dan tidak ada RMC valid. Jadi mengulang restart otomatis belum memiliki dasar sebagai solusi. Firmware E-LOTO V3 dikembalikan dan hash flash terverifikasi sesudah pengujian. Penyebab komponen tertentu masih memerlukan pembandingan antena yang kompatibel serta pemeriksaan suplai/bias sesuai skema board.

Pembanding dari dokumen pengguna **UJI COBA GPS.docx** juga dikompilasi dan diuji langsung pada alat. Logika GPS dokumen dipertahankan; spasi Word dinormalisasi dan output relay/buzzer dibuat LOW selama sketch uji. Sketch memakai UART2 RX16/TX17 pada 9600 baud, `CGNSPWR=1`, `CGNSSEQ="RMC"`, dan pembacaan `CGNSINF` setiap 1000 ms dengan jendela baca 700 ms, tanpa Wi-Fi/BLE/SD/TFT. Selama 180 detik setelah inisialisasi, seluruh 180 pembacaan melaporkan `GNSS Status: 1`, `FIX Status: 0`, tanpa peringatan komunikasi maupun posisi valid. Ini menunjukkan gejala juga terjadi dengan kode acuan yang sebelumnya berfungsi, pada kondisi pengujian sekarang. Perbedaan parser/aplikasi E-LOTO belum menjadi penjelasan yang didukung bukti; pengujian ini sendiri belum menentukan komponen yang gagal.

Sesudah uji kode dokumen, firmware E-LOTO V3 dikembalikan, hash flash terverifikasi, dan penanda build V3 terlihat pada boot. Pemantauan lanjutan 20 detik menunjukkan seluruh perintah inisialisasi menjawab `OK`; respons mentah tetap `fix=0`, satelit nol. Port serial telah dilepas agar Serial Monitor dapat dibuka kembali pada 115200 baud.

## ESP32 tidak membaca konfigurasi SD

Pastikan layar menunjukkan `SD OK` dan Serial Monitor menampilkan `[SD] Mounted and read/write verified`. Jika memakai konfigurasi SD, letakkan file sebagai `/config.txt` di root SD atau `/SD_CARD_CONFIG/config.txt`; nama `.txt.txt` juga dideteksi untuk kasus ekstensi Windows tersembunyi. Tanpa file itu, pesan `[CONFIG] No config.txt; using compiled ... defaults` normal untuk firmware production, asalkan header rahasia lokal sudah diisi saat upload. Baris konfigurasi memakai format `KEY=VALUE`. Placeholder `your-...` dan `replace-with-...` diabaikan. Log tidak mencetak password atau token.

## Video tidak muncul atau counting stale

Pastikan worker Python berjalan dengan environment RTSP. `counting/.env` dimuat otomatis oleh `pnpm dev`/`pnpm dev:counting`; menjalankan Python langsung memerlukan environment yang diexport. Cocokkan ID boks dan `ELOTO_MJPEG_PORT` dengan `MJPEG_PORTS` backend. MJPEG Python bind ke loopback, sehingga backend harus dapat menjangkaunya melalui `127.0.0.1`.

Endpoint stream tanpa pemetaan mengembalikan 404; upstream tidak tersedia dapat menghasilkan 502/503. Data count yang belum ada atau stale tidak berarti area kosong. Periksa kamera, model, frame terbaru, dan koneksi API sebelum menafsirkan hasil deteksi.

## Perintah SYNC_USERS tetap pending

Pastikan perangkat online dan ID boks cocok. ACK dikirim setelah sinkronisasi berhasil. Periksa ID perintah saat ACK; pending command kedaluwarsa setelah sepuluh menit. Perintah lama di penyimpanan legacy tidak dipindahkan otomatis ke antrean baru.

## Checklist saat melaporkan masalah

Sertakan waktu dan zona waktu, komponen, langkah reproduksi, status HTTP, ID boks bila relevan, serta log error yang sudah disunting. Hapus password, cookie, dan kredensial RTSP dari laporan. Catat apakah masalah terjadi pada database development atau perangkat nyata agar hasil tes tidak disalahartikan.
