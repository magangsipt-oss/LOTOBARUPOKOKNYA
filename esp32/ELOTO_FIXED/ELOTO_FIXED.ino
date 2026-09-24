  #include <Arduino.h>
  #include <freertos/FreeRTOS.h>
  #include <freertos/task.h>
  #include <freertos/semphr.h>
  #include <WiFi.h>
  #include <WiFiUdp.h>
  #include <WiFiClientSecure.h>
  #include <WebServer.h>
  #include <HTTPClient.h>
  #include <ArduinoJson.h>
  // TinyGPS++ TIDAK dipakai lagi -- modul GPS di board ini adalah SIM808/SIM868
  // (modul AT-command, bukan modul NMEA polos), jadi dibaca pakai perintah AT+CGNSINF.
  #include <SPI.h>
  #include <FS.h>
  #include <SD.h>

  #include <TFT_eSPI.h>
  #include <TJpg_Decoder.h>

  // ============================================================================
  // FLAG DEBUG (AKTIFKAN SAAT TROUBLESHOOTING, NONAKTIFKAN UNTUK PRODUKSI)
  // ============================================================================
  // Aktifkan RFID_DEBUG untuk melihat setiap byte yang dikirim modul RFID
  // ke Serial Monitor (baud 115200). Sangat berguna untuk cek apakah
  // modul reader sudah mengirim data atau tidak.
  // Nonaktifkan (#undef / hapus baris di bawah) saat deployment produksi
  // untuk menghemat memori RAM dan mempercepat loop.
  #define RFID_DEBUG

  // ============================================================================
  // DEFINISI WARNA TEMA E-LOTO
  // ============================================================================
  #define ELOTO_BG          0xFFFF
  #define ELOTO_HEADER      0xF800
  #define ELOTO_TEXT        0x0000
  #define ELOTO_MUTED       0x7BEF
  #define ELOTO_ACCENT      0xF800
  #define ELOTO_DARK_RED    0x8000

  #undef TFT_BLACK
  #undef TFT_NAVY
  #undef TFT_BLUE
  #undef TFT_CYAN
  #undef TFT_WHITE
  #undef TFT_DARKCYAN
  #undef TFT_DARKGREEN

  #define TFT_BLACK          ELOTO_BG
  #define TFT_NAVY           ELOTO_HEADER
  #define TFT_BLUE           ELOTO_ACCENT
  #define TFT_CYAN           ELOTO_HEADER
  #define TFT_WHITE          ELOTO_TEXT
  #define TFT_DARKCYAN       ELOTO_HEADER
  #define TFT_DARKGREEN      ELOTO_HEADER
  #define TFT_YELLOW         ELOTO_HEADER
  #define TFT_GREEN          ELOTO_HEADER
  #define TFT_LIGHTGREY      ELOTO_TEXT
  #define TFT_DARKGREY       ELOTO_DARK_RED

  // ============================================================================
  // DEFINISI TOMBOL AD KEYBOARD
  // ============================================================================
  #define KEY_NONE        0
  #define KEY_1           1  
  #define KEY_2           2  
  #define KEY_3           3  
  #define KEY_4           4  
  #define KEY_5           5  

  // ============================================================================
  // KONFIGURASI PIN HARDWARE KHURSLABS ESP32 SHIELD V4
  // ============================================================================
  #define PIN_RELAY       25      
  #define PIN_BUZZER      26      
  // Konfigurasi pin modul RFID (RDM6300 / HID Reader)
  #define RD6300_RX_PIN   14      
  #define RD6300_TX_PIN   27      
  #define PIN_GPS_RX      16      
  #define PIN_GPS_TX      17      
  #define PIN_AD_KEY      34      
  #define SPI_SCK_PIN     18
  #define SPI_MISO_PIN    19
  #define SPI_MOSI_PIN    23
  #define SD_CS_PIN       5       
  #define TFT_CS_PIN      15      
  #define TOUCH_CS_PIN    21      // Pin CS XPT2046 Touch Controller (wajib HIGH agar tidak merusak bus SPI)
  // Default ID - bisa diubah dari SD Card config.txt
  String device_id        = "BOX ELOTO 1";

  // ============================================================================
  // KONFIGURASI JARINGAN & SERVER (DIBACA DARI SD CARD)
  // ============================================================================
  String wifi_ssid        = "vivoV29";
  String wifi_password    = "112233445566";
  String server_host      = "";
  String device_token     = "ESP32-ELOTO-BOX1-SECRET-TOKEN-2024";
  const char* SERVER_PROJECT_PATH  = "";

  // Multi-WiFi support: array of known WiFi networks from SD card
  struct WifiNetwork { String ssid; String password; };
  const uint8_t MAX_WIFI_NETWORKS = 10;
  WifiNetwork knownNetworks[MAX_WIFI_NETWORKS];
  uint8_t knownNetworkCount = 0;

  const uint32_t NOTIFICATION_SUCCESS_DURATION = 800;
  const uint32_t NOTIFICATION_ERROR_DURATION   = 1200;
  const uint16_t PHOTO_DISPLAY_SIZE            = 150;

  String getServerBaseUrl() {
      String host = server_host;
      host.trim();
      if (host.length() == 0) host = WiFi.gatewayIP().toString();
      if (host.startsWith("http://") || host.startsWith("https://")) {
          return host + SERVER_PROJECT_PATH + "/";
      }
      return "http://" + host + SERVER_PROJECT_PATH + "/";
  }

  String getApiUrl(const char* endpoint) {
      return getServerBaseUrl() + "api/" + endpoint;
  }

  String getDeviceId() {
      String configuredId = device_id;
      configuredId.trim();
      if (configuredId.length() > 0) return configuredId;

      String mac = WiFi.macAddress();
      mac.replace(":", "");
      mac.toUpperCase();
      return "ESP32-" + mac;
  }

  String getDeviceIdPath() {
      String deviceId = getDeviceId();
      deviceId.replace(" ", "%20");
      return deviceId;
  }

  enum SystemState {
      STATE_BOOT_IP, STATE_IDLE, STATE_START_CONFIRM, STATE_WAIT_SPV_IN, STATE_SET_MEKANIK_COUNT, 
      STATE_MEKANIK_IN, STATE_LOTO_LOCKED_ACTIVE, STATE_CHOOSE_ACTION,       
      STATE_MEKANIK_OUT, STATE_WAIT_SPV_OUT, STATE_SPV_OUT_CONFIRM, STATE_MAINTENANCE_DONE, STATE_REGISTER_RFID,
      STATE_WORKER_LIST, STATE_WORKER_DETAIL,
      STATE_RFID_DETECTED, STATE_RFID_VALID, STATE_MENU, STATE_EVENT_LOG,
      STATE_LOGOUT_DENIED, STATE_STACK_STATUS, STATE_SERVER_OFFLINE, STATE_SYSTEM_ERROR,
      STATE_INITIALIZING, STATE_CONNECTING, STATE_SHOW_IP, STATE_SYSTEM_READY, STATE_COUNTDOWN,
      STATE_SUPERVISOR_VALID, STATE_MECHANIC_VALID, STATE_ALL_WORKERS_REGISTERED,
      STATE_LOGOUT_SUCCESS, STATE_ALL_WORKERS_OUT, STATE_UNLOCKING, STATE_SYSTEM_READY_FINAL,
      STATE_WELCOME
  };

  String stateToString(SystemState s);
  const uint8_t MAX_WORKERS      = 10;
  const uint8_t AUDIT_RING_SIZE  = 20;

  struct WorkerInfo {
      String uid = ""; 
      String sid = ""; 
      String name = ""; 
      String role = "";
      bool isSpv = false; 
      bool isRegistered = false;
      bool isAssigned = true; 
  };

  String formatSid(String sid) {
      sid.trim();
      sid.toUpperCase();
      bool valid = (sid.length() == 5);
      for (uint8_t i = 0; valid && i < sid.length(); i++) {
          valid = isAlphaNumeric(sid.charAt(i));
      }
      return valid ? sid : "-----";
  }

  struct LotoQueue {
      WorkerInfo workers[MAX_WORKERS];
      int8_t topIndex = -1;
  };

  struct AuditEntry {
      String event = ""; String uid = ""; bool ok = false;
      unsigned long ts = 0; double lat = 0; double lon = 0;
  };

  struct NetworkJob {
      char event[48];
      char uid[16];
  };

  const uint8_t MAX_RAM_USERS = 50;
  WorkerInfo ramUserCache[MAX_RAM_USERS];
  int ramUserCount = 0;

  // Variabel Waktu Operasional Sesi (STOPWATCH)
  unsigned long sessionStartTime = 0;
  bool isSessionActive = false;

  String activeFuelmanUID = "";
  String activeFuelmanName = "";
  int8_t lastMekanikDisplayCount = -99;
  int8_t initialMekanikOutCount  = -1;
  bool isAddingFromMenu          = false;
  bool needsRedraw               = true;
  bool forceFullRedraw           = true;
  bool photoAlreadyDrawn         = false;
  double currentLatitude    = 0;
  double currentLongitude   = 0;
  bool gpsHasFix            = false;
  bool firstGpsFixSent      = false;
  bool relayOpen            = false;
  bool sdCardMounted        = false;
  bool exitCountdownActive  = false;
  volatile bool gpsInitStarted = false;
  volatile bool gpsInitDone    = false;
  volatile bool gpsRecoveryRunning = false;

  void initGpsModule();  // forward declaration

  // GPS init task - berjalan di background supaya tidak memblok main loop
  void gpsInitTask(void *pvParameters) {
      initGpsModule();
      gpsInitDone = true;
      Serial.println("[GPS] Init selesai di background task");
      vTaskDelete(NULL);
  }

  bool hasValidGpsFix() {
      return gpsHasFix && currentLatitude >= -90.0 && currentLatitude <= 90.0 &&
             currentLongitude >= -180.0 && currentLongitude <= 180.0 &&
             (currentLatitude != 0.0 || currentLongitude != 0.0);
  }

  QueueHandle_t networkQueue;
  SemaphoreHandle_t sdMutex = NULL;
  SemaphoreHandle_t gpsMutex = NULL;  // Proteksi akses GPS cross-core (lat/lon/fix)

  TFT_eSPI tft = TFT_eSPI();

  HardwareSerial gpsSerial(2);

  // --- State machine polling GPS via AT+CGNSINF (non-blocking, tidak mengganggu loop utama) ---
  enum GpsPollState { GPS_POLL_IDLE, GPS_POLL_WAITING };
  GpsPollState gpsPollState = GPS_POLL_IDLE;
  String gpsResponseBuffer = "";
  unsigned long gpsPollStartMillis = 0;
  unsigned long gpsLastPollMillis = 0;
  const unsigned long GPS_POLL_INTERVAL = 1000;  // 1 Hz cukup stabil untuk telemetry
  const unsigned long GPS_POLL_TIMEOUT  = 900;   // beri UART waktu menerima jawaban lengkap
  const unsigned long GPS_NO_RESPONSE_RECOVERY = 15000;
  const unsigned long GPS_RECOVERY_COOLDOWN     = 30000;
  HardwareSerial rd6300Serial(1);
  WebServer server(80);

  SystemState currentState = STATE_BOOT_IP;
  LotoQueue safetyQueue;
  String supervisorUID = ""; String supervisorName = ""; String supervisorRole = "";
  String lastScannedSID = "-----";
  String lastScannedUID = "---";
  uint8_t targetMekanikCount = 0;
  uint8_t selectedWorkerIndex = 0;
  uint8_t selectedMenuIndex = 0;
  uint8_t selectedFooterAction = 1;
  SystemState stateBeforeNotification = STATE_IDLE;
  SystemState lastRenderedState = STATE_SYSTEM_ERROR;
  int8_t lastRenderedWorkerIndex = -1;
  String notificationTitle = "";
  String notificationMessage = "";
  String cachedQueueList = "";

  AuditEntry auditRing[AUDIT_RING_SIZE];
  uint8_t auditHead = 0; uint16_t auditCount = 0;

  // ============================================================================
  // VARIABEL RFID BYTE BUFFER (alur: kumpulkan byte → timeout 50ms → proses)
  // ============================================================================
  #define RD6300_BUFFER_SIZE 128
  uint8_t  rd6300ByteBuffer[RD6300_BUFFER_SIZE];
  uint16_t rd6300ByteCount  = 0;
  unsigned long rd6300LastByteTime = 0;

  unsigned long lastScanTime = 0;
  unsigned long lastClockUpdateMillis = 0;
  unsigned long gpsLastByteMillis = 0;
  unsigned long gpsLastFixMillis = 0;
  uint32_t gpsByteCount = 0;
  uint32_t gpsSentenceCount = 0;
  unsigned long gpsLastSerialReportMillis = 0;
  unsigned long gpsDebugPrintMillis = 0;
  unsigned long gpsLastValidResponseMillis = 0;
  unsigned long gpsLastRecoveryMillis = 0;
  uint8_t gpsSatellitesInView = 0;
  uint8_t gpsSatellitesUsed = 0;
  float gpsHdop = 99.9f;
  double gpsLastSerialLatitude = 0;
  double gpsLastSerialLongitude = 0;

  // Variabel Global Anti Phantom Double-Tap
  String lastScannedRfidUID = "";
  unsigned long lastScannedRfidTime = 0;

  // Flag: sync database ke SD Card belum dilakukan saat boot
  bool startupSyncPending = true;

  // Status registrasi: info kartu terakhir yang di-tap di mode registrasi
  bool regHasCard = false;         // ada kartu yang baru didaftarkan
  String regLastUID = "";          // UID kartu terakhir
  String regLastSID = "";          // SID (kosong untuk kartu baru)
  String regLastName = "";         // Nama (KARTU BARU untuk kartu baru)
  String regLastRole = "";         // Role
  String regLastStatus = "";       // Status (REGISTRASI OK! / SUDAH TERDAFTAR)
  bool regLastSuccess = true;      // apakah registrasi berhasil

  // ============================================================================
  // PROTOTIPE FUNGSI FULL (AGAR COMPILER TIDAK ERROR)
  // ============================================================================
  void processRfidLogic(String uid);
  bool handleFuelmanTap(const String &uid, WorkerInfo &card);
  String checkRfidSensor();
  void syncDatabaseToSDCard();
  WorkerInfo searchUserFromSDCard(String uid);
  void saveOfflineLogToSDCard(String event, String uid);
  void uploadOfflineLogsSDCard();
  void saveSessionToSD();
  void clearSessionFromSD();
  bool loadSessionFromSD();
  void rebuildCachedQueueString();
  void logAuditAsync(String event, String uid);
  void loadUsersToRAM();
  void drawScreen();
  void drawTftHeader();
  void drawTftFooter(const String &leftText, const String &rightText);
  void drawTftFooterSingle(const String &btnText);
  void drawTftFooterTriple(const String &leftText, const String &midText, const String &rightText);
  void updateHeaderClock();
  void executeSystemAction(uint8_t activeKey, bool isHoldAction);
  void drawSinglePersonIcon(int16_t x, int16_t y, float scale, uint16_t color, bool withOutline = false, uint16_t outlineColor = TFT_BLACK);
  void drawWorkerGroupIcon(int16_t cx, int16_t cy, uint8_t count, uint16_t color);
  void buzzSuccess();
  void buzzFailed();
  void buzzTick();
  void countdownBeep(int detik);
  bool tryConnectBestWifi();
  bool discoverServer();
  void connectWiFiRoutine();
  WorkerInfo fetchCardDataAPI(String uid);
  uint8_t readADKeypadRaw();
  void getLcdText(String &lcd0, String &lcd1);
  void sanitizeQueueDeadlock();
  void displayCardNotification(String uid, String name, String role, String statusMsg, bool isSuccess);
  void displayErrorCardPopup(String uid, String title, String name, String role, String sid, String bottomHint);
  bool drawPhotoFromAPI(String uid, int32_t boxX, int32_t boxY, uint16_t boxW, uint16_t boxH);
  void amanDelay(uint32_t ms);
  void clearMainScreenArea();
  void executeFooterChoice();
  void kirimPerintahAT(const char* perintah, unsigned long tunggu);
  void parseGpsResponse(const String &response);
  void feedGPS();

  // ============================================================================
  // KONVERSI HEX KE DECIMAL 
  // ============================================================================
  String hexToDecStringPadded(String hexStr) {
      if (hexStr.length() > 8) hexStr = hexStr.substring(hexStr.length() - 8);
      char* end;
      unsigned long decVal = strtoul(hexStr.c_str(), &end, 16);
      String decStr = String(decVal);
      while(decStr.length() < 10) decStr = "0" + decStr; 
      return decStr;
  }

  String hexToDecStringUnpadded(String hexStr) {
      if (hexStr.length() > 8) hexStr = hexStr.substring(hexStr.length() - 8);
      char* end;
      unsigned long decVal = strtoul(hexStr.c_str(), &end, 16);
      return String(decVal); 
  }

  // ============================================================================
  // FILTER KEYPAD ANALOG 
  // ============================================================================
  uint8_t readADKeypadRaw() {
      uint32_t sum = 0;
      for (int i = 0; i < 16; i++) {
          sum += analogRead(PIN_AD_KEY);
          delayMicroseconds(50);
      }
      int val = sum / 16;
      if (val < 250)                  return KEY_1;
      else if (val >= 400 && val < 900)   return KEY_2;
      else if (val >= 1100 && val < 1650) return KEY_3;
      else if (val >= 1800 && val < 2350) return KEY_4;
      else if (val >= 2500 && val < 3100) return KEY_5;
      
      return KEY_NONE;
  }

  uint8_t getDebouncedKey() {
      static uint8_t stableKey = KEY_NONE;
      static uint8_t candidateKey = KEY_NONE;
      static unsigned long candidateTime = 0;
      uint8_t currentSample = readADKeypadRaw();
      
      if (currentSample != candidateKey) {
          candidateKey = currentSample;
          candidateTime = millis();
      }
      if ((millis() - candidateTime) >= 45) {
          stableKey = candidateKey;
      }
      return stableKey;
  }

  // ============================================================================
  // LOAD KONFIGURASI DARI SD CARD
  // ============================================================================
  void loadConfigFromSD() {
      if (!sdCardMounted) return;

      if (SD.exists("/config.txt")) {
          File configFile = SD.open("/config.txt", FILE_READ);
          if (configFile) {
              while (configFile.available()) {
                  String line = configFile.readStringUntil('\n');
                  line.trim();
                  if (line.length() == 0 || line.startsWith("#")) continue; // skip empty/comment lines
                  // Multi-WiFi: WIFI_X_SSID / WIFI_X_PASS
                  if (line.startsWith("WIFI_") && knownNetworkCount < MAX_WIFI_NETWORKS) {
                      int underscoreIdx = line.indexOf('_', 5);
                      if (underscoreIdx > 0) {
                          String key = line.substring(underscoreIdx + 1);
                          if (key.startsWith("SSID=")) {
                              knownNetworks[knownNetworkCount].ssid = key.substring(5);
                          } else if (key.startsWith("PASS=")) {
                              knownNetworks[knownNetworkCount].password = key.substring(5);
                              knownNetworkCount++;
                          }
                      }
                  }
                  else if (line.startsWith("SSID=")) wifi_ssid = line.substring(5);
                  else if (line.startsWith("PASS=")) wifi_password = line.substring(5);
                  else if (line.startsWith("SERVER=")) server_host = line.substring(7);
                  else if (line.startsWith("TOKEN=")) device_token = line.substring(6);
                  else if (line.startsWith("DEVICE_ID=")) device_id = line.substring(10);
              }
              configFile.close();
              // If multi-WiFi found, set first as primary
              if (knownNetworkCount > 0) {
                  wifi_ssid = knownNetworks[0].ssid;
                  wifi_password = knownNetworks[0].password;
                  Serial.printf("[CONFIG] %d WiFi networks loaded from SD Card.\n", knownNetworkCount);
                  for (uint8_t i = 0; i < knownNetworkCount; i++) {
                      Serial.printf("[CONFIG]   WiFi %d: %s\n", i + 1, knownNetworks[i].ssid.c_str());
                  }
              }
              Serial.println("[CONFIG] Device ID: " + device_id);
              Serial.println("[CONFIG] Server: " + (server_host.length() > 0 ? server_host : "(auto-discover)"));
          }
      } else {
          File configFile = SD.open("/config.txt", FILE_WRITE);
          if (configFile) {
              configFile.println("# WiFi networks (coba urut dari atas, yang pertama ketemu dipakai)");
              configFile.println("WIFI_1_SSID=KEDAI KOPI DR 5G");
              configFile.println("WIFI_1_PASS=");
              configFile.println("WIFI_2_SSID=vivoV29");
              configFile.println("WIFI_2_PASS=112233445566");
              configFile.println("WIFI_3_SSID=Wi-Fi Hotspot");
              configFile.println("WIFI_3_PASS=");
              configFile.println("");
              configFile.println("# Legacy fallback (kalau WIFI_X tidak ada di config)");
              configFile.println("SSID=" + wifi_ssid);
              configFile.println("PASS=" + wifi_password);
              configFile.println("");
              configFile.println("# Server (pakai IP LAN lokal agar ESP32 tidak salah terhubung ke VPN/public IP)");
              configFile.println("SERVER=192.168.137.1:5002");
              configFile.println("TOKEN=" + device_token);
              configFile.println("DEVICE_ID=ELOTO BOX 1");
              configFile.close();
              Serial.println("[CONFIG] File config.txt default lengkap berhasil dibuat di SD Card!");

              // Langsung muat ulang konfigurasi yang baru saja dibuat
              loadConfigFromSD();
              return;
          } else {
              Serial.println("[CONFIG] Gagal membuat config.txt di SD Card!");
          }
      }
  }

  // ============================================================================
  // INISIALISASI MICROSD AMAN
  // ============================================================================
  bool initializeSDCard() {
      // Semua perangkat lain pada bus SPI dinonaktifkan sebelum SD di-mount.
      digitalWrite(TFT_CS_PIN, HIGH);
      digitalWrite(TOUCH_CS_PIN, HIGH);
      digitalWrite(SD_CS_PIN, HIGH);
      pinMode(SPI_MISO_PIN, INPUT_PULLUP);
      delay(300);

      Serial.printf("[SD] Inisialisasi SD.h: SCK=GPIO%d, MISO=GPIO%d, MOSI=GPIO%d, CS=GPIO%d\n",
                    SPI_SCK_PIN, SPI_MISO_PIN, SPI_MOSI_PIN, SD_CS_PIN);

      SD.end();
      bool terhubung = false;
      // Pada shield ini kartu terbukti stabil pada 1 MHz. Mulai langsung dari
      // kecepatan tersebut agar boot normal tidak perlu gagal sekali dahulu.
      const uint32_t sckSpeeds[] = { 1000000, 400000 };
      const uint8_t MAX_SD_RETRIES = sizeof(sckSpeeds) / sizeof(sckSpeeds[0]);

      for (uint8_t attempt = 0; attempt < MAX_SD_RETRIES; attempt++) {
          Serial.printf("[SD] Percobaan %u/%u (%lu Hz)...\n",
                        attempt + 1, MAX_SD_RETRIES,
                        (unsigned long)sckSpeeds[attempt]);
          digitalWrite(TFT_CS_PIN, HIGH);
          digitalWrite(TOUCH_CS_PIN, HIGH);
          digitalWrite(SD_CS_PIN, HIGH);
          delay(50);

          bool mounted = SD.begin(SD_CS_PIN, SPI, sckSpeeds[attempt], "/sd", 5, false);
          if (mounted) {
              terhubung = true;
              Serial.printf("[SD] Terbaca OK pada %lu Hz.\n",
                            (unsigned long)sckSpeeds[attempt]);
              break;
          }
          Serial.println("[SD] Mount gagal, mencoba ulang...");
          SD.end();
          digitalWrite(SD_CS_PIN, HIGH);
          delay(150);
      }

      if (!terhubung) {
          Serial.println("[SD] GAGAL: kartu tidak terdeteksi atau FAT32 gagal di-mount.");
          digitalWrite(SD_CS_PIN, HIGH);
          return false;
      }

      uint8_t cardType = SD.cardType();
      if (cardType == CARD_NONE) {
          Serial.println("[SD] GAGAL: CARD_NONE.");
          SD.end();
          return false;
      }
      if (cardType == CARD_MMC) Serial.println("[SD] Tipe kartu: MMC");
      else if (cardType == CARD_SD) Serial.println("[SD] Tipe kartu: SDSC");
      else if (cardType == CARD_SDHC) Serial.println("[SD] Tipe kartu: SDHC/SDXC");
      else Serial.println("[SD] Tipe kartu: UNKNOWN");

      uint64_t cardSize = SD.cardSize() / (1024ULL * 1024ULL);
      Serial.printf("[SD] Kapasitas terbaca: %llu MB\n", cardSize);

      // Tes tulis dan baca membedakan kondisi 'berhasil mount' dari kartu yang
      // rusak, read-only, atau koneksinya tidak stabil.
      const char *testPath = "/.sd_health_test";
      if (SD.exists(testPath)) SD.remove(testPath);
      File testFile = SD.open(testPath, FILE_WRITE);
      if (!testFile) {
          Serial.println("[SD] GAGAL: kartu ter-mount tetapi file tes tidak bisa ditulis.");
          SD.end();
          digitalWrite(SD_CS_PIN, HIGH);
          return false;
      }
      testFile.print("ELOTO_SD_OK");
      testFile.close();

      testFile = SD.open(testPath, FILE_READ);
      String testValue = "";
      if (testFile) {
          while (testFile.available()) {
              testValue += (char)testFile.read();
          }
          testFile.close();
      }
      SD.remove(testPath);
      if (testValue != "ELOTO_SD_OK") {
          Serial.println("[SD] GAGAL: hasil baca file tes tidak sesuai; cek koneksi/power kartu.");
          SD.end();
          digitalWrite(SD_CS_PIN, HIGH);
          return false;
      }
      Serial.println("[SD] Tes baca/tulis: OK");

      // Bersihkan file legacy (FIX: gunakan remove() bukan rmdir() untuk file)
      if (SD.exists("/user.csv")) SD.remove("/user.csv");
      if (SD.exists("/users.csv.txt")) SD.remove("/users.csv.txt");
      if (!SD.exists("/foto")) {
          SD.mkdir("/foto");
          Serial.println("[SD] Folder /foto otomatis dibuat.");
      }
      
      if (!SD.exists("/users.csv")) {
          File initFile = SD.open("/users.csv", FILE_WRITE);
          if (initFile) {
              initFile.println("9D88FA1200,Budi Santoso,PENGAWAS,1");
              initFile.println("1A2B3C4D5E,Agus Prayitno,MEKANIK,0");
              initFile.close();
              Serial.println("[SD] File /users.csv default otomatis dibuat.");
          }
      }
      
      digitalWrite(SD_CS_PIN, HIGH);
      return terhubung;
  }

  // ============================================================================
  // PENGATURAN FONT & DISPLAY GRAPHICS
  // ============================================================================
  void setStoryFont(uint8_t pointSize) {
      if (pointSize >= 24) tft.setFreeFont(&FreeMonoBold24pt7b);
      else if (pointSize >= 18) tft.setFreeFont(&FreeMonoBold18pt7b);
      else if (pointSize >= 12) tft.setFreeFont(&FreeMonoBold12pt7b);
      else tft.setFreeFont(&FreeMonoBold9pt7b);
  }

  void drawTextFit(const String &text, int32_t x, int32_t y, uint16_t maxWidth, uint16_t color, uint16_t background, uint8_t preferredSize = 12) {
      if (text.length() == 0) return;
      tft.setTextColor(color, background);
      if (preferredSize >= 12) {
          setStoryFont(12);
          if (tft.textWidth(text) <= maxWidth) { tft.drawString(text, x, y); return; }
      }
      setStoryFont(9);
      if (tft.textWidth(text) <= maxWidth) { tft.drawString(text, x, y); return; }
      
      String truncated = text;
      while (truncated.length() > 3 && tft.textWidth(truncated + "...") > maxWidth) {
          truncated.remove(truncated.length() - 1);
      }
      tft.drawString(truncated + "...", x, y);
  }

  void drawSinglePersonIcon(int16_t x, int16_t y, float scale, uint16_t color, bool withOutline, uint16_t outlineColor) {
      int16_t headR = (int16_t)(10 * scale);
      int16_t headY = y - (int16_t)(12 * scale);
      int16_t bodyW = (int16_t)(32 * scale);
      int16_t bodyH = (int16_t)(24 * scale);
      int16_t bodyY = y + (int16_t)(2 * scale);
      int16_t bodyR = (int16_t)(10 * scale);
      
      if (withOutline) {
          tft.fillCircle(x, headY, headR + 3, outlineColor);
          tft.fillRoundRect(x - (bodyW / 2) - 4, bodyY - 3, bodyW + 8, bodyH + 6, bodyR + 3, outlineColor);
      }
      tft.fillCircle(x, headY, headR, color);
      tft.fillRoundRect(x - (bodyW / 2), bodyY, bodyW, bodyH, bodyR, color);
  }

  void drawWorkerGroupIcon(int16_t cx, int16_t cy, uint8_t count, uint16_t color) {
      if (count == 0) return;
      if (count == 1) {
          drawSinglePersonIcon(cx, cy, 1.35, color, false, TFT_BLACK);
      } else if (count == 2) {
          drawSinglePersonIcon(cx - 28, cy, 1.15, color, false, TFT_BLACK);
          drawSinglePersonIcon(cx + 28, cy, 1.15, color, false, TFT_BLACK);
      } else if (count == 3) {
          drawSinglePersonIcon(cx - 36, cy - 8, 1.05, color, false, TFT_BLACK);
          drawSinglePersonIcon(cx + 36, cy - 8, 1.05, color, false, TFT_BLACK);
          drawSinglePersonIcon(cx, cy + 10, 1.25, color, true, TFT_BLACK);
      } else {
          drawSinglePersonIcon(cx - 40, cy - 8, 0.95, color, false, TFT_BLACK);
          drawSinglePersonIcon(cx + 40, cy - 8, 0.95, color, false, TFT_BLACK);
          drawSinglePersonIcon(cx - 20, cy + 10, 1.10, color, true, TFT_BLACK);
          drawSinglePersonIcon(cx + 20, cy + 10, 1.10, color, true, TFT_BLACK);
      }
  }

  bool hasFooterChoice() {
      return currentState == STATE_WELCOME ||
             currentState == STATE_SHOW_IP ||
             currentState == STATE_START_CONFIRM || currentState == STATE_SYSTEM_READY ||
             currentState == STATE_SUPERVISOR_VALID || currentState == STATE_SET_MEKANIK_COUNT ||
             currentState == STATE_ALL_WORKERS_REGISTERED || currentState == STATE_WORKER_LIST ||
             currentState == STATE_WORKER_DETAIL || currentState == STATE_SPV_OUT_CONFIRM ||
             currentState == STATE_SERVER_OFFLINE;
  }

  void drawWifiIcon(int16_t x, int16_t y, uint16_t color) {
      tft.drawArc(x, y, 22, 18, 220, 320, color, ELOTO_BG);
      tft.drawArc(x, y, 14, 11, 220, 320, color, ELOTO_BG);
      tft.fillCircle(x, y, 2, color);
  }

  void drawArrowIcon(int16_t x, int16_t y, uint16_t color, bool up) {
      if (up) {
          tft.fillTriangle(x, y - 28, x - 25, y, x + 25, y, color);
          tft.fillRect(x - 10, y, 20, 28, color);
      } else {
          tft.fillTriangle(x, y + 28, x - 25, y, x + 25, y, color);
          tft.fillRect(x - 10, y - 28, 20, 28, color);
      }
  }

  void drawRfidIcon(int16_t x, int16_t y, uint16_t color) {
      tft.drawRoundRect(x - 24, y - 17, 42, 34, 5, color);
      tft.drawCircle(x - 12, y - 5, 3, color);
      tft.drawCircle(x - 12, y + 7, 3, color);
      tft.drawArc(x + 27, y, 13, 9, 225, 315, color, TFT_BLACK);
      tft.drawArc(x + 27, y, 20, 15, 225, 315, color, TFT_BLACK);
  }

  void drawGearIcon(int16_t x, int16_t y, uint16_t color) {
      tft.fillCircle(x, y, 30, color);
      tft.fillCircle(x, y, 14, TFT_BLACK);
      for (uint8_t i = 0; i < 8; i++) {
          float angle = i * 0.785398f;
          int16_t toothX = x + (int16_t)(34 * cos(angle));
          int16_t toothY = y + (int16_t)(34 * sin(angle));
          tft.fillRect(toothX - 5, toothY - 5, 10, 10, color);
      }
  }

  bool tft_output(int16_t x, int16_t y, uint16_t w, uint16_t h, uint16_t* bitmap) {
      if (y >= tft.height()) return 0;
      tft.pushImage(x, y, w, h, bitmap);
      return 1;
  }

  // ============================================================================
  // UPDATE JAM HEADER (HANYA BERJALAN SAAT SESI AKTIF)
  // ============================================================================
  String twoDigits(unsigned long value) {
      return value < 10 ? String("0") + String(value) : String(value);
  }

  void updateHeaderClock() {
      if (!isSessionActive) {
          tft.fillRect(175, 4, 130, 34, TFT_NAVY);
          return;
      }

      digitalWrite(SD_CS_PIN, HIGH);

      unsigned long elapsedSeconds = (millis() - sessionStartTime) / 1000;
      String clockText = twoDigits(elapsedSeconds / 3600) + ":" +
                         twoDigits((elapsedSeconds / 60) % 60) + ":" +
                         twoDigits(elapsedSeconds % 60);

      // Hanya redraw jika teks berubah (mencegah kedip-kedip)
      static String lastClockText = "";
      if (clockText == lastClockText) return;
      lastClockText = clockText;

      tft.fillRect(175, 4, 130, 34, TFT_NAVY);
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(ELOTO_BG, ELOTO_HEADER);
      setStoryFont(9);
      tft.drawString(clockText, 240, 21);
  }

  // ============================================================================
  // PERBAIKAN AMAN DELAY: JAM TERUS BERDETAK MESKI SEDANG LOADING
  // ============================================================================
  void amanDelay(uint32_t ms) {
      unsigned long startMillis = millis();
      static unsigned long lastHeartbeatInDelay = 0;
      while (millis() - startMillis < ms) {
          server.handleClient();
          feedGPS();

          if (millis() - lastClockUpdateMillis >= 1000) {
              lastClockUpdateMillis = millis();
              updateHeaderClock();
          }

          // Kirim heartbeat tiap 30 detik supaya box tetap online di dashboard
          if (WiFi.status() == WL_CONNECTED && millis() - lastHeartbeatInDelay >= 30000) {
              lastHeartbeatInDelay = millis();
              logAuditAsync("HEARTBEAT_SYNC", lastScannedUID);
          }

          delay(2);
      }
  }

  // ============================================================================
  // TAMPILAN HEADER DAN FOOTER LAYAR (TFT)
  // ============================================================================
  void drawTftHeader() {
      digitalWrite(SD_CS_PIN, HIGH);
      tft.fillRect(0, 0, 480, 42, TFT_NAVY);
      tft.drawFastHLine(0, 41, 480, ELOTO_BG);
      
      tft.setTextDatum(ML_DATUM);
      tft.setTextColor(ELOTO_BG, ELOTO_HEADER);
      setStoryFont(9);
      tft.drawString("E-LOTO", 8, 21);
      
      updateHeaderClock();
      bool wifiReady = WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0";
      uint16_t networkColor = wifiReady ? TFT_GREEN : TFT_RED;
      
      tft.fillRoundRect(312, 8, 62, 25, 4, hasValidGpsFix() ? TFT_GREEN : TFT_YELLOW);
      tft.fillRoundRect(378, 8, 62, 25, 4, sdCardMounted ? TFT_GREEN : TFT_RED);
      
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(TFT_BLACK, hasValidGpsFix() ? TFT_GREEN : TFT_YELLOW);
      setStoryFont(9);
      tft.drawString(hasValidGpsFix() ? "GPS OK" : "GPS --", 343, 21);
      
      tft.setTextColor(TFT_BLACK, sdCardMounted ? TFT_GREEN : TFT_RED);
      tft.drawString(sdCardMounted ? "SD OK" : "SD --", 409, 21);
      
      tft.fillRoundRect(444, 8, 28, 25, 4, networkColor);
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(TFT_BLACK, networkColor);
      tft.drawString(wifiReady ? "ON" : "--", 458, 21);
  }

  void drawTftFooter(const String &leftText, const String &rightText) {
      digitalWrite(SD_CS_PIN, HIGH);
      tft.fillRect(0, 270, 480, 50, ELOTO_BG);
      tft.drawFastHLine(0, 270, 480, ELOTO_DARK_RED);
      
      if (leftText.length() == 0 && rightText.length() == 0) return;
      
      if (leftText.length() > 0 && rightText.length() > 0) {
          const int16_t buttonY = 278;
          const uint16_t buttonH = 34;
          const uint16_t buttonW = 216;
          const int16_t leftX = 14;
          const int16_t rightX = 250;
          
          uint16_t leftFill = (selectedFooterAction == 0) ? ELOTO_HEADER : ELOTO_BG;
          uint16_t rightFill = (selectedFooterAction == 1) ? ELOTO_HEADER : ELOTO_BG;
          uint16_t leftTextColor = (selectedFooterAction == 0) ? ELOTO_BG : ELOTO_HEADER;
          uint16_t rightTextColor = (selectedFooterAction == 1) ? ELOTO_BG : ELOTO_HEADER;
          
          tft.fillRoundRect(leftX, buttonY, buttonW, buttonH, 4, leftFill);
          tft.drawRoundRect(leftX, buttonY, buttonW, buttonH, 4, ELOTO_HEADER);
          tft.fillRoundRect(rightX, buttonY, buttonW, buttonH, 4, rightFill);
          tft.drawRoundRect(rightX, buttonY, buttonW, buttonH, 4, ELOTO_HEADER);
          
          setStoryFont(9);
          tft.setTextDatum(MC_DATUM);
          drawTextFit(leftText, leftX + buttonW / 2, buttonY + buttonH / 2, buttonW - 12, leftTextColor, leftFill, 9);
          drawTextFit(rightText, rightX + buttonW / 2, buttonY + buttonH / 2, buttonW - 12, rightTextColor, rightFill, 9);
          return;
      }
  }

  void drawTftFooterSingle(const String &btnText) {
      digitalWrite(SD_CS_PIN, HIGH);
      tft.fillRect(0, 270, 480, 50, ELOTO_BG);
      tft.drawFastHLine(0, 270, 480, ELOTO_DARK_RED);
      
      if (btnText.length() == 0) return;
      const int16_t buttonW = 216;
      const int16_t buttonH = 34;
      const int16_t buttonX = (480 - buttonW) / 2;
      const int16_t buttonY = 278;
      
      tft.fillRoundRect(buttonX, buttonY, buttonW, buttonH, 4, ELOTO_HEADER);
      tft.drawRoundRect(buttonX, buttonY, buttonW, buttonH, 4, ELOTO_HEADER);
      
      setStoryFont(9);
      tft.setTextDatum(MC_DATUM);
      drawTextFit(btnText, buttonX + buttonW / 2, buttonY + buttonH / 2, buttonW - 12, ELOTO_BG, ELOTO_HEADER, 9);
  }

  void drawTftFooterTriple(const String &leftText, const String &midText, const String &rightText) {
      digitalWrite(SD_CS_PIN, HIGH);
      tft.fillRect(0, 270, 480, 50, ELOTO_BG);
      tft.drawFastHLine(0, 270, 480, ELOTO_DARK_RED);
      
      const int16_t buttonY = 278;
      const uint16_t buttonH = 34;
      const uint16_t buttonW = 144;
      const int16_t xs[3] = { 14, 168, 322 };
      const String texts[3] = { leftText, midText, rightText };
      
      setStoryFont(9);
      tft.setTextDatum(MC_DATUM);
      for (uint8_t i = 0; i < 3; i++) {
          uint16_t fill = (selectedFooterAction == i) ? ELOTO_HEADER : ELOTO_BG;
          uint16_t textColor = (selectedFooterAction == i) ? ELOTO_BG : ELOTO_HEADER;
          
          tft.fillRoundRect(xs[i], buttonY, buttonW, buttonH, 4, fill);
          tft.drawRoundRect(xs[i], buttonY, buttonW, buttonH, 4, ELOTO_HEADER);
          drawTextFit(texts[i], xs[i] + buttonW / 2, buttonY + buttonH / 2, buttonW - 8, textColor, fill, 9);
      }
  }

  // ============================================================================
  // DOWNLOAD & RENDER FOTO (TANGGUH & STABIL TANPA MALLOC SPRITE)
  // ============================================================================
  bool drawPhotoFromAPI(String uid, int32_t boxX, int32_t boxY, uint16_t boxW, uint16_t boxH) {
      uid.trim(); uid.toUpperCase();
      if (uid == "" || ESP.getFreeHeap() < 40000) return false;

      String photoPath = "/foto/" + uid + ".jpg";
      bool photoExists = false;
      
      if (sdCardMounted) {
          if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
              digitalWrite(TFT_CS_PIN, HIGH);
              photoExists = SD.exists(photoPath);
              digitalWrite(SD_CS_PIN, HIGH);
              xSemaphoreGive(sdMutex);
          }
      }

      uint8_t *jpegData = NULL;
      size_t jpegSize = 0;

      // 1. Jika belum ada di SD, download via HTTP
      if (!photoExists && WiFi.status() == WL_CONNECTED) {
          unsigned long t0 = millis();
          Serial.printf("[PHOTO] Download UID=%s, heap=%lu\n", uid.c_str(), (unsigned long)ESP.getFreeHeap());
          WiFiClient client; client.setTimeout(3000);
          HTTPClient http;
          String url = getApiUrl("users/photo/") + uid + "?size=" + String(PHOTO_DISPLAY_SIZE) + "&quality=82";
          Serial.printf("[PHOTO] URL: %s\n", url.c_str());
          http.begin(client, url);
          http.addHeader("Accept", "image/jpeg");
          http.addHeader("X-Device-Token", device_token);
          http.setTimeout(5000);

          int httpCode = http.GET();
          int contentLen = http.getSize();
          Serial.printf("[PHOTO] HTTP %d, size=%d, time=%lums\n", httpCode, contentLen, millis() - t0);
          if (httpCode == HTTP_CODE_OK && contentLen > 100 && contentLen < 50000) {
              // FIX: Stream langsung ke buffer (bukan getString+malloc = double allocation)
              jpegSize = contentLen;
              jpegData = static_cast<uint8_t *>(malloc(jpegSize));
              if (jpegData != NULL) {
                  WiFiClient *stream = http.getStreamPtr();
                  size_t bytesRead = 0;
                  unsigned long streamStart = millis();
                  while (bytesRead < jpegSize && (millis() - streamStart) < 5000) {
                      if (stream->available()) {
                          int toRead = stream->available();
                          if (toRead > (int)(jpegSize - bytesRead)) toRead = jpegSize - bytesRead;
                          int rd = stream->readBytes(jpegData + bytesRead, toRead);
                          if (rd > 0) bytesRead += rd;
                      } else {
                          delay(1);
                      }
                  }
                  
                  if (bytesRead >= 100 && jpegData[0] == 0xFF && jpegData[1] == 0xD8) {
                      jpegSize = bytesRead;
                      Serial.printf("[PHOTO] JPEG OK: %d bytes, total=%lums\n", jpegSize, millis() - t0);

                      // Simpan ke SD card sebagai cache
                      if (sdCardMounted && xSemaphoreTake(sdMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
                          digitalWrite(TFT_CS_PIN, HIGH);
                          File f = SD.open(photoPath, FILE_WRITE);
                          if (f) {
                              f.write(jpegData, jpegSize);
                              f.close();
                          }
                          digitalWrite(SD_CS_PIN, HIGH);
                          xSemaphoreGive(sdMutex);
                      }
                  } else {
                      Serial.printf("[PHOTO] Bukan JPEG valid! len=%d first=0x%02X\n", bytesRead, bytesRead > 0 ? jpegData[0] : 0);
                      free(jpegData);
                      jpegData = NULL;
                      jpegSize = 0;
                  }
              } else {
                  Serial.println("[PHOTO] malloc GAGAL!");
              }
          } else if (httpCode == HTTP_CODE_OK && contentLen >= 50000) {
              Serial.printf("[PHOTO] Foto terlalu besar (%d bytes), skip untuk hemat heap\n", contentLen);
          } else {
              Serial.printf("[PHOTO] HTTP GAGAL: %d (%lums)\n", httpCode, millis() - t0);
              if (httpCode > 0) {
                  String errBody = http.getString();
                  Serial.printf("[PHOTO] Error body: %s\n", errBody.substring(0, 200).c_str());
              }
          }
          http.end();
      } 
      // 2. Jika sudah ada di SD, baca dari SD
      else if (photoExists && sdCardMounted) {
          if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
              digitalWrite(TFT_CS_PIN, HIGH);
              File f = SD.open(photoPath, FILE_READ);
              if (f) {
                  jpegSize = f.size();
                  // Batasi ukuran foto dari SD: maks 50KB (foto dari server harusnya sudah kecil)
                  if (jpegSize > 100 && jpegSize < 50000) {
                      jpegData = static_cast<uint8_t *>(malloc(jpegSize));
                      if (jpegData != NULL) {
                          f.read(jpegData, jpegSize);
                      }
                  } else if (jpegSize >= 50000) {
                      Serial.printf("[PHOTO] SD: file %s terlalu besar (%d bytes), skip\n", uid.c_str(), jpegSize);
                  }
                  f.close();
              }
              digitalWrite(SD_CS_PIN, HIGH);
              xSemaphoreGive(sdMutex);
          }
      }
      
      // 3. Render gambar langsung (Direct Render)
      bool drawn = false;
      if (jpegData != NULL && jpegSize > 100 && jpegData[0] == 0xFF && jpegData[1] == 0xD8) {
          uint16_t sourceW = 0, sourceH = 0;
          
          // Pastikan SD Pin Nonaktif sebelum render TFT agar jalur SPI tidak tabrakan
          digitalWrite(SD_CS_PIN, HIGH); 
          
          if (TJpgDec.getJpgSize(&sourceW, &sourceH, jpegData, jpegSize) == JDR_OK && sourceW > 0 && sourceH > 0) {
              uint8_t scale = 1;
              while (scale < 8 && (sourceW / scale > boxW || sourceH / scale > boxH)) scale *= 2;
              uint16_t renderW = sourceW / scale;
              uint16_t renderH = sourceH / scale;
              int32_t renderX = boxX + (boxW - renderW) / 2;
              int32_t renderY = boxY + (boxH - renderH) / 2;
              
              if (renderX >= boxX && renderY >= boxY && renderX + renderW <= boxX + boxW && renderY + renderH <= boxY + boxH) {
                  tft.fillRect(boxX, boxY, boxW, boxH, TFT_BLACK); 
                  TJpgDec.setJpgScale(scale);
                  TJpgDec.setCallback(tft_output); 
                  drawn = (TJpgDec.drawJpg(renderX, renderY, jpegData, jpegSize) == JDR_OK);
              }
          }
      }
      
      if (jpegData != NULL) free(jpegData);
      
      return drawn;
  }

  bool isTapEventName(String event) {
      event.toUpperCase();
      return event.indexOf("SUPERVISOR_LOCK_IN") != -1 ||
             event.indexOf("SUPERVISOR_LOG_OUT") != -1 ||
             event.indexOf("MECHANIC_LOG_IN") != -1 ||
             event.indexOf("MECHANIC_LOG_OUT") != -1 ||
             event.indexOf("REFUEL_START") != -1 ||
             event.indexOf("REFUEL_END") != -1;
  }

  bool checkIsSupervisorRole(String role) {
      String r = role; r.toUpperCase(); r.trim();
      return (r.indexOf("PENGAWAS") != -1 || 
              r.indexOf("SUPERVISOR") != -1 || 
              r.indexOf("SPV") != -1 || 
              r.indexOf("K3") != -1 || 
              r.indexOf("ADMIN") != -1);
  }

  String normalizeRfidUid(String uid) {
      uid.trim(); uid.replace(" ", ""); uid.replace(":", ""); uid.replace("-", ""); uid.toUpperCase();
      return uid;
  }

  String normalizeUserRole(String role) {
      role.trim(); role.replace("\r", ""); role.replace("\n", ""); role.toUpperCase();
      if (checkIsSupervisorRole(role)) return "PENGAWAS";
      if (role.indexOf("FUEL") != -1 || role.indexOf("BBM") != -1) return "FUELMAN";
      return "MEKANIK";
  }

  bool isFuelmanRole(const String &role) {
      String r = role; r.trim(); r.toUpperCase();
      return (r.indexOf("FUEL") != -1 || r.indexOf("BBM") != -1);
  }

  // ============================================================================
  // INISIALISASI MODUL SIM808/SIM868 -- dipanggil sekali di setup()
  // Modul ini beda dengan GPS "polos" (NEO-6M dkk): dia butuh perintah AT dulu
  // buat menyalakan GNSS-nya sebelum bisa dibaca. Kalau ini dilewat, GPS-nya
  // diam saja walau kabel & baudrate sudah benar -- itu sebabnya "gak kebaca".
  // ============================================================================
  void kirimPerintahAT(const char* perintah, unsigned long tunggu) {
      while (gpsSerial.available()) gpsSerial.read();
      Serial.print(">> "); Serial.println(perintah);
      gpsSerial.println(perintah);
      unsigned long mulai = millis();
      while (millis() - mulai < tunggu) {
          while (gpsSerial.available()) {
              Serial.write(gpsSerial.read());
          }
          // Beri kesempatan task lain berjalan selama menunggu respons modem.
          vTaskDelay(pdMS_TO_TICKS(1));
      }
      Serial.println();
  }

  void initGpsModule() {
      delay(1000);   // SIM808 boot internal (dikurangi dari 2000ms)
      Serial.println("[GPS] Inisialisasi modul SIM808...");
      kirimPerintahAT("AT", 500);
      kirimPerintahAT("AT+CGNSPWR=1", 800);       // nyalakan GNSS
      kirimPerintahAT("AT+CGNSPWR?", 500);        // pastikan GNSS benar-benar ON
      kirimPerintahAT("AT+CGNSSEQ=\"RMC\"", 500); // urutan output RMC
      
      // FIX: Hot restart (BUKAN cold reset!) — gunakan data NVRAM untuk fix cepat < 30 detik
      // $PMTK101 = Hot restart (pakai ephemeris + posisi terakhir dari NVRAM)
      // $PMTK104 = FACTORY RESET (menghapus SEMUA data satelit! fix butuh 10-15 menit!)
      kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK101*32\"", 500);
      
      // Aktifkan SBAS (Satellite-Based Augmentation System) untuk akurasi lebih tinggi
      kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK313,1*2E\"", 500);
      
      // Set DGPS mode ke WAAS (Wide Area Augmentation System)
      kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK301,2*2E\"", 500);
      
      // Set update rate 2Hz (500ms) untuk tracking posisi lebih responsif
      kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK220,500*2B\"", 500);
      
      gpsLastPollMillis = millis();
      gpsLastValidResponseMillis = millis();
      Serial.println("[GPS] Modul siap (Hot Restart + SBAS + 2Hz), polling stabil tiap 1 detik.");
  }

  // Pemulihan hanya dilakukan jika modem sama sekali tidak memberi jawaban
  // CGNSINF. Jangan restart GNSS hanya karena belum fix: receiver perlu tetap
  // hidup agar dapat mengumpulkan almanac/ephemeris dari satelit.
  void gpsRecoveryTask(void *pvParameters) {
      Serial.println("[GPS] Tidak ada respons CGNSINF, mencoba pulihkan GNSS...");
      kirimPerintahAT("AT", 700);
      kirimPerintahAT("AT+CGNSPWR=1", 1000);
      kirimPerintahAT("AT+CGNSPWR?", 700);
      gpsPollState = GPS_POLL_IDLE;
      gpsResponseBuffer = "";
      gpsLastPollMillis = millis();
      gpsLastValidResponseMillis = millis();
      gpsRecoveryRunning = false;
      Serial.println("[GPS] Pemulihan selesai, akuisisi satelit dilanjutkan.");
      vTaskDelete(NULL);
  }

  // ============================================================================
  // PARSING JAWABAN "AT+CGNSINF" -> currentLatitude / currentLongitude / dst
  // Format: +CGNSINF: <run>,<fix>,<utc>,<lat>,<lon>,<alt>,<speed>,<course>,...
  // ============================================================================
  void parseGpsResponse(const String &response) {
      int pos = response.indexOf("+CGNSINF:");
      if (pos < 0) return;

      String data = response.substring(pos + 9);
      int nl = data.indexOf('\n');
      if (nl > 0) data = data.substring(0, nl);
      data.trim();

      String field[20];
      int idx = 0, mulai = 0;
      for (int i = 0; i <= (int)data.length(); i++) {
          if (i == (int)data.length() || data.charAt(i) == ',') {
              if (idx < 20) field[idx] = data.substring(mulai, i);
              idx++;
              mulai = i + 1;
          }
      }
      if (idx < 6) return;   // jawaban belum lengkap, abaikan

      gpsSentenceCount++;
      gpsLastValidResponseMillis = millis();

      String fixStatus = field[1];
      String latStr     = field[3];
      String lonStr     = field[4];
      fixStatus.trim();
      latStr.trim();
      lonStr.trim();

      // Format CGNSINF SIM808/SIM868: field 10=HDOP, 14=satelit terlihat,
      // 15=satelit yang dipakai untuk solusi posisi.
      if (idx > 10 && field[10].length() > 0) gpsHdop = field[10].toFloat();
      if (idx > 14 && field[14].length() > 0) gpsSatellitesInView = (uint8_t)field[14].toInt();
      if (idx > 15 && field[15].length() > 0) gpsSatellitesUsed = (uint8_t)field[15].toInt();

      if (fixStatus == "1" && latStr.length() > 0 && lonStr.length() > 0) {
          // FIX: Gunakan strtod() (64-bit double) bukan toFloat() (32-bit float)
          // toFloat() hanya presisi 6-7 digit → kehilangan akurasi GPS
          double newLat = strtod(latStr.c_str(), NULL);
          double newLon = strtod(lonStr.c_str(), NULL);
          
          // Proteksi mutex: Core 0 (networkTask) bisa membaca data ini kapan saja
          if (xSemaphoreTake(gpsMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
              currentLatitude  = newLat;
              currentLongitude = newLon;
              gpsHasFix        = true;
              gpsLastFixMillis = millis();
              xSemaphoreGive(gpsMutex);
          } else {
              // Fallback tanpa mutex (lebih baik update daripada skip)
              currentLatitude  = newLat;
              currentLongitude = newLon;
              gpsHasFix        = true;
              gpsLastFixMillis = millis();
          }

          bool positionChanged = fabs(currentLatitude - gpsLastSerialLatitude) > 0.00001 ||
                                 fabs(currentLongitude - gpsLastSerialLongitude) > 0.00001;
          if (positionChanged || millis() - gpsLastSerialReportMillis >= 5000) {
              Serial.printf("[GPS] FIX latitude=%.6f  longitude=%.6f\n", currentLatitude, currentLongitude);
              gpsLastSerialLatitude  = currentLatitude;
              gpsLastSerialLongitude = currentLongitude;
              gpsLastSerialReportMillis = millis();
          }
          if (!firstGpsFixSent) {
              firstGpsFixSent = true;
              logAuditAsync("GPS_FIX_LOCKED", "SYSTEM");
              needsRedraw = true;
          }
      }
  }

  // ============================================================================
  // DIPANGGIL TERUS DI loop() -- NON-BLOCKING, gak bikin macet tampilan/RFID.
  // Tiap 1 detik kirim "AT+CGNSINF", lalu kumpulkan jawabannya sedikit-sedikit
  // setiap kali fungsi ini dipanggil lagi (bukan nunggu diam di satu tempat).
  // ============================================================================
  void feedGPS() {
      // Jangan kirim AT+CGNSINF selama gpsInitTask masih mengirim rangkaian
      // perintah inisialisasi. Dua penulis pada UART yang sama akan membuat
      // jawaban AT tercampur dan GPS terlihat seperti tidak merespons.
      if (!gpsInitDone || gpsRecoveryRunning) return;

      unsigned long now = millis();

      if (gpsPollState == GPS_POLL_IDLE) {
          if (now - gpsLastPollMillis >= GPS_POLL_INTERVAL) {
              gpsLastPollMillis = now;
              while (gpsSerial.available()) gpsSerial.read();
              gpsSerial.println("AT+CGNSINF");
              gpsResponseBuffer = "";
              gpsPollStartMillis = now;
              gpsPollState = GPS_POLL_WAITING;
          }
      } else { // GPS_POLL_WAITING
          while (gpsSerial.available()) {
              char c = gpsSerial.read();
              if (gpsResponseBuffer.length() < 512) gpsResponseBuffer += c;
              gpsByteCount++;
              gpsLastByteMillis = now;
          }

          bool sudahDapat = gpsResponseBuffer.indexOf("+CGNSINF:") != -1 && gpsResponseBuffer.indexOf("OK") != -1;
          bool timeout     = (now - gpsPollStartMillis) >= GPS_POLL_TIMEOUT;

          if (sudahDapat || timeout) {
              if (sudahDapat) parseGpsResponse(gpsResponseBuffer);
              gpsPollState = GPS_POLL_IDLE;
          }
      }

      // Jika +CGNSINF berhenti total, hidupkan ulang mesin GNSS tanpa cold
      // reset. Cooldown mencegah task pemulihan dibuat berulang-ulang.
      if (!gpsRecoveryRunning &&
          now - gpsLastValidResponseMillis >= GPS_NO_RESPONSE_RECOVERY &&
          now - gpsLastRecoveryMillis >= GPS_RECOVERY_COOLDOWN) {
          gpsRecoveryRunning = true;
          gpsLastRecoveryMillis = now;
          gpsPollState = GPS_POLL_IDLE;
          BaseType_t created = xTaskCreatePinnedToCore(
              gpsRecoveryTask, "GPSRecover", 4096, NULL, 1, NULL, 0);
          if (created != pdPASS) {
              gpsRecoveryRunning = false;
              Serial.println("[GPS] Gagal membuat task pemulihan.");
          }
          return;
      }

      // GPS dianggap kehilangan fix kalau sudah 30 detik gak ada update baru
      if (gpsHasFix && (now - gpsLastFixMillis > 30000)) {
          gpsHasFix = false;
          needsRedraw = true;
          if (now - gpsLastFixMillis > 60000) {
              firstGpsFixSent = false;
          }
      }

      // ------------------------------------------------------------------
      // CETAK LATITUDE & LONGITUDE KE SERIAL MONITOR SETIAP 2 DETIK
      // Dicetak TERUS meskipun GPS belum dapat fix, supaya kelihatan di
      // Serial Monitor apakah modul GPS memang mengirim data atau tidak
      // (berguna untuk debug wiring / baudrate / posisi antena).
      // ------------------------------------------------------------------
      if (now - gpsDebugPrintMillis >= 2000) {
          gpsDebugPrintMillis = now;
          if (gpsHasFix) {
              Serial.printf("[GPS] latitude=%.6f  longitude=%.6f  status=FIX  sat=%u/%u  HDOP=%.1f  umur=%lums\n",
                            currentLatitude, currentLongitude,
                            gpsSatellitesUsed, gpsSatellitesInView, gpsHdop,
                            now - gpsLastFixMillis);
          } else {
              Serial.printf("[GPS] BELUM FIX  sat=%u/%u  HDOP=%.1f  byte=%lu  jawaban=%lu\n",
                            gpsSatellitesUsed, gpsSatellitesInView, gpsHdop,
                            (unsigned long)gpsByteCount, (unsigned long)gpsSentenceCount);
          }
      }
  }

  // ============================================================================
  // CLEAR RFID BYTE BUFFER
  // ============================================================================
  void clearRfidBuffer() {
      // Drain UART hardware buffer
      unsigned long t = millis();
      while (rd6300Serial.available() > 0 && millis() - t < 60) {
          rd6300Serial.read();
      }
      // Reset byte buffer
      rd6300ByteCount   = 0;
      rd6300LastByteTime = 0;
      memset(rd6300ByteBuffer, 0, RD6300_BUFFER_SIZE);
  }

  // ============================================================================
  // VALIDASI UID HEX
  // ============================================================================
  bool isValidRfidUID(const String &uid) {
      if (uid.length() < 8 || uid.length() > 14) return false;
      for (size_t i = 0; i < uid.length(); i++) {
          char c = uid.charAt(i);
          if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f')))
              return false;
      }
      if (uid == "00000000" || uid == "0000000000" ||
          uid == "FFFFFFFF" || uid == "FFFFFFFFFF") return false;
      return true;
  }

  // ============================================================================
  // EKSTRAK CARD ID DARI BYTE BUFFER
  // Mengikuti alur program test: tampilkan RAW HEX → ekstrak UID
  // Mendukung format STX-ETX (RDM6300) maupun raw byte (HID reader)
  // ============================================================================
  String extractRfidCardID() {
      if (rd6300ByteCount == 0) return "";

  #ifdef RFID_DEBUG
      // --- Tampilkan RAW HEX (seperti program test) ---
      Serial.println();
      Serial.println("================================================");
      Serial.println("RFID TERDETEKSI");
      Serial.println("================================================");
      Serial.print("RAW HEX : ");
      for (uint16_t i = 0; i < rd6300ByteCount; i++) {
          if (rd6300ByteBuffer[i] < 0x10) Serial.print("0");
          Serial.print(rd6300ByteBuffer[i], HEX);
          Serial.print(" ");
      }
      Serial.println();
      Serial.print("DECIMAL : ");
      for (uint16_t i = 0; i < rd6300ByteCount; i++) {
          Serial.print(rd6300ByteBuffer[i]);
          if (i < rd6300ByteCount - 1) Serial.print(",");
      }
      Serial.println();
      Serial.print("ASCII   : ");
      for (uint16_t i = 0; i < rd6300ByteCount; i++) {
          if (rd6300ByteBuffer[i] >= 32 && rd6300ByteBuffer[i] <= 126)
              Serial.print((char)rd6300ByteBuffer[i]);
          else
              Serial.print(".");
      }
      Serial.println();
      Serial.print("LENGTH  : ");
      Serial.print(rd6300ByteCount);
      Serial.println(" byte");
  #endif

      // --- METODE 1: FORMAT STX (0x02) ... ETX (0x03) ---
      // Dipakai oleh RDM6300 standar
      int stxPos = -1, etxPos = -1;
      for (int i = 0; i < (int)rd6300ByteCount; i++) {
          if (rd6300ByteBuffer[i] == 0x02) { stxPos = i; break; }
      }
      if (stxPos >= 0) {
          for (int i = stxPos + 1; i < (int)rd6300ByteCount; i++) {
              if (rd6300ByteBuffer[i] == 0x03) { etxPos = i; break; }
          }
      }
      if (stxPos >= 0 && etxPos > stxPos) {
          // Isi frame antara STX dan ETX
          String frame = "";
          for (int i = stxPos + 1; i < etxPos; i++) {
              char c = (char)rd6300ByteBuffer[i];
              if (c != '\r' && c != '\n') frame += c;
          }
          frame.trim();
          frame.toUpperCase();
  #ifdef RFID_DEBUG
          Serial.print("FRAME   : ");
          Serial.print(frame);
          Serial.print(" (len=");
          Serial.print(frame.length());
          Serial.println(")");
  #endif
          // Standar RDM6300: 10 char UID + 2 char checksum = 12
          if (frame.length() == 12) {
              String uid = frame.substring(0, 10);
              if (isValidRfidUID(uid)) return uid;
          }
          // Frame langsung = UID (8-14 char)
          if (frame.length() >= 8 && frame.length() <= 14 && isValidRfidUID(frame)) {
              return frame;
          }
      }

      // --- METODE 2: BYTE MENTAH SEBAGAI UID HEX (HID reader tanpa STX/ETX) ---
      // Bangun hex string dari raw bytes (abaikan control char 0x00-0x1F & 0x7F-0xFF
      // yang bukan bagian dari UID ASCII)
      String rawHex = "";
      for (uint16_t i = 0; i < rd6300ByteCount; i++) {
          uint8_t b = rd6300ByteBuffer[i];
          // Kalau semua byte adalah ASCII printable hex char → format ASCII hex
          if (b >= '0' && b <= '9') rawHex += (char)b;
          else if (b >= 'A' && b <= 'F') rawHex += (char)b;
          else if (b >= 'a' && b <= 'f') rawHex += (char)(b - 32); // uppercase
          // Jika ada byte di luar range hex ASCII, bangun sebagai hex byte
      }
      rawHex.trim();
      if (rawHex.length() >= 8 && rawHex.length() <= 14 && isValidRfidUID(rawHex)) {
  #ifdef RFID_DEBUG
          Serial.print("CARD ID (ASCII HEX): ");
          Serial.println(rawHex);
  #endif
          return rawHex;
      }

      // --- METODE 3: BANGUN HEX DARI BYTE VALUE ---
      // Setiap byte dijadikan 2 digit hex, cocok untuk reader yang kirim binary UID
      // Skip byte control (STX/ETX/CR/LF)
      String byteHex = "";
      for (uint16_t i = 0; i < rd6300ByteCount; i++) {
          uint8_t b = rd6300ByteBuffer[i];
          if (b == 0x02 || b == 0x03 || b == 0x0D || b == 0x0A) continue;
          if (byteHex.length() < 14) {
              if (b < 0x10) byteHex += "0";
              byteHex += String(b, HEX);
          }
      }
      byteHex.toUpperCase();
      if (byteHex.length() >= 8 && byteHex.length() <= 14 && isValidRfidUID(byteHex)) {
  #ifdef RFID_DEBUG
          Serial.print("CARD ID (BYTE HEX): ");
          Serial.println(byteHex);
  #endif
          return byteHex;
      }

  #ifdef RFID_DEBUG
      Serial.println("CARD ID : TIDAK TERDETEKSI");
      Serial.println("STATUS  : DATA PERLU DICEK");
      Serial.println("================================================");
  #endif
      return "";
  }

  // ============================================================================
  // CHECK RFID SENSOR
  // Alur: Kumpulkan byte → tunggu 50ms tidak ada byte baru → proses buffer
  // ============================================================================
  String checkRfidSensor() {
      // Kumpulkan byte yang masuk ke buffer
      while (rd6300Serial.available() > 0) {
          uint8_t data = rd6300Serial.read();
          rd6300LastByteTime = millis();
          if (rd6300ByteCount < RD6300_BUFFER_SIZE) {
              rd6300ByteBuffer[rd6300ByteCount] = data;
              rd6300ByteCount++;
          } else {
              // Buffer penuh — reset
  #ifdef RFID_DEBUG
              Serial.println("[RFID WARNING] Buffer penuh! Reset buffer.");
  #endif
              rd6300ByteCount = 0;
              memset(rd6300ByteBuffer, 0, RD6300_BUFFER_SIZE);
          }
      }

      // Proses buffer hanya setelah timeout 50ms (memastikan semua byte sudah masuk)
      if (rd6300ByteCount > 0 && (millis() - rd6300LastByteTime) > 50) {
          String uid = extractRfidCardID();
          // Reset buffer setelah diproses
          rd6300ByteCount = 0;
          memset(rd6300ByteBuffer, 0, RD6300_BUFFER_SIZE);
          return uid;
      }

      return "";
  }

  String stateToString(SystemState s) {
      switch (s) {
          case STATE_BOOT_IP: return "BOOT_IP";
          case STATE_IDLE: return "IDLE_READY";
          case STATE_START_CONFIRM: return "START_CONFIRM";
          case STATE_WAIT_SPV_IN: return "WAIT_SPV";
          case STATE_SET_MEKANIK_COUNT: return "SET_QUOTA";
          case STATE_MEKANIK_IN: return "MEK_IN";
          case STATE_LOTO_LOCKED_ACTIVE: return "LOCKED_ACTIVE";
          case STATE_CHOOSE_ACTION: return "CHOOSE_ACT";
          case STATE_MEKANIK_OUT: return "MEK_OUT";
          case STATE_WAIT_SPV_OUT: return "SPV_OUT";
          case STATE_SPV_OUT_CONFIRM: return "SPV_OUT_CONFIRM";
          case STATE_MAINTENANCE_DONE: return "MAINT_DONE";
          case STATE_REGISTER_RFID: return "REGISTER";
          case STATE_WORKER_LIST: return "WORKER_LIST";
          case STATE_WORKER_DETAIL: return "WORKER_DETAIL";
          case STATE_RFID_DETECTED: return "RFID_DETECTED";
          case STATE_RFID_VALID: return "RFID_VALID";
          case STATE_MENU: return "MENU";
          case STATE_EVENT_LOG: return "EVENT_LOG";
          case STATE_LOGOUT_DENIED: return "LOGOUT_DENIED";
          case STATE_STACK_STATUS: return "STACK_STATUS";
          case STATE_SERVER_OFFLINE: return "SERVER_OFFLINE";
          case STATE_SYSTEM_ERROR: return "SYSTEM_ERROR";
          case STATE_INITIALIZING: return "INITIALIZING";
          case STATE_CONNECTING: return "CONNECTING";
          case STATE_SHOW_IP: return "SHOW_IP";
          case STATE_SYSTEM_READY: return "SYSTEM_READY";
          case STATE_COUNTDOWN: return "COUNTDOWN";
          case STATE_SUPERVISOR_VALID: return "SUPERVISOR_VALID";
          case STATE_MECHANIC_VALID: return "MECHANIC_VALID";
          case STATE_ALL_WORKERS_REGISTERED: return "ALL_WORKERS_REGISTERED";
          case STATE_LOGOUT_SUCCESS: return "LOGOUT_SUCCESS";
          case STATE_ALL_WORKERS_OUT: return "ALL_WORKERS_OUT";
          case STATE_UNLOCKING: return "UNLOCKING";
          case STATE_SYSTEM_READY_FINAL: return "SYSTEM_READY_FINAL";
          case STATE_WELCOME: return "WELCOME";
          default: return "UNKNOWN";
      }
  }

  void buzzSuccess() {
      digitalWrite(PIN_BUZZER, HIGH); amanDelay(150);
      digitalWrite(PIN_BUZZER, LOW); 
  }

  void buzzFailed() {
      for (int i = 0; i < 3; i++) {
          digitalWrite(PIN_BUZZER, HIGH); amanDelay(50);
          digitalWrite(PIN_BUZZER, LOW);
          if (i < 2) amanDelay(50);
      }
  }

  void buzzTick() {
      digitalWrite(PIN_BUZZER, HIGH); amanDelay(20);
      digitalWrite(PIN_BUZZER, LOW);
  }

  // ============================================================================
  // BUNYI HITUNG MUNDUR (DIPAKAI SAMA PERSIS UNTUK COUNTDOWN MASUK & KELUAR)
  // ============================================================================
  void countdownBeep(int detik) {
      if (detik <= 3) {
          digitalWrite(PIN_BUZZER, HIGH); amanDelay(500);
          digitalWrite(PIN_BUZZER, LOW);  amanDelay(500);
      } else {
          digitalWrite(PIN_BUZZER, HIGH); amanDelay(60);
          digitalWrite(PIN_BUZZER, LOW);  amanDelay(940);
      }
  }

  void clearMainScreenArea() {
      tft.fillRect(0, 42, 480, 228, ELOTO_BG);
      tft.drawRoundRect(8, 49, 464, 212, 6, TFT_DARKGREY);
  }

  // Decorative corner accents untuk layar splash/boot
  void drawCornerAccents(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
      int16_t len = 20;
      // Top-left
      tft.drawFastHLine(x, y, len, color);
      tft.drawFastVLine(x, y, len, color);
      // Top-right
      tft.drawFastHLine(x + w - len, y, len, color);
      tft.drawFastVLine(x + w - 1, y, len, color);
      // Bottom-left
      tft.drawFastHLine(x, y + h - 1, len, color);
      tft.drawFastVLine(x, y + h - len, len, color);
      // Bottom-right
      tft.drawFastHLine(x + w - len, y + h - 1, len, color);
      tft.drawFastVLine(x + w - 1, y + h - len, len, color);
  }

  // Garis dekoratif horizontal
  void drawDecorativeLine(int16_t y, uint16_t color) {
      tft.drawFastHLine(60, y, 360, color);
      tft.fillCircle(240, y, 3, color);
      tft.fillCircle(60, y, 2, color);
      tft.fillCircle(420, y, 2, color);
  }

  // ============================================================================
  // POP-UP NOTIFIKASI
  // ============================================================================
  void displayCardNotification(String uid, String name, String role, String statusMsg, bool isSuccess) {
      digitalWrite(SD_CS_PIN, HIGH);
      tft.fillRoundRect(14, 54, 452, 204, 8, ELOTO_BG);
      tft.drawRoundRect(14, 54, 452, 204, 8, ELOTO_HEADER);

      tft.setTextDatum(MC_DATUM);
      setStoryFont(12);
      tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
      tft.drawString(statusMsg, 240, 72);

      tft.fillRect(25, 91, 150, 150, ELOTO_BG);
      tft.drawRect(25, 91, 150, 150, ELOTO_TEXT);
      if (!drawPhotoFromAPI(uid, 25, 91, 150, 150)) {
          drawSinglePersonIcon(100, 166, 2.5, ELOTO_HEADER, false);
      }

      tft.setTextDatum(TL_DATUM);
      tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
      drawTextFit(name, 190, 106, 260, ELOTO_HEADER, ELOTO_BG, 9);

      // Mode registrasi: tampilkan RFID UID di LCD supaya admin bisa catat
      if (statusMsg == "REGISTRASI OK!") {
          drawTextFit("RFID UID : " + uid, 190, 130, 260, ELOTO_HEADER, ELOTO_BG, 9);
          drawTextFit("SUDAH DIKIRIM KE SERVER", 190, 162, 260, ELOTO_TEXT, ELOTO_BG, 9);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          tft.drawString("DAFTARKAN DI DASHBOARD", 190, 206);
      } else {
          drawTextFit("SID      : " + formatSid(lastScannedSID), 190, 142, 260, ELOTO_TEXT, ELOTO_BG, 9);
          drawTextFit("JABATAN  : " + role, 190, 174, 260, ELOTO_TEXT, ELOTO_BG, 9);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          tft.drawString("BERHASIL TERVERIFIKASI", 190, 206);
      }
      drawTftFooter("", "");
      
      uint32_t displayDuration = isSuccess ? NOTIFICATION_SUCCESS_DURATION : NOTIFICATION_ERROR_DURATION;
      unsigned long startNotify = millis();
      while (millis() - startNotify < displayDuration) {
          server.handleClient();
          feedGPS();
          clearRfidBuffer();  // Bersihkan buffer RFID selama notifikasi supaya tidak ada sisa data
          if (millis() - startNotify > 200 && readADKeypadRaw() != KEY_NONE) break;
          delay(5);
      }

      clearMainScreenArea();
      clearRfidBuffer();
      // Reset anti-double-tap supaya kartu bisa di-tap lagi setelah notifikasi tertutup
      lastScannedRfidUID = "";
      lastScannedRfidTime = 0;
      lastRenderedState = STATE_SYSTEM_ERROR;
      needsRedraw = true;
  }

  void displayErrorCardPopup(String uid, String title, String name, String role, String sid, String bottomHint) {
      digitalWrite(SD_CS_PIN, HIGH);
      tft.fillRoundRect(14, 54, 452, 204, 8, ELOTO_BG);
      tft.drawRoundRect(14, 54, 452, 204, 8, ELOTO_HEADER);

      tft.setTextDatum(MC_DATUM);
      setStoryFont(12);
      tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
      tft.drawString(title, 240, 72);

      if (name.length() > 0 && name != "UNKNOWN" && name != "Tidak Terdaftar") {
          int16_t photoX = 25;
          int16_t photoY = 92;
          int16_t photoSize = 100;
          tft.fillRect(photoX, photoY, photoSize, photoSize, ELOTO_BG);
          tft.drawRect(photoX, photoY, photoSize, photoSize, ELOTO_TEXT);
          drawSinglePersonIcon(photoX + (photoSize / 2), photoY + (photoSize / 2), 1.5, ELOTO_HEADER, false);

          tft.setTextDatum(TL_DATUM);
          drawTextFit("NAMA    : " + name, 138, 104, 310, ELOTO_HEADER, ELOTO_BG, 9);
          drawTextFit("JABATAN : " + role, 138, 136, 310, ELOTO_TEXT, ELOTO_BG, 9);
          drawTextFit("SID     : " + formatSid(sid), 138, 168, 310, ELOTO_TEXT, ELOTO_BG, 9);

          setStoryFont(9);
          tft.setTextDatum(MC_DATUM);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          tft.drawString(bottomHint, 240, 228);
      } else {
          // Kartu tidak dikenal — tampilkan UID kartu di popup
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          tft.drawString("KARTU TIDAK TERDAFTAR", 240, 110);

          // Tampilkan RFID UID supaya admin bisa catat
          if (uid.length() > 0) {
              tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
              setStoryFont(9);
              tft.drawString("RFID UID: " + uid, 240, 145);
          }

          setStoryFont(9);
          tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
          tft.drawString(bottomHint, 240, 190);
      }
      
      drawTftFooter("", "");
      unsigned long startNotify = millis();
      while (millis() - startNotify < NOTIFICATION_ERROR_DURATION) {
          server.handleClient();
          feedGPS();
          clearRfidBuffer();  // Bersihkan buffer RFID selama error popup
          if (millis() - startNotify > 200 && readADKeypadRaw() != KEY_NONE) break;
          delay(5);
      }

      clearMainScreenArea();
      clearRfidBuffer();
      // Reset anti-double-tap supaya kartu bisa di-tap lagi
      lastScannedRfidUID = "";
      lastScannedRfidTime = 0;
      lastRenderedState = STATE_SYSTEM_ERROR;
      needsRedraw = true;
  }

  // ============================================================================
  // REFUELING: FUELMAN BISA TAP DARI LAYAR MANAPUN (BEBAS, TANPA tunggu SPV)
  // ============================================================================
  bool handleFuelmanTap(const String &uid, WorkerInfo &card) {
      if (!isFuelmanRole(card.role)) return false;

      activeFuelmanUID = uid;
      activeFuelmanName = card.name;

      buzzSuccess();
      logAuditAsync("REFUEL_START", uid);

      // Tampilkan popup refueling singkat (1.5 detik)
      // Layout: konsisten dengan displayCardNotification (150x150 foto kiri, teks kanan)
      digitalWrite(SD_CS_PIN, HIGH);
      tft.fillRoundRect(14, 54, 452, 204, 8, ELOTO_BG);
      tft.drawRoundRect(14, 54, 452, 204, 8, TFT_GREEN);

      tft.setTextDatum(MC_DATUM);
      setStoryFont(12);
      tft.setTextColor(TFT_GREEN, ELOTO_BG);
      tft.drawString("PENGISIAN BBM", 240, 72);

      tft.fillRect(25, 91, 150, 150, ELOTO_BG);
      tft.drawRect(25, 91, 150, 150, TFT_GREEN);
      if (!drawPhotoFromAPI(uid, 25, 91, 150, 150)) {
          drawSinglePersonIcon(100, 166, 2.5, TFT_GREEN, false);
      }

      tft.setTextDatum(TL_DATUM);
      setStoryFont(9);
      tft.setTextColor(TFT_GREEN, ELOTO_BG);
      drawTextFit(card.name, 190, 106, 260, TFT_GREEN, ELOTO_BG, 9);
      tft.setTextColor(TFT_WHITE, ELOTO_BG);
      drawTextFit("SID      : " + formatSid(card.sid), 190, 138, 260, TFT_WHITE, ELOTO_BG, 9);
      drawTextFit("JABATAN  : PETUGAS BBM", 190, 166, 260, TFT_WHITE, ELOTO_BG, 9);
      drawTextFit("STATUS   : PENGISIAN BBM", 190, 194, 260, TFT_GREEN, ELOTO_BG, 9);

      drawTftFooter("", "");

      unsigned long startNotify = millis();
      while (millis() - startNotify < 1500) {
          server.handleClient();
          feedGPS();
          delay(5);
      }

      clearMainScreenArea();
      clearRfidBuffer();
      lastRenderedState = STATE_SYSTEM_ERROR;
      needsRedraw = true;
      saveSessionToSD();
      return true;
  }

  void sanitizeQueueDeadlock() {
      if (safetyQueue.topIndex <= 0) return;
      
      bool changed = false;
      for (int i = 1; i <= safetyQueue.topIndex; i++) {
          String u = safetyQueue.workers[i].uid;
          u.trim(); u.toUpperCase();
          String spvU = supervisorUID;
          spvU.trim(); spvU.toUpperCase();
          
          if ((spvU != "" && u.equalsIgnoreCase(spvU)) || checkIsSupervisorRole(safetyQueue.workers[i].role)) {
              for (int j = i; j < safetyQueue.topIndex; j++) {
                  safetyQueue.workers[j] = safetyQueue.workers[j + 1];
              }
              safetyQueue.workers[safetyQueue.topIndex].uid = "";
              safetyQueue.workers[safetyQueue.topIndex].name = "";
              safetyQueue.workers[safetyQueue.topIndex].role = "";
              safetyQueue.topIndex--;
              i--;
              changed = true;
          }
      }
      if (changed) rebuildCachedQueueString();
  }

  void rebuildCachedQueueString() {
      cachedQueueList = "";
      for (int i = 0; i <= safetyQueue.topIndex; i++) {
          String displayedRole = safetyQueue.workers[i].role;
          displayedRole.toUpperCase();
          if (checkIsSupervisorRole(displayedRole) || (i == 0 && safetyQueue.workers[i].uid.equalsIgnoreCase(supervisorUID))) {
              displayedRole = "PENGAWAS";
          } else if (displayedRole.indexOf("FUEL") != -1 || displayedRole.indexOf("BBM") != -1) {
              displayedRole = "FUELMAN";
          } else {
              displayedRole = "MEKANIK";
          }
          cachedQueueList += "[" + displayedRole + "] " + safetyQueue.workers[i].name;
          if (i < safetyQueue.topIndex) cachedQueueList += " - ";
      }
  }

  void saveSessionToSD() {
      if (!sdCardMounted || sdMutex == NULL) return;
      if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(150)) == pdTRUE) {
          digitalWrite(TFT_CS_PIN, HIGH);
          if (SD.exists("/session.json")) SD.remove("/session.json");

          File sessionFile = SD.open("/session.json", FILE_WRITE);
          if (sessionFile) {
              DynamicJsonDocument doc(2048);
              doc["state"]               = (int)currentState;
              doc["spv_uid"]             = supervisorUID;
              doc["spv_sid"]             = safetyQueue.topIndex >= 0 ? safetyQueue.workers[0].sid : "-----";
              doc["spv_name"]            = supervisorName;
              doc["spv_role"]            = supervisorRole;
              doc["target_count"]        = targetMekanikCount;
              doc["top_index"]           = safetyQueue.topIndex;
              doc["is_session_active"]   = isSessionActive;
              doc["session_elapsed_ms"]  = isSessionActive ? (millis() - sessionStartTime) : 0;
              doc["is_adding_from_menu"] = isAddingFromMenu;
              doc["selected_worker_idx"] = selectedWorkerIndex;
              doc["selected_menu_idx"]   = selectedMenuIndex;
              doc["selected_footer"]     = selectedFooterAction;
              doc["mekanik_display"]     = lastMekanikDisplayCount;
              doc["mekanik_init_out"]    = initialMekanikOutCount;
              doc["fuelman_uid"]         = activeFuelmanUID;
              doc["fuelman_name"]        = activeFuelmanName;
              doc["last_scanned_uid"]    = lastScannedUID;
              doc["last_scanned_sid"]    = lastScannedSID;

              if (gpsHasFix) {
                  doc["last_lat"] = currentLatitude;
                  doc["last_lon"] = currentLongitude;
              }

              JsonArray q = doc.createNestedArray("queue");
              for (int i = 0; i <= safetyQueue.topIndex; i++) {
                  JsonObject obj = q.createNestedObject();
                  obj["uid"]  = safetyQueue.workers[i].uid;
                  obj["sid"]  = formatSid(safetyQueue.workers[i].sid);
                  obj["name"] = safetyQueue.workers[i].name;
                  obj["role"] = safetyQueue.workers[i].role;
              }
              serializeJson(doc, sessionFile);
              sessionFile.close();
          }
          digitalWrite(SD_CS_PIN, HIGH);
          xSemaphoreGive(sdMutex);
      }
  }

  void clearSessionFromSD() {
      if (!sdCardMounted || sdMutex == NULL) return;
      if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(150)) == pdTRUE) {
          digitalWrite(TFT_CS_PIN, HIGH);
          if (SD.exists("/session.json")) SD.remove("/session.json");
          digitalWrite(SD_CS_PIN, HIGH);
          xSemaphoreGive(sdMutex);
      }
  }

  bool loadSessionFromSD() {
      if (!sdCardMounted || sdMutex == NULL) return false;
      bool success = false;

      if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
          digitalWrite(TFT_CS_PIN, HIGH);
          if (SD.exists("/session.json")) {
              File sessionFile = SD.open("/session.json", FILE_READ);
              if (sessionFile) {
                  DynamicJsonDocument doc(2048);
                  DeserializationError err = deserializeJson(doc, sessionFile);
                  sessionFile.close();

                  if (!err) {
                      int stateInt = doc["state"] | STATE_IDLE;
                      if (stateInt < STATE_BOOT_IP || stateInt > STATE_WELCOME) stateInt = STATE_IDLE;
                      currentState = (SystemState)stateInt;

                      supervisorUID      = doc["spv_uid"].as<String>();
                      String savedSupervisorSid = doc["spv_sid"] | "-----";
                      supervisorName     = doc["spv_name"].as<String>();
                      supervisorRole     = doc["spv_role"].as<String>();
                      targetMekanikCount = doc["target_count"] | 0;
                      safetyQueue.topIndex = doc["top_index"] | -1;
                      isAddingFromMenu   = doc["is_adding_from_menu"] | false;
                      selectedWorkerIndex = doc["selected_worker_idx"] | 0;
                      selectedMenuIndex  = doc["selected_menu_idx"] | 0;
                      selectedFooterAction = doc["selected_footer"] | 1;
                      lastMekanikDisplayCount = doc["mekanik_display"] | -99;
                      initialMekanikOutCount  = doc["mekanik_init_out"] | -1;
                      activeFuelmanUID   = doc["fuelman_uid"] | "";
                      activeFuelmanName  = doc["fuelman_name"] | "";
                      lastScannedUID     = doc["last_scanned_uid"] | "---";
                      lastScannedSID     = doc["last_scanned_sid"] | "-----";

                      JsonArray q = doc["queue"].as<JsonArray>();
                      int idx = 0;
                      for (JsonObject obj : q) {
                          if (idx < MAX_WORKERS) {
                              safetyQueue.workers[idx].uid  = obj["uid"].as<String>();
                              safetyQueue.workers[idx].sid  = formatSid(obj["sid"] | (idx == 0 ? savedSupervisorSid : "-----"));
                              safetyQueue.workers[idx].name = obj["name"].as<String>();
                              safetyQueue.workers[idx].role = obj["role"].as<String>();
                              idx++;
                          }
                      }
                      sanitizeQueueDeadlock();
                      rebuildCachedQueueString();

                      bool savedSessionActive = doc["is_session_active"] | false;
                      unsigned long savedElapsed = doc["session_elapsed_ms"] | 0UL;

                      if (savedSessionActive && stateInt >= STATE_WAIT_SPV_IN && stateInt <= STATE_ALL_WORKERS_OUT) {
                          isSessionActive = true;
                          sessionStartTime = millis() - savedElapsed;
                      } else {
                          isSessionActive = false;
                          sessionStartTime = 0;
                      }

                      // Restore GPS coordinates terakhir (sebelum GPS module fix baru)
                      if (doc.containsKey("last_lat") && doc.containsKey("last_lon")) {
                          double savedLat = doc["last_lat"] | 0.0;
                          double savedLon = doc["last_lon"] | 0.0;
                          if (savedLat != 0.0 && savedLon != 0.0) {
                              currentLatitude = savedLat;
                              currentLongitude = savedLon;
                          }
                      }

                      success = true;
                  }
              }
          }
          digitalWrite(SD_CS_PIN, HIGH);
          xSemaphoreGive(sdMutex);
      }
      return success;
  }

  void loadUsersToRAM() {
      ramUserCount = 0;
      if (!sdCardMounted || sdMutex == NULL) {
          return;
      }
      if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
          digitalWrite(TFT_CS_PIN, HIGH);
          if (SD.exists("/users.csv")) {
              File userFile = SD.open("/users.csv", FILE_READ);
              if (userFile) {
                  while (userFile.available() && ramUserCount < MAX_RAM_USERS) {
                      String line = userFile.readStringUntil('\n');
                      line.trim();
                      if (line.length() > 0) {
                          // Format: uid,name,role,isSpv,sid (5 field)
                          int p1 = line.indexOf(',');
                          int p2 = line.indexOf(',', p1 + 1);
                          int p3 = line.indexOf(',', p2 + 1);

                          if (p1 != -1 && p2 != -1 && p3 != -1) {
                              ramUserCache[ramUserCount].uid  = line.substring(0, p1);
                              ramUserCache[ramUserCount].name = line.substring(p1 + 1, p2);
                              ramUserCache[ramUserCount].role = line.substring(p2 + 1, p3);
                              int p4 = line.indexOf(',', p3 + 1);
                              // Field ke-4 = isSpv (0/1), field ke-5 = sid
                              if (p4 != -1) {
                                  String sidVal = line.substring(p4 + 1);
                                  sidVal.trim();
                                  ramUserCache[ramUserCount].sid = sidVal;
                              } else {
                                  ramUserCache[ramUserCount].sid = "";
                              }
                              ramUserCache[ramUserCount].isSpv = checkIsSupervisorRole(ramUserCache[ramUserCount].role);
                              ramUserCache[ramUserCount].isRegistered = true;
                              ramUserCache[ramUserCount].isAssigned = true;
                              ramUserCount++;
                          }
                      }
                  }
                  userFile.close();
              }
          }
          digitalWrite(SD_CS_PIN, HIGH);
          xSemaphoreGive(sdMutex);
      }
  }

  void pushQueue(String uid, String sid, String name, String role) {
      if (safetyQueue.topIndex < (MAX_WORKERS - 1)) {
          safetyQueue.topIndex++;
          safetyQueue.workers[safetyQueue.topIndex].uid = uid;
          safetyQueue.workers[safetyQueue.topIndex].sid = sid;
          safetyQueue.workers[safetyQueue.topIndex].name = name;
          
          String cleanRole = role;
          cleanRole.toUpperCase();
          if (checkIsSupervisorRole(cleanRole)) {
              cleanRole = "PENGAWAS";
          } else if (cleanRole.indexOf("FUEL") != -1 || cleanRole.indexOf("BBM") != -1) {
              cleanRole = "FUELMAN";
          } else {
              cleanRole = "MEKANIK";
          }
          safetyQueue.workers[safetyQueue.topIndex].role = cleanRole;
          
          sanitizeQueueDeadlock();
          rebuildCachedQueueString();
          saveSessionToSD();
          forceFullRedraw = true;
          needsRedraw = true;
      }
  }

  void removeQueueAt(int index) {
      if (index < 0 || index > safetyQueue.topIndex) return;
      for (int i = index; i < safetyQueue.topIndex; i++) {
          safetyQueue.workers[i] = safetyQueue.workers[i + 1];
      }
      safetyQueue.workers[safetyQueue.topIndex].uid = "";
      safetyQueue.workers[safetyQueue.topIndex].name = "";
      safetyQueue.workers[safetyQueue.topIndex].role = "";
      safetyQueue.topIndex--;
      
      sanitizeQueueDeadlock();
      rebuildCachedQueueString();
      saveSessionToSD();
      forceFullRedraw = true;
      needsRedraw = true;
  }

  int findWorkerIndex(String uid) {
      String cleanUid = uid;
      cleanUid.trim();
      cleanUid.toUpperCase();
      for (int i = 0; i <= safetyQueue.topIndex; i++) {
          String wUid = safetyQueue.workers[i].uid;
          wUid.trim();
          wUid.toUpperCase();
          if (wUid.equalsIgnoreCase(cleanUid)) return i;
      }
      return -1;
  }

  void syncDatabaseToSDCard() {
      if (!sdCardMounted || WiFi.status() != WL_CONNECTED || sdMutex == NULL) return;
      if (ESP.getFreeHeap() < 30000) return;

      WiFiClient client; client.setTimeout(1500);
      HTTPClient http;
      http.begin(client, getApiUrl("users"));
      http.addHeader("User-Agent", "ESP32-E-LOTO/5.0");
      http.addHeader("X-Device-Token", device_token);
      http.setTimeout(2000);

      int httpCode = http.GET();
      Serial.printf("[SYNC] GET /api/users — HTTP %d\n", httpCode);
      if (httpCode == HTTP_CODE_OK) {
          String jsonStr = http.getString();
          DynamicJsonDocument doc(6144);
          DeserializationError err = deserializeJson(doc, jsonStr);
          JsonArray arr = !err && doc["data"].is<JsonArray>() ? doc["data"].as<JsonArray>() : JsonArray();
          
          if (!err && !arr.isNull()) {
              int syncCount = 0;
              if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
                  digitalWrite(TFT_CS_PIN, HIGH);
                  if (SD.exists("/users.csv")) SD.remove("/users.csv");
                  File userFile = SD.open("/users.csv", FILE_WRITE);
                  if (userFile) {
                      for (JsonObject u : arr) {
                          String uid = "";
                          if (u.containsKey("rfidUid") && !u["rfidUid"].isNull()) uid = u["rfidUid"].as<String>();
                          else if (u.containsKey("rfid_uid") && !u["rfid_uid"].isNull()) uid = u["rfid_uid"].as<String>();
                          else if (u.containsKey("sid") && !u["sid"].isNull()) uid = u["sid"].as<String>();
                          
                          uid.trim(); uid.toUpperCase();
                          String name = u.containsKey("nama") ? u["nama"].as<String>() : "UNKNOWN";
                          String role = u.containsKey("role") ? u["role"].as<String>() : "MEKANIK";
                          name.replace(",", " ");
                          role.replace(",", " ");
                          role.toUpperCase();
                          bool isSpv = checkIsSupervisorRole(role);
                          
                          if (uid != "" && uid != "NULL") {
                              String sid = u.containsKey("sid") ? u["sid"].as<String>() : "";
                              sid.trim();
                              userFile.println(uid + "," + name + "," + role + "," + String(isSpv ? 1 : 0) + "," + sid);
                              syncCount++;
                          }
                      }
                      userFile.close();
                  }
                  digitalWrite(SD_CS_PIN, HIGH);
                  xSemaphoreGive(sdMutex);
              }
              loadUsersToRAM();
              Serial.printf("[SYNC] Berhasil sync %d user ke SD Card & RAM cache\n", syncCount);

              // Yield supaya network task bisa proses heartbeat selama download foto
              vTaskDelay(pdMS_TO_TICKS(10));

              // Pre-cache foto semua user ke SD card untuk mode offline
              // CATATAN: Mutex DIAMBIL PER-FOTO (bukan untuk semua sekaligus) supaya TFT tidak macet
              for (int i = 0; i < ramUserCount; i++) {
                  if (WiFi.status() != WL_CONNECTED || ESP.getFreeHeap() < 40000) break;
                  String uid = ramUserCache[i].uid;
                  uid.trim(); uid.toUpperCase();
                  if (uid.length() == 0) continue;
                  String photoPath = "/foto/" + uid + ".jpg";
                  // Cek dulu apakah sudah ada di SD (ambil & lepas mutex cepat)
                  bool alreadyCached = false;
                  if (sdCardMounted && xSemaphoreTake(sdMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                      digitalWrite(TFT_CS_PIN, HIGH);
                      alreadyCached = SD.exists(photoPath);
                      digitalWrite(SD_CS_PIN, HIGH);
                      xSemaphoreGive(sdMutex);
                  }
                  if (alreadyCached) continue;
                  // Download foto dari server (tanpa mutex — HTTP download bisa lama)
                  WiFiClient photoClient; photoClient.setTimeout(3000);
                  HTTPClient photoHttp;
                  String url = getApiUrl("users/photo/") + uid + "?size=150&quality=82";
                  photoHttp.begin(photoClient, url);
                  photoHttp.addHeader("Accept", "image/jpeg");
                  photoHttp.addHeader("X-Device-Token", device_token);
                  photoHttp.setTimeout(5000);
                  int photoCode = photoHttp.GET();
                  if (photoCode == HTTP_CODE_OK) {
                      String jpeg = photoHttp.getString();
                      if (jpeg.length() > 100 && (uint8_t)jpeg[0] == 0xFF && (uint8_t)jpeg[1] == 0xD8) {
                          // Simpan ke SD card (ambil mutex hanya untuk tulis)
                          if (sdCardMounted && xSemaphoreTake(sdMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
                              digitalWrite(TFT_CS_PIN, HIGH);
                              File f = SD.open(photoPath, FILE_WRITE);
                              if (f) { f.write((const uint8_t*)jpeg.c_str(), jpeg.length()); f.close(); }
                              digitalWrite(SD_CS_PIN, HIGH);
                              xSemaphoreGive(sdMutex);
                          }
                          Serial.printf("[SYNC] Foto %s cached ke SD (%d bytes)\n", uid.c_str(), jpeg.length());
                      } else {
                          Serial.printf("[SYNC] Foto %s: bukan JPEG valid (len=%d)\n", uid.c_str(), jpeg.length());
                      }
                  } else {
                      Serial.printf("[SYNC] Foto %s: HTTP %d (skip)\n", uid.c_str(), photoCode);
                  }
                  photoHttp.end();
                  // Yield supaya network task bisa proses heartbeat queue
                  // antar download foto (heartbeats dari Core 1 menumpuk di queue)
                  vTaskDelay(pdMS_TO_TICKS(15));
              }
          }
      } else if (httpCode == 401 || httpCode == 403) {
          Serial.printf("[SYNC] GAGAL: HTTP %d — Device token tidak cocok! Jalankan: node scripts/set-device-token.js\n", httpCode);
      } else {
          Serial.printf("[SYNC] GAGAL: HTTP %d\n", httpCode);
      }
      http.end();
  }

  WorkerInfo searchUserFromSDCard(String uid) {
      WorkerInfo card;
      card.uid = uid;
      card.sid = "-----";
      card.name = "UNKNOWN";
      card.role = "MEKANIK";
      card.isSpv = false;
      card.isRegistered = false;
      card.isAssigned = true;
      
      if (!sdCardMounted || sdMutex == NULL) return card;
      
      if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
          digitalWrite(TFT_CS_PIN, HIGH);
          File userFile = SD.open("/users.csv", FILE_READ);
          if (userFile) {
              while (userFile.available()) {
                  String line = userFile.readStringUntil('\n'); line.trim();
                  if (line.length() > 0) {
                      int p1 = line.indexOf(','); int p2 = line.indexOf(',', p1 + 1); int p3 = line.indexOf(',', p2 + 1);
                      if (p1 != -1 && p2 != -1 && p3 != -1) {
                          String fileUid  = line.substring(0, p1);
                          String fileName = line.substring(p1 + 1, p2);
                          String fileRole = line.substring(p2 + 1, p3);
                          if (fileUid.equalsIgnoreCase(uid)) {
                              card.name = fileName;
                              card.role = fileRole;
                              // Format: uid,name,role,isSpv,sid
                              int p4 = line.indexOf(',', p3 + 1);
                              if (p4 != -1) {
                                  card.sid = line.substring(p4 + 1);
                              } else {
                                  card.sid = "";
                              }
                              card.sid.trim();
                              card.isSpv = checkIsSupervisorRole(fileRole);
                              card.isRegistered = (fileName != "UNKNOWN" && fileName != "Tidak Terdaftar");
                              userFile.close();
                              digitalWrite(SD_CS_PIN, HIGH);
                              xSemaphoreGive(sdMutex);
                              return card;
                          }
                      }
                  }
              }
              userFile.close();
          }
          digitalWrite(SD_CS_PIN, HIGH);
          xSemaphoreGive(sdMutex);
      }
      return card;
  }

  void saveOfflineLogToSDCard(String event, String uid) {
      if (!sdCardMounted || sdMutex == NULL) return;
      if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(150)) == pdTRUE) {
          digitalWrite(TFT_CS_PIN, HIGH);
          File logFile = SD.open("/offline_logs.csv", FILE_APPEND);
          if (logFile) {
              String latitude = hasValidGpsFix() ? String(currentLatitude, 6) : "";
              String longitude = hasValidGpsFix() ? String(currentLongitude, 6) : "";
              logFile.println(String(millis()) + "," + event + "," + uid + "," + latitude + "," + longitude);
              logFile.close();
          } 
          digitalWrite(SD_CS_PIN, HIGH);
          xSemaphoreGive(sdMutex);
      }
  }

  void uploadOfflineLogsSDCard() {
      if (!sdCardMounted || WiFi.status() != WL_CONNECTED || sdMutex == NULL) return;
      if (ESP.getFreeHeap() < 30000) return;
      if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(300)) == pdTRUE) {
          bool uploadFailed = false;
          digitalWrite(TFT_CS_PIN, HIGH);
          if (SD.exists("/offline_logs.csv")) {
              File logFile = SD.open("/offline_logs.csv", FILE_READ);
              if (logFile) {
                  while (logFile.available()) {
                      String line = logFile.readStringUntil('\n'); line.trim();
                      if (line.length() > 0) {
                          int p1 = line.indexOf(','); int p2 = line.indexOf(',', p1 + 1); int p3 = line.indexOf(',', p2 + 1);
                          if (p1 != -1 && p2 != -1) {
                              String event = line.substring(p1 + 1, p2);
                              String uidEnd = line.substring(p2 + 1, p3 != -1 ? p3 : line.length());
                              int p4 = p3 != -1 ? line.indexOf(',', p3 + 1) : -1;
                              String uid = uidEnd;
                              String latitude = "";
                              String longitude = "";
                              if (p3 != -1) {
                                  latitude = line.substring(p3 + 1, p4 != -1 ? p4 : line.length());
                                  if (p4 != -1) longitude = line.substring(p4 + 1);
                              }
                              uid.trim(); latitude.trim(); longitude.trim();
                              
                              WiFiClient client; client.setTimeout(2000);
                              HTTPClient http;
                              http.begin(client, getApiUrl("boxes/") + getDeviceIdPath() + "/telemetry");
                              http.addHeader("Content-Type", "application/json");
                              DynamicJsonDocument doc(512);
                              doc["id_box"] = getDeviceId(); doc["event"] = event; doc["uid"] = uid;
                              doc["is_tap"] = isTapEventName(event);
                              doc["is_register_scan"] = event.indexOf("REGISTER_NEW_CARD") != -1;
                              doc["is_online"] = true;
                              if (latitude.length() > 0 && longitude.length() > 0) {
                                  doc["lat"] = latitude.toDouble();
                                  doc["lng"] = longitude.toDouble();
                                  doc["gps_fix"] = true;
                              }
                              String payload; serializeJson(doc, payload);
                              int httpCode = http.POST(payload);
                              if (httpCode < 200 || httpCode >= 300) uploadFailed = true;
                              http.end(); delay(5);
                          }
                      }
                  }
                  logFile.close();
                  if (!uploadFailed) SD.remove("/offline_logs.csv");
              }
          }
          digitalWrite(SD_CS_PIN, HIGH);
          xSemaphoreGive(sdMutex);
      }
  }

  WorkerInfo fetchCardDataAPI(String uid) {
      WorkerInfo card;
      card.uid = uid;
      card.sid = "-----";
      card.name = "UNKNOWN";
      card.role = "MEKANIK";
      card.isSpv = false;
      card.isRegistered = false;
      card.isAssigned = true;

      String cleanUID = normalizeRfidUid(uid);
      String decPadded = hexToDecStringPadded(cleanUID);
      String decUnpadded = hexToDecStringUnpadded(cleanUID);

      Serial.printf("[RFID] Lookup UID: %s (dec: %s / %s) — RAM: %d user — SD: %s\n",
                    cleanUID.c_str(), decPadded.c_str(), decUnpadded.c_str(),
                    ramUserCount, sdCardMounted ? "OK" : "N/A");

      // 1. Cek RAM cache dulu (paling cepat)
      for (int i = 0; i < ramUserCount; i++) {
          if (ramUserCache[i].uid.equalsIgnoreCase(cleanUID) ||
              ramUserCache[i].uid.equalsIgnoreCase(decPadded) ||
              ramUserCache[i].uid.equalsIgnoreCase(decUnpadded)) {
              card = ramUserCache[i];
              card.uid = cleanUID;
              card.isSpv = checkIsSupervisorRole(card.role);
              Serial.printf("[RFID] ✓ RAM cache: %s [%s]\n", card.name.c_str(), card.role.c_str());
              return card;
          }
      }

      // 2. Cek SD Card (users.csv)
      if (sdCardMounted) {
          card = searchUserFromSDCard(cleanUID);
          if (!card.isRegistered) card = searchUserFromSDCard(decPadded);
          if (!card.isRegistered) card = searchUserFromSDCard(decUnpadded);
          if (card.isRegistered) {
              Serial.printf("[RFID] ✓ SD Card: %s [%s]\n", card.name.c_str(), card.role.c_str());
              // Update RAM cache
              if (ramUserCount < MAX_RAM_USERS) {
                  ramUserCache[ramUserCount] = card;
                  ramUserCount++;
              }
              return card;
          }
      }

      // 3. API backend — kalau RAM kosong DAN SD kosong, ini jadi HARUS berhasil
      if (WiFi.status() == WL_CONNECTED && ESP.getFreeHeap() > 30000) {
          WiFiClient client; client.setTimeout(300);
          HTTPClient http;
          String url = getApiUrl("users/check-card");
          http.begin(client, url);
          http.addHeader("Content-Type", "application/json");
          http.addHeader("X-Device-Token", device_token);
          http.setTimeout(400);
          DynamicJsonDocument requestDoc(256);
          requestDoc["rfid_uid"] = cleanUID;
          String requestBody;
          serializeJson(requestDoc, requestBody);

          int httpCode = http.POST(requestBody);
          Serial.printf("[RFID] API check-card: HTTP %d untuk %s\n", httpCode, cleanUID.c_str());

          if (httpCode == HTTP_CODE_OK) {
              String responseStr = http.getString();
              DynamicJsonDocument doc(512);
              if (!deserializeJson(doc, responseStr)) {
                  JsonObject userData = doc["data"].as<JsonObject>();
                  String apiName = userData["nama"] | "UNKNOWN";
                  String apiRole = normalizeUserRole(userData["role"] | "MEKANIK");
                  apiName.trim();

                  bool knownName = apiName.length() > 0 &&
                                   !apiName.equalsIgnoreCase("UNKNOWN") &&
                                   !apiName.equalsIgnoreCase("NOT_FOUND") &&
                                   !apiName.equalsIgnoreCase("TIDAK TERDAFTAR");

                  if (knownName) {
                      card.uid = cleanUID;
                      card.sid = formatSid(userData["sid"] | "");
                      card.name = apiName;
                      card.role = apiRole;
                      card.isSpv = checkIsSupervisorRole(apiRole);
                      card.isRegistered = true;
                      card.isAssigned = true;
                      Serial.printf("[RFID] ✓ API: %s [%s]\n", card.name.c_str(), card.role.c_str());
                  }
              }
          } else if (httpCode == 401 || httpCode == 403) {
              Serial.printf("[RFID] ✗ API HTTP %d — DEVICE TOKEN TIDAK COCOK!\n", httpCode);
          } else {
              Serial.printf("[RFID] ✗ API HTTP %d\n", httpCode);
          }
          http.end();
      } else {
          Serial.println("[RFID] ✗ WiFi OFF — tidak bisa cek API");
      }
      return card;
  }

  void networkTaskCore0(void * pvParameters) {
      unsigned long lastWifiCheckTask = 0;
      unsigned long lastHeartbeatTask = 0;
      unsigned long lastDbSyncTask    = 0;
      unsigned long lastReconnectAttempt = 0;
      bool wasWifiConnected = (WiFi.status() == WL_CONNECTED);
      uint8_t heartbeatFailCount = 0;         // berapa kali heartbeat gagal berturut-turut
      bool initialHeartbeatSent = false;      // flag: heartbeat pertama sudah dikirim

      for (;;) {
          // ============================================================
          // 1. PROSES QUEUE: kirim event/heartbeat ke backend
          // ============================================================
          NetworkJob job;
          if (xQueueReceive(networkQueue, &job, pdMS_TO_TICKS(50)) == pdTRUE) {
              if (WiFi.status() == WL_CONNECTED && ESP.getFreeHeap() > 25000) {
                  String url = getApiUrl("boxes/") + getDeviceIdPath() + "/telemetry";
                  WiFiClient client; client.setTimeout(2000);
                  HTTPClient http;
                  http.begin(client, url);
                  http.addHeader("User-Agent", "ESP32-E-LOTO/5.0");
                  http.addHeader("Content-Type", "application/json");
                  http.addHeader("X-Device-Token", device_token);
                  http.setTimeout(3000);

                  DynamicJsonDocument doc(2048);
                  String eventId = String(job.event) + "-" + String(job.uid) + "-" + String(millis()) + "-" + String(random(1000, 9999));
                  doc["event_id"]       = eventId;
                  doc["id_box"]         = getDeviceId(); doc["event"] = String(job.event);
                  doc["last_uid"]       = String(job.uid); doc["uid"] = String(job.uid);
                  doc["is_tap"]         = isTapEventName(String(job.event));
                  doc["is_register_scan"] = String(job.event).indexOf("REGISTER_NEW_CARD") != -1;
                  doc["ip"]             = WiFi.localIP().toString(); doc["ssid"] = WiFi.SSID();
                  // Proteksi mutex: ambil snapshot GPS data agar tidak torn-read
                  double snapLat = 0; double snapLon = 0; bool snapFix = false;
                  if (xSemaphoreTake(gpsMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
                      snapLat = currentLatitude;
                      snapLon = currentLongitude;
                      snapFix = gpsHasFix;
                      xSemaphoreGive(gpsMutex);
                  } else {
                      snapLat = currentLatitude;
                      snapLon = currentLongitude;
                      snapFix = gpsHasFix;
                  }
                  if (snapFix) {
                      doc["lat"] = snapLat;
                      doc["lon"] = snapLon;
                      doc["lng"] = snapLon;
                  } else {
                      doc["lat"] = nullptr;
                      doc["lon"] = nullptr;
                      doc["lng"] = nullptr;
                  }
                  doc["gps_fix"]        = snapFix; doc["state"] = stateToString(currentState);
                  String lcd0; String lcd1;
                  getLcdText(lcd0, lcd1);
                  doc["lcd0"] = lcd0; doc["lcd1"] = lcd1;
                  doc["relay_open"]     = relayOpen; doc["supervisor_uid"] = supervisorUID;
                  doc["active_fuelman"] = activeFuelmanUID; doc["uptime_ms"] = millis(); doc["is_online"] = 1;

                  JsonArray q = doc.createNestedArray("queue");
                  for (int i = 0; i <= safetyQueue.topIndex; i++) {
                      JsonObject o = q.createNestedObject();
                      o["uid"]  = safetyQueue.workers[i].uid; o["name"] = safetyQueue.workers[i].name; o["role"] = safetyQueue.workers[i].role;
                  }
                  String jsonPayload; serializeJson(doc, jsonPayload);
                  int httpCode = http.POST(jsonPayload);
                  http.end();

                  if (httpCode >= 200 && httpCode < 300) {
                      // Heartbeat/event berhasil dikirim
                      heartbeatFailCount = 0;
                  } else {
                      // Gagal kirim — log detail untuk debug
                      Serial.printf("[NET] POST %s → HTTP %d (event=%s)\n", url.c_str(), httpCode, job.event);
                      heartbeatFailCount++;
                      saveOfflineLogToSDCard(String(job.event), String(job.uid));

                      // Jika heartbeat gagal 3x berturut-turut, coba re-discover server
                      if (heartbeatFailCount >= 3 && String(job.event) == "HEARTBEAT_SYNC") {
                          Serial.println("[NET] Heartbeat gagal 3x! Re-discover server...");
                          heartbeatFailCount = 0;
                          if (server_host.length() > 0) {
                              String oldHost = server_host;
                              server_host = "";  // reset supaya discoverServer mau jalan
                              if (!discoverServer()) {
                                  server_host = oldHost;  // fallback ke host lama
                              }
                          } else {
                              discoverServer();
                          }
                      }
                  }
              } else if (WiFi.status() != WL_CONNECTED) {
                  saveOfflineLogToSDCard(String(job.event), String(job.uid));
                  heartbeatFailCount++;
              } else {
                  saveOfflineLogToSDCard(String(job.event), String(job.uid));
              }
          }

          // ============================================================
          // 2. WIFI CHECK: auto-reconnect jika disconnect
          // ============================================================
          if (millis() - lastWifiCheckTask > 10000) {
              lastWifiCheckTask = millis();
              if (WiFi.status() != WL_CONNECTED) {
                  wasWifiConnected = false;
                  // Auto-reconnect dengan multi-WiFi scan tiap 30 detik
                  if (millis() - lastReconnectAttempt > 30000) {
                      lastReconnectAttempt = millis();
                      WiFi.disconnect();
                      delay(100);
                      tryConnectBestWifi();
                      Serial.println("[WIFI] Auto-reconnect attempt (multi-WiFi scan)...");
                  }
              } else if ((!wasWifiConnected || startupSyncPending || millis() - lastDbSyncTask > 120000) && ESP.getFreeHeap() > 30000) {
                  bool justReconnected = !wasWifiConnected;
                  wasWifiConnected = true;
                  lastDbSyncTask = millis();
                  // Re-discover server saat reconnect ke jaringan berbeda
                  if (justReconnected) {
                      discoverServer();
                      Serial.println("[WIFI] Reconnected! IP: " + WiFi.localIP().toString());
                  }
                  Serial.println("[SYNC] Sinkronisasi database ke SD Card...");
                  syncDatabaseToSDCard();
                  uploadOfflineLogsSDCard();
                  startupSyncPending = false;
                  if (justReconnected || !startupSyncPending) {
                      logAuditAsync("HEARTBEAT_SYNC", lastScannedUID);
                      needsRedraw = true;
                  }
                  Serial.printf("[SYNC] Selesai. User ter-cache: %d\n", ramUserCount);
              }
          }

          // ============================================================
          // 3. HEARTBEAT: kirim tiap 30 detik (mulai 10 detik setelah boot)
          //    Initial heartbeat ditunda supaya WiFi & server sudah siap
          // ============================================================
          if (!initialHeartbeatSent) {
              // Tunggu 10 detik pertama supaya WiFi + discoverServer selesai
              if (millis() > 10000) {
                  initialHeartbeatSent = true;
                  lastHeartbeatTask = millis();
                  if (WiFi.status() == WL_CONNECTED) {
                      logAuditAsync("HEARTBEAT_SYNC", lastScannedUID);
                      Serial.println("[NET] Initial heartbeat sent");
                  }
              }
          } else if (millis() - lastHeartbeatTask > 30000) {
              lastHeartbeatTask = millis();
              if (WiFi.status() == WL_CONNECTED) {
                  logAuditAsync("HEARTBEAT_SYNC", lastScannedUID);
              }
          }

          vTaskDelay(pdMS_TO_TICKS(15));
      }
  }

  void logAuditAsync(String event, String uid) {
      NetworkJob job; memset(&job, 0, sizeof(NetworkJob));
      event.toCharArray(job.event, sizeof(job.event)); 
      uid.toCharArray(job.uid, sizeof(job.uid));
      xQueueSend(networkQueue, &job, 0);
      
      AuditEntry &slot = auditRing[auditHead];
      slot.event = event; slot.uid = uid; slot.ok = true; slot.ts = millis();
      slot.lat = gpsHasFix ? currentLatitude : 0; slot.lon = gpsHasFix ? currentLongitude : 0;
      auditHead = (auditHead + 1) % AUDIT_RING_SIZE; auditCount++;
  }

  void processRfidLogic(String uid) {
      uid = normalizeRfidUid(uid);
      lastScannedUID = uid;
      SystemState operationalState = currentState;
      stateBeforeNotification = operationalState;
      
      int workerIdx = findWorkerIndex(uid);
      WorkerInfo card;
      
      if (workerIdx != -1) {
          card = safetyQueue.workers[workerIdx]; 
          card.isRegistered = true;
      } else if (supervisorUID != "" && (supervisorUID.equalsIgnoreCase(uid) || supervisorUID.equalsIgnoreCase(hexToDecStringPadded(uid)) || supervisorUID.equalsIgnoreCase(hexToDecStringUnpadded(uid)))) {
          card.uid = uid;
          card.name = supervisorName;
          card.role = supervisorRole;
          card.sid = lastScannedSID;
          card.isSpv = true;
          card.isRegistered = true;
      } else {
          card = fetchCardDataAPI(uid); 
      }
      
      lastScannedSID = formatSid(card.sid);
      
      if (operationalState == STATE_REGISTER_RFID) {
          if (card.isRegistered) {
              buzzFailed(); logAuditAsync("REGISTER_CARD_ALREADY_EXISTS", uid);
              // Simpan info ke variabel registrasi (LCD tetap tampil)
              regHasCard = true;
              regLastUID = uid;
              regLastSID = card.sid;
              regLastName = card.name;
              regLastRole = card.role;
              regLastStatus = "SUDAH TERDAFTAR!";
              regLastSuccess = false;
          } else {
              buzzSuccess(); logAuditAsync("REGISTER_NEW_CARD", uid);
              // Simpan info ke variabel registrasi (LCD tetap tampil)
              regHasCard = true;
              regLastUID = uid;
              regLastSID = "-----";
              regLastName = "KARTU BARU";
              regLastRole = "MEKANIK";
              regLastStatus = "REGISTRASI OK!";
              regLastSuccess = true;
          }
          forceFullRedraw = true;
          needsRedraw = true;
          return;
      }
      
      // Refueling: FUELMAN bisa tap dari layar manapun (bebas, tanpa tunggu SPV)
      // Pengecekan dilakukan SEBELUM validasi registrasi supaya kartu FUELMAN
      // yang belum terdaftar tetap bisa melakukan refueling
      if (handleFuelmanTap(uid, card)) {
          return;
      }

      if (!card.isRegistered || card.name == "UNKNOWN" || card.name == "Tidak Terdaftar") {
          buzzFailed(); logAuditAsync("SCAN_REJECTED_UNREGISTERED", uid);
          // Offline: tampilkan UID kartu di popup supaya admin bisa catat
          if (WiFi.status() != WL_CONNECTED) {
              displayErrorCardPopup(uid, "OFFLINE - KARTU BELUM DAFTAR", "", "", "", "Hubungkan jaringan, lalu daftar kartu di dashboard");
          } else {
              displayErrorCardPopup(uid, "AKSES DITOLAK", "", "", "", "KARTU TIDAK TERDAFTAR");
          }
          return;
      }

      if (operationalState == STATE_WAIT_SPV_IN || operationalState == STATE_MEKANIK_IN) {
          if (workerIdx != -1) {
              buzzFailed(); logAuditAsync("SCAN_REJECTED_DUPLICATE", uid);
              displayErrorCardPopup(uid, "DUPLIKASI AKSES", card.name, card.role, card.sid, "KARTU SUDAH TERDAFTAR MASUK");
              return;
          }
      }
      
      switch (operationalState) {
          case STATE_WAIT_SPV_IN:
              if (card.isSpv || checkIsSupervisorRole(card.role)) {
                  if (supervisorUID == "") {
                      supervisorUID = uid; supervisorName = card.name; supervisorRole = "PENGAWAS";
                  }
                  pushQueue(uid, card.sid, card.name, "PENGAWAS"); 
                  buzzSuccess(); logAuditAsync("SUPERVISOR_LOCK_IN", uid);
                  selectedFooterAction = 1; 
                  currentState = STATE_SUPERVISOR_VALID;
              } else {
                  buzzFailed(); logAuditAsync("SCAN_REJECTED_NOT_SPV", uid);
                  displayErrorCardPopup(uid, "BUKAN PENGAWAS", card.name, card.role, card.sid, "TEMPELKAN KARTU PENGAWAS");
              }
              break;
          
          case STATE_MEKANIK_IN:
              if (card.isSpv || checkIsSupervisorRole(card.role)) {
                  buzzFailed(); logAuditAsync("SUPERVISOR_REJECT_IN_MEK", uid); 
                  displayErrorCardPopup(uid, "BUKAN MEKANIK", card.name, card.role, card.sid, "TEMPELKAN KARTU MEKANIK");
              } 
              else if (!card.isAssigned) {
                  buzzFailed(); logAuditAsync("SCAN_REJECTED_UNASSIGNED", uid);
                  displayErrorCardPopup(uid, "AKSES DITOLAK", card.name, card.role, card.sid, "TIDAK DITUGASKAN DI UNIT INI");
              } 
              else {
                  pushQueue(uid, card.sid, card.name, "MEKANIK");
                  buzzSuccess(); logAuditAsync("MECHANIC_LOG_IN", uid);
                  
                  if (safetyQueue.topIndex >= targetMekanikCount) {
                      displayCardNotification(uid, card.name, "MEKANIK", "SEMUA MEKANIK VERIFIED", true);
                      selectedFooterAction = 1; 
                      currentState = STATE_ALL_WORKERS_REGISTERED;
                  } else {
                      displayCardNotification(uid, card.name, "MEKANIK", "MEKANIK MASUK", true);
                      currentState = STATE_MEKANIK_IN;
                  }
              }
              break;
              
          case STATE_MEKANIK_OUT:
              if (card.isSpv || checkIsSupervisorRole(card.role)) {
                  buzzFailed(); logAuditAsync("MECHANIC_LOG_OUT_REJECT_SPV", uid);
                  displayErrorCardPopup(uid, "BUKAN MEKANIK", card.name, card.role, card.sid, "TEMPELKAN KARTU MEKANIK");
              } else if (workerIdx == safetyQueue.topIndex && workerIdx > 0) {
                  WorkerInfo leavingUser = safetyQueue.workers[workerIdx];
                  removeQueueAt(workerIdx); 
                  buzzSuccess(); logAuditAsync("MECHANIC_LOG_OUT", uid);
                  
                  if (safetyQueue.topIndex == 0) {
                      currentState = STATE_WAIT_SPV_OUT; 
                      displayCardNotification(uid, leavingUser.name, "MEKANIK", "MEKANIK HABIS", true);
                  } else {
                      displayCardNotification(uid, leavingUser.name, "MEKANIK", "KELUAR BERHASIL", true);
                      currentState = STATE_MEKANIK_OUT;
                  }
              } else if (workerIdx != -1) {
                  buzzFailed(); logAuditAsync("MECHANIC_LOG_OUT_WRONG_STACK_ORDER", uid);
                  displayErrorCardPopup(uid, "SALAH URUTAN", card.name, card.role, card.sid, "BUKAN MEKANIK URUTAN TERAKHIR");
              } else {
                  buzzFailed(); logAuditAsync("MECHANIC_LOG_OUT_NOT_FOUND", uid);
                  displayErrorCardPopup(uid, "TIDAK DITEMUKAN", card.name, card.role, card.sid, "MEKANIK BELUM MASUK UNIT");
              }
              break;
              
          case STATE_WAIT_SPV_OUT:
              if (safetyQueue.topIndex == 0 && (uid.equalsIgnoreCase(supervisorUID) || checkIsSupervisorRole(card.role))) {
                  buzzSuccess();
                  logAuditAsync("SUPERVISOR_LOG_OUT", uid);
                  
                  displayCardNotification(card.uid, card.name, "PENGAWAS", "PENGAWAS KELUAR", true);

                  supervisorUID = card.uid;
                  supervisorName = card.name;
                  supervisorRole = card.role;
                  lastScannedSID = formatSid(card.sid);

                  selectedFooterAction = 1; 
                  currentState = STATE_SPV_OUT_CONFIRM;
              } else {
                  buzzFailed(); logAuditAsync("SUPERVISOR_LOG_OUT_REJECT", uid);
                  displayErrorCardPopup(uid, "BUKAN PENGAWAS", card.name, card.role, card.sid, "TEMPELKAN KARTU PENGAWAS");
              }
              break;
              
          default: 
              buzzFailed(); 
              break;
      }
      saveSessionToSD();
      needsRedraw = true;
  }

  // ============================================================================
  // MULTI-WIFi: SCAN & CONNECT KE JARINGAN YANG AVAILABLE
  // ============================================================================
  bool tryConnectBestWifi() {
      Serial.println("[WIFI] Scanning available networks...");
      int n = WiFi.scanNetworks();
      Serial.printf("[WIFI] Found %d networks\n", n);

      if (n <= 0) {
          Serial.println("[WIFI] No networks found, trying legacy SSID...");
          WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());
          WiFi.scanDelete();
          return true; // let caller wait and check
      }

      // Try known networks first (in order of config)
      for (uint8_t k = 0; k < knownNetworkCount; k++) {
          for (int i = 0; i < n; i++) {
              if (knownNetworks[k].ssid == WiFi.SSID(i)) {
                  Serial.printf("[WIFI] Match found: %s (signal %d dBm) → connecting...\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i));
                  wifi_ssid = knownNetworks[k].ssid;
                  wifi_password = knownNetworks[k].password;
                  WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());
                  WiFi.scanDelete();
                  return true;
              }
          }
      }

      // No known network found → try legacy SSID
      Serial.printf("[WIFI] No known network found, trying legacy: %s\n", wifi_ssid.c_str());
      WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());
      WiFi.scanDelete();
      return true;
  }

  // ============================================================================
  // AUTO-DISCOVER SERVER VIA UDP BROADCAST
  // ============================================================================
  bool discoverServer() {
      if (server_host.length() > 0) {
          Serial.println("[DISCOVER] Server already configured: " + server_host);
          return true;
      }

      Serial.println("[DISCOVER] Searching for E-LOTO server via UDP broadcast...");
      WiFiUDP udp;
      if (!udp.begin(5003)) {
          Serial.println("[DISCOVER] Failed to start UDP");
          return false;
      }

      // Send broadcast
      IPAddress broadcastIP = WiFi.localIP();
      broadcastIP[3] = 255;
      byte pkt[] = { 'E','L','O','T','O','_','D','I','S','C','O','V','E','R' };
      udp.beginPacket(broadcastIP, 5003);
      udp.write(pkt, sizeof(pkt));
      udp.endPacket();
      Serial.printf("[DISCOVER] Broadcast sent to %s:5003\n", broadcastIP.toString().c_str());

      // Wait for reply (3 seconds)
      unsigned long start = millis();
      while (millis() - start < 3000) {
          int cb = udp.parsePacket();
          if (cb > 0) {
              char buf[256];
              int len = udp.read(buf, sizeof(buf) - 1);
              buf[len] = 0;
              String response = String(buf);
              response.trim();
              Serial.println("[DISCOVER] Response: " + response);
              if (response.startsWith("ELOTO_SERVER|")) {
                  server_host = response.substring(13);
                  server_host.trim();
                  Serial.println("[DISCOVER] Server found: " + server_host);
                  udp.stop();
                  return true;
              }
          }
          delay(10);
      }

      udp.stop();
      // Fallback: use gateway IP
      String gw = WiFi.gatewayIP().toString();
      if (gw.length() > 0 && gw != "0.0.0.0") {
          server_host = gw + ":5002";
          Serial.println("[DISCOVER] No server found, fallback to gateway: " + server_host);
          return true;
      }

      Serial.println("[DISCOVER] Server discovery failed");
      return false;
  }

  void connectWiFiRoutine() {
      currentState = STATE_CONNECTING;
      forceFullRedraw = true;
      drawScreen();

      WiFi.mode(WIFI_STA);
      WiFi.disconnect();
      delay(40);

      // Multi-WiFi: scan and connect to best available
      tryConnectBestWifi();

      unsigned long startConn = millis();
      unsigned long lastScreenUpdate = 0;
      bool ipAssigned = false;

      while (millis() - startConn < 10000) {
          server.handleClient();
          feedGPS();

          if (WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0") {
              ipAssigned = true;
              break;
          }

          if (millis() - lastScreenUpdate > 500) {
              lastScreenUpdate = millis();
              needsRedraw = true;
              drawScreen();
          }
          delay(10);
      }

      if (ipAssigned) {
          buzzSuccess();
          // Auto-discover server on this network
          discoverServer();
          selectedFooterAction = 1;
          currentState = STATE_SHOW_IP;
          logAuditAsync("WIFI_CONNECTED", WiFi.localIP().toString());
          Serial.println("[WIFI] ========================================");
          Serial.println("[WIFI] IP ADDRESS: " + WiFi.localIP().toString());
          Serial.println("[WIFI] SSID: " + WiFi.SSID());
          Serial.println("[WIFI] Server: " + (server_host.length() > 0 ? server_host : "(auto-discover)"));
          Serial.println("[WIFI] ========================================");
          startupSyncPending = true;
      } else {
          buzzFailed();
          selectedFooterAction = 1;
          currentState = STATE_SERVER_OFFLINE;
      }
      forceFullRedraw = true;
      needsRedraw = true;
  }

  void executeFooterChoice() {
      if (currentState == STATE_WELCOME) {
          if (selectedFooterAction == 0) {
              // DAFTAR KARTU → Masuk mode registrasi RFID
              buzzSuccess();
              currentState = STATE_REGISTER_RFID;
              regHasCard = false;  // reset registrasi display
              logAuditAsync("ENTER_REGISTER_MODE", "ADMIN");
          } else {
              // LANJUT → Connect WiFi
              connectWiFiRoutine();
          }
      } else if (currentState == STATE_SERVER_OFFLINE) {
          if (selectedFooterAction == 0) {
              connectWiFiRoutine();
          } else {
              // MODE OFFLINE → langsung siap digunakan tanpa server
              buzzSuccess();
              selectedFooterAction = 1;
              digitalWrite(PIN_RELAY, HIGH);
              relayOpen = true;
              saveSessionToSD();
              logAuditAsync("OFFLINE_MODE_START", "---");

              // Bersihkan footer area SEBELUM countdown dimulai supaya tidak ada artefak
              tft.fillRect(0, 270, 480, 50, ELOTO_BG);
              tft.drawFastHLine(0, 270, 480, ELOTO_DARK_RED);

              isSessionActive = true;
              sessionStartTime = millis();

              for (int detik = 10; detik >= 1; detik--) {
                  exitCountdownActive = false;
                  currentState = STATE_COUNTDOWN;
                  notificationMessage = String(detik);
                  needsRedraw = true;
                  drawScreen();
                  countdownBeep(detik);
              }
              digitalWrite(PIN_RELAY, LOW);
              relayOpen = false;
              amanDelay(100);
              clearRfidBuffer();

              isAddingFromMenu = false;
              currentState = STATE_WAIT_SPV_IN;
              startupSyncPending = true;
          }
      } else if (currentState == STATE_SHOW_IP) {
          currentState = (selectedFooterAction == 0) ? STATE_WELCOME : STATE_SYSTEM_READY;
      } else if (currentState == STATE_SYSTEM_READY) {
          if (selectedFooterAction == 0) {
              currentState = (WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0") ? STATE_SHOW_IP : STATE_WELCOME;
          } else {
              buzzSuccess();
              digitalWrite(PIN_RELAY, HIGH);
              relayOpen = true;
              saveSessionToSD();
              logAuditAsync("LOCK_INITIALIZED", "---");

              isSessionActive = true;
              sessionStartTime = millis();

              for (int detik = 10; detik >= 1; detik--) {
                  exitCountdownActive = false;
                  currentState = STATE_COUNTDOWN;
                  notificationMessage = String(detik);
                  needsRedraw = true;
                  drawScreen();
                  countdownBeep(detik);
              }
              digitalWrite(PIN_RELAY, LOW);
              relayOpen = false;
              amanDelay(100);
              clearRfidBuffer();

              isAddingFromMenu = false;
              currentState = STATE_WAIT_SPV_IN;
              // Force sync user data sebelum tapping dimulai
              startupSyncPending = true;
          }
      } else if (currentState == STATE_START_CONFIRM) {
          if (selectedFooterAction == 0) currentState = STATE_IDLE;
          else currentState = STATE_WAIT_SPV_IN;
      } else if (currentState == STATE_SUPERVISOR_VALID) {
          if (selectedFooterAction == 0) {
              if (safetyQueue.topIndex >= 0) removeQueueAt(safetyQueue.topIndex);
              currentState = isAddingFromMenu ? STATE_MENU : STATE_WAIT_SPV_IN;
              isAddingFromMenu = false;
          } else {
              saveSessionToSD();
              if (isAddingFromMenu) {
                  isAddingFromMenu = false;
                  selectedWorkerIndex = 0;
                  currentState = STATE_WORKER_LIST;
              } else {
                  targetMekanikCount = 0;
                  currentState = STATE_SET_MEKANIK_COUNT;
              }
          }
      } else if (currentState == STATE_SET_MEKANIK_COUNT) {
          if (selectedFooterAction == 0) {
              currentState = isAddingFromMenu ? STATE_MENU : STATE_SUPERVISOR_VALID;
              isAddingFromMenu = false;
          } else {
              int8_t mekanikDiDalam = (safetyQueue.topIndex > 0) ? safetyQueue.topIndex : 0;
              if (targetMekanikCount <= mekanikDiDalam) {
                  selectedWorkerIndex = 0;
                  currentState = STATE_WORKER_LIST;
              } else {
                  currentState = STATE_MEKANIK_IN;
                  lastMekanikDisplayCount = -99;
              }
              saveSessionToSD();
              logAuditAsync("SET_MEKANIK_TARGET", String(targetMekanikCount));
          }
      } else if (currentState == STATE_ALL_WORKERS_REGISTERED) {
          if (selectedFooterAction == 0) {
              if (safetyQueue.topIndex > 0) {
                  removeQueueAt(safetyQueue.topIndex);
              }
              currentState = STATE_MEKANIK_IN;
          } else {
              isAddingFromMenu = false;
              selectedWorkerIndex = 0;
              currentState = STATE_WORKER_LIST;
          }
      } else if (currentState == STATE_WORKER_LIST) {
          if (selectedFooterAction == 0) {
              // KEMBALI: kembali ke daftar personel sebelumnya
              currentState = STATE_ALL_WORKERS_REGISTERED;
          } else if (selectedFooterAction == 1) {
              // PILIH: buka detail personel yang dipilih (Gambar 2)
              currentState = STATE_WORKER_DETAIL;
          } else if (selectedFooterAction == 2) {
              // LANJUT: masuk ke pilihan menu LOTO (Gambar 3)
              currentState = STATE_MENU;
          }
      } else if (currentState == STATE_WORKER_DETAIL) {
          if (selectedFooterAction == 0) {
              currentState = STATE_WORKER_LIST;
          } else {
              if (selectedWorkerIndex < safetyQueue.topIndex) {
                  selectedWorkerIndex++;
              } else {
                  currentState = STATE_WORKER_LIST;
              }
          }
      } else if (currentState == STATE_SPV_OUT_CONFIRM) {
          if (selectedFooterAction == 0) {
              currentState = STATE_WAIT_SPV_OUT;
          } else {
              
              digitalWrite(PIN_RELAY, HIGH); 
              relayOpen = true;
              amanDelay(500); 

              exitCountdownActive = true;
              for (int detik = 10; detik >= 1; detik--) {
                  currentState = STATE_COUNTDOWN;
                  notificationMessage = String(detik);
                  needsRedraw = true;
                  drawScreen();
                  countdownBeep(detik);   // sama persis dengan bunyi countdown MASUK
              }
              exitCountdownActive = false;

              digitalWrite(PIN_RELAY, LOW); 
              relayOpen = false; 
              amanDelay(100);

              currentState = STATE_MAINTENANCE_DONE;
              needsRedraw = true;
              drawScreen();
              amanDelay(2000);
              
              supervisorUID = ""; supervisorName = ""; supervisorRole = "";
              lastScannedUID = "---"; lastScannedSID = "-----";
              activeFuelmanUID = ""; activeFuelmanName = "";
              safetyQueue.topIndex = -1; targetMekanikCount = 0; isAddingFromMenu = false;
              clearSessionFromSD();
              
              isSessionActive = false;
              sessionStartTime = 0;
              
              logAuditAsync("SESSION_CLOSED_NORMAL", "SYSTEM");

              currentState = STATE_WELCOME;
          }
      }
      // Hanya full redraw saat STATE BERUBAH — navigasi antar worker di detail view
      // tidak perlu full redraw (mencegah flicker)
      if (currentState != lastRenderedState) {
          forceFullRedraw = true;
      }
      needsRedraw = true;
  }

  void executeSystemAction(uint8_t activeKey, bool isHoldAction) {
      if (activeKey == KEY_NONE) return;
      
      if (isHoldAction) {
          if (currentState == STATE_BOOT_IP || currentState == STATE_IDLE) {
              if (activeKey == KEY_5) {
                  buzzSuccess(); currentState = STATE_REGISTER_RFID;
                  logAuditAsync("ENTER_REGISTER_MODE", "ADMIN");
              } 
              else if (activeKey == KEY_4) {
                  buzzSuccess(); clearSessionFromSD();
                  supervisorUID = ""; supervisorName = ""; supervisorRole = "";
                  activeFuelmanUID = ""; activeFuelmanName = "";
                  safetyQueue.topIndex = -1; targetMekanikCount = 0; currentState = STATE_BOOT_IP;
                  isSessionActive = false; sessionStartTime = 0; 
                  logAuditAsync("HARDWARE_HARD_RESET", "ADMIN");
              }
          }
          else if (currentState == STATE_REGISTER_RFID && activeKey == KEY_5) {
              buzzSuccess(); currentState = STATE_WELCOME;
              regHasCard = false;  // reset registrasi display
              logAuditAsync("EXIT_REGISTER_MODE", "ADMIN");
          }
          forceFullRedraw = true;
          needsRedraw = true; clearRfidBuffer(); return;
      }

      if (currentState == STATE_WELCOME) {
          // Footer choice: DAFTAR KARTU (kiri) / LANJUT (kanan)
          // KEY_4/KEY_1 switch selection, KEY_5 executes - handled by hasFooterChoice below
      }

      if (currentState == STATE_REGISTER_RFID) {
          if (activeKey == KEY_5 || activeKey == KEY_4) {
              buzzTick();
              currentState = STATE_WELCOME;
              regHasCard = false;  // reset registrasi display
              logAuditAsync("EXIT_REGISTER_MODE", "ADMIN");
              forceFullRedraw = true;
              needsRedraw = true;
              return;
          }
      }

      if (currentState == STATE_WAIT_SPV_IN) {
          if (activeKey == KEY_5 || activeKey == KEY_4) {
              buzzTick();
              currentState = isAddingFromMenu ? STATE_MENU : STATE_SYSTEM_READY;
              isAddingFromMenu = false;
              
              if (currentState == STATE_SYSTEM_READY) {
                  isSessionActive = false;
                  sessionStartTime = 0;
              }
              
              forceFullRedraw = true;
              needsRedraw = true;
              return;
          }
      }
      else if (currentState == STATE_MEKANIK_IN) {
          if (activeKey == KEY_5 || activeKey == KEY_4) {
              buzzTick();
              currentState = STATE_SET_MEKANIK_COUNT; 
              forceFullRedraw = true;
              needsRedraw = true;
              return;
          }
      }
      else if (currentState == STATE_MEKANIK_OUT) {
          if (activeKey == KEY_5 || activeKey == KEY_4) {
              buzzTick();
              currentState = STATE_MENU; 
              forceFullRedraw = true;
              needsRedraw = true;
              return;
          }
      }
      else if (currentState == STATE_WAIT_SPV_OUT) {
          if (activeKey == KEY_5 || activeKey == KEY_4) {
              buzzTick();
              currentState = STATE_MENU; 
              forceFullRedraw = true;
              needsRedraw = true;
              return;
          }
      }
      
      if (currentState == STATE_WORKER_LIST) {
          if (activeKey == KEY_3) {
              if (selectedWorkerIndex > 0) {
                  selectedWorkerIndex--; buzzTick(); needsRedraw = true;
              }
              return;
          } else if (activeKey == KEY_2) {
              if (selectedWorkerIndex < safetyQueue.topIndex) {
                  selectedWorkerIndex++; buzzTick(); needsRedraw = true;
              }
              return;
          } else if (activeKey == KEY_4) {
              if (selectedFooterAction > 0) {
                  selectedFooterAction--;
                  buzzTick();
                  drawTftFooterTriple("KEMBALI", "PILIH", "LANJUT");
              }
              return;
          } else if (activeKey == KEY_1) {
              if (selectedFooterAction < 2) {
                  selectedFooterAction++;
                  buzzTick();
                  drawTftFooterTriple("KEMBALI", "PILIH", "LANJUT");
              }
              return;
          } else if (activeKey == KEY_5) {
              buzzTick();
              if (selectedFooterAction == 0) {
                  // KEMBALI: kembali ke daftar sebelumnya
                  currentState = STATE_ALL_WORKERS_REGISTERED;
              } else if (selectedFooterAction == 1) {
                  // PILIH: buka detail personel yang dipilih (Gambar 2)
                  currentState = STATE_WORKER_DETAIL;
              } else if (selectedFooterAction == 2) {
                  // LANJUT: masuk ke pilihan menu LOTO (Gambar 3)
                  currentState = STATE_MENU;
              }
              forceFullRedraw = true;
              needsRedraw = true;
              return;
          }
      }
      
      if (currentState == STATE_WORKER_DETAIL) {
          if (activeKey == KEY_4 || activeKey == KEY_1) {
              uint8_t newAction = (activeKey == KEY_4) ? 0 : 1;
              if (selectedFooterAction != newAction) {
                  selectedFooterAction = newAction;
                  buzzTick();
                  drawTftFooter("KEMBALI", "LANJUT");
              }
              return;
          } else if (activeKey == KEY_5) {
              buzzTick();
              if (selectedFooterAction == 0) {
                  currentState = STATE_WORKER_LIST;
                  forceFullRedraw = true;  // Full redraw hanya saat pindah state
              } else {
                  if (selectedWorkerIndex < safetyQueue.topIndex) {
                      selectedWorkerIndex++;
                      // JANGAN forceFullRedraw — cukup update konten saja (anti-flicker)
                  } else {
                      currentState = STATE_WORKER_LIST;
                      forceFullRedraw = true;  // Full redraw saat pindah ke list
                  }
              }
              needsRedraw = true;
              return;
          }
      }
      
      if (currentState == STATE_MENU) {
          if (activeKey == KEY_3) { 
              if (selectedMenuIndex > 0) {
                  selectedMenuIndex--; buzzTick(); needsRedraw = true;
              }
              return;
          } else if (activeKey == KEY_2) { 
              if (selectedMenuIndex < 2) {
                  selectedMenuIndex++; buzzTick(); needsRedraw = true;
              }
              return;
          } else if (activeKey == KEY_4) { 
              buzzTick(); currentState = STATE_WORKER_LIST; 
              forceFullRedraw = true; needsRedraw = true; return;
          } else if (activeKey == KEY_5) { 
              buzzTick();
              if (selectedMenuIndex == 0) { 
                  initialMekanikOutCount = (safetyQueue.topIndex > 0) ? safetyQueue.topIndex : 0;
                  if (safetyQueue.topIndex > 0) {
                      currentState = STATE_MEKANIK_OUT;
                  } else {
                      currentState = STATE_WAIT_SPV_OUT;
                  }
              } else if (selectedMenuIndex == 1) { 
                  isAddingFromMenu = true;
                  targetMekanikCount = (safetyQueue.topIndex > 0) ? safetyQueue.topIndex : 0;
                  currentState = STATE_SET_MEKANIK_COUNT;
              } else if (selectedMenuIndex == 2) { 
                  isAddingFromMenu = true;
                  currentState = STATE_WAIT_SPV_IN;
              }
              forceFullRedraw = true;
              needsRedraw = true;
              return;
          }
      }
      
      if (hasFooterChoice()) {
          if (currentState == STATE_SET_MEKANIK_COUNT) {
              if (activeKey == KEY_3) { 
                  buzzTick();
                  if (targetMekanikCount < (MAX_WORKERS - 1)) targetMekanikCount++;
                  needsRedraw = true;
                  return;
              } else if (activeKey == KEY_2) { 
                  buzzTick();
                  int8_t minCount = isAddingFromMenu ? ((safetyQueue.topIndex > 0) ? safetyQueue.topIndex : 0) : 0;
                  if (targetMekanikCount > minCount) targetMekanikCount--;
                  needsRedraw = true;
                  return;
              }
          }
          
          if (activeKey == KEY_4 || activeKey == KEY_1) {
              uint8_t newAction = (activeKey == KEY_4) ? 0 : 1;
              if (selectedFooterAction != newAction) {
                  selectedFooterAction = newAction;
                  buzzTick();
                  if (currentState == STATE_WELCOME) {
                      drawTftFooter("DAFTAR KARTU", "LANJUT");
                  } else if (currentState == STATE_BOOT_IP) {
                      drawTftFooter("OFFLINE", "ONLINE");
                  } else if (currentState == STATE_SERVER_OFFLINE) {
                      drawTftFooter("COBA LAGI", "MODE OFFLINE");
                  } else if (currentState == STATE_WORKER_LIST) {
                      drawTftFooterTriple("KEMBALI", "PILIH", "LANJUT");
                  } else {
                      drawTftFooter("KEMBALI", "LANJUT");
                  }
              }
              return;
          }
          
          if (activeKey == KEY_5) {
              buzzTick(); 
              executeFooterChoice();  
              return;
          }
      }
  }

  void drawScreen() {
      digitalWrite(SD_CS_PIN, HIGH);
      bool stateChanged = (currentState != lastRenderedState);
      bool workerIndexChanged = (currentState == STATE_WORKER_DETAIL && selectedWorkerIndex != lastRenderedWorkerIndex);
      
      if (stateChanged || workerIndexChanged || forceFullRedraw) {
          forceFullRedraw = false;
          photoAlreadyDrawn = false;
          // Default footer selection: HANYA saat state BARU BERUBAH (bukan saat redraw biasa)
          // Ini mencegah pilihan user di-reset saat navigasi antar worker
          if (stateChanged) {
              if (currentState == STATE_WELCOME || currentState == STATE_BOOT_IP || currentState == STATE_SERVER_OFFLINE ||
                  currentState == STATE_SYSTEM_READY || currentState == STATE_SUPERVISOR_VALID ||
                  currentState == STATE_ALL_WORKERS_REGISTERED || currentState == STATE_SPV_OUT_CONFIRM ||
                  currentState == STATE_WORKER_LIST) {
                  selectedFooterAction = 1;
              } else {
                  selectedFooterAction = 0;
              }
          }
          
          tft.fillRect(0, 42, 480, 228, TFT_BLACK); 
          drawTftHeader();
          tft.drawRoundRect(8, 49, 464, 212, 6, TFT_DARKGREY);
      }
      
      if (!stateChanged && currentState == STATE_COUNTDOWN) {
          tft.fillRect(185, 130, 110, 60, ELOTO_BG);
      } else if (!stateChanged && currentState == STATE_UNLOCKING) {
          tft.fillRect(185, 120, 110, 60, TFT_BLACK);
      }
      
      tft.setTextDatum(TL_DATUM);
      tft.setTextColor(TFT_WHITE, TFT_BLACK);

      if (currentState == STATE_WELCOME) {
          drawCornerAccents(15, 55, 450, 208, ELOTO_DARK_RED);

          tft.setTextDatum(MC_DATUM);
          setStoryFont(24);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString("E-LOTO", 240, 82);

          drawDecorativeLine(108, ELOTO_DARK_RED);

          setStoryFont(18);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString("SELAMAT DATANG", 240, 130);

          setStoryFont(9);
          tft.setTextColor(ELOTO_DARK_RED, TFT_BLACK);
          tft.drawString("SISTEM LOTO KESELAMATAN KERJA", 240, 165);

          setStoryFont(9);
          tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
          tft.drawString("LOCKOUT / TAGOUT", 240, 195);

          drawDecorativeLine(220, ELOTO_DARK_RED);

          // Footer: DAFTAR KARTU (registrasi) | LANJUT (connect WiFi)
          // NOTE: selectedFooterAction=1 = LANJUT dipilih (default)
          drawTftFooter("DAFTAR KARTU", "LANJUT");
      }
      else if (currentState == STATE_BOOT_IP) {
          drawCornerAccents(15, 55, 450, 208, ELOTO_DARK_RED);

          tft.setTextDatum(MC_DATUM);
          drawGearIcon(240, 150, TFT_LIGHTGREY);

          setStoryFont(18);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString("E-LOTO", 240, 85);

          drawDecorativeLine(105, ELOTO_DARK_RED);

          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString("MEMULAI SISTEM...", 240, 115);

          setStoryFont(9);
          tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
          tft.drawString("Mohon tunggu sebentar", 240, 200);

          drawTftFooter("", "");
      }
      else if (currentState == STATE_CONNECTING) {
          tft.setTextDatum(MC_DATUM);
          drawWifiIcon(105, 156, TFT_LIGHTGREY);
          setStoryFont(12);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString("CONNECTING WIFI", 240, 72);

          drawDecorativeLine(95, ELOTO_DARK_RED);

          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.setTextDatum(TL_DATUM);
          tft.drawString("NAMA WIFI", 215, 115);

          tft.fillRect(215, 130, 250, 40, TFT_BLACK);
          tft.fillRect(215, 195, 250, 25, TFT_BLACK);

          setStoryFont(12);
          if (WiFi.status() == WL_CONNECTED) {
              drawTextFit(WiFi.SSID(), 215, 148, 250, TFT_WHITE, TFT_BLACK, 12);
          } else {
              drawTextFit("MENCARI SINYAL...", 215, 148, 250, TFT_LIGHTGREY, TFT_BLACK, 12);
          }

          setStoryFont(12);
          tft.drawString("STATUS", 215, 185);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);

          String statusTxt = "MEMINDAI...";
          if(WiFi.status() == WL_CONNECTED) {
              statusTxt = (WiFi.localIP().toString() == "0.0.0.0") ? "MENDAPAT IP..." : "TERHUBUNG";
          }
          tft.drawString(statusTxt, 215, 213);
          drawTftFooter("", "");
      } 
      else if (currentState == STATE_SERVER_OFFLINE) {
          drawCornerAccents(15, 55, 450, 208, ELOTO_DARK_RED);

          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(ELOTO_HEADER, TFT_BLACK);
          tft.drawString("JARINGAN TIDAK DITEMUKAN", 240, 75);

          drawDecorativeLine(95, ELOTO_DARK_RED);

          drawWifiIcon(240, 130, TFT_LIGHTGREY);

          setStoryFont(9);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString("WIFI GAGAL TERHUBUNG", 240, 175);
          tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
          tft.drawString("PILIH COBA LAGI ATAU MODE OFFLINE", 240, 210);
          drawTftFooter("COBA LAGI", "MODE OFFLINE");
      }
      else if (currentState == STATE_SHOW_IP) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_GREEN, TFT_BLACK);
          tft.drawString("NETWORK CONNECTED", 240, 82);
          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString("WIFI", 240, 112);
          drawTextFit(WiFi.SSID(), 240, 142, 400, TFT_CYAN, TFT_BLACK, 12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString("IP ADDRESS", 240, 170);
          setStoryFont(18);
          tft.setTextColor(TFT_CYAN, TFT_BLACK);
          tft.drawString(WiFi.localIP().toString(), 240, 210);
          drawDecorativeLine(240, ELOTO_DARK_RED);
          drawTftFooter("KEMBALI", "LANJUT");
      } 
      else if (currentState == STATE_SYSTEM_READY || currentState == STATE_SYSTEM_READY_FINAL) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(18);
          tft.setTextColor(TFT_GREEN, TFT_BLACK);
          tft.drawString("SYSTEM READY", 240, 85);

          drawDecorativeLine(108, ELOTO_DARK_RED);

          tft.setTextDatum(TL_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString("SIAPKAN TALI SLING UNTUK", 20, 130);
          tft.drawString("MENGUNCI", 20, 160);

          setStoryFont(9);
          tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
          tft.setTextDatum(MC_DATUM);
          tft.drawString("Tekan LANJUT untuk memulai", 240, 220);
          drawTftFooter("KEMBALI", "LANJUT");
      } 
      else if (currentState == STATE_COUNTDOWN) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString(exitCountdownActive ? "PENUTUPAN PROSES" : "PERSIAPAN", 240, 72);
          setStoryFont(12);
          if (exitCountdownActive) {
              tft.drawString("CABUT TALI SLING SEKARANG", 240, 105);
              tft.drawString("GEMBOK AKAN MENGUNCI", 240, 132);
          } else {
              tft.drawString("PASANG TALI SLING PADA", 240, 105);
              tft.drawString("LOBANG IN", 240, 132);
          }
          setStoryFont(24);
          tft.setTextColor(TFT_WHITE, ELOTO_BG);
          tft.drawString(notificationMessage, 240, 165);
          setStoryFont(18);
          tft.drawString("DETIK", 240, 218);
          drawTftFooter("", "");
      } 
      else if (currentState == STATE_WAIT_SPV_IN) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString(isAddingFromMenu ? "TAMBAH PENGAWAS" : "TAPPING MASUK", 240, 75);
          drawRfidIcon(240, 145, TFT_WHITE);
          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString("SILAHKAN TAP KARTU PENGAWAS", 240, 215);
          drawTftFooterSingle("KEMBALI");
      } 
      else if (currentState == STATE_SUPERVISOR_VALID) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          tft.drawString("SUPERVISOR VALID", 240, 70);
          tft.fillRect(24, 94, 150, 146, TFT_BLACK);
          tft.drawRect(20, 92, 150, 150, TFT_WHITE);
          
          tft.setTextDatum(TL_DATUM);
          setStoryFont(9);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          drawTextFit(safetyQueue.workers[safetyQueue.topIndex].name, 190, 112, 260, ELOTO_HEADER, ELOTO_BG, 9);
          
          tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
          drawTextFit("SID      : " + formatSid(safetyQueue.workers[safetyQueue.topIndex].sid), 190, 148, 260, ELOTO_TEXT, ELOTO_BG, 9);
          drawTextFit("JABATAN  : PENGAWAS", 190, 180, 260, ELOTO_TEXT, ELOTO_BG, 9);
          drawTftFooter("KEMBALI", "LANJUT");
          if (!photoAlreadyDrawn) {
              if (!drawPhotoFromAPI(safetyQueue.workers[safetyQueue.topIndex].uid, 20, 92, 150, 150)) {
                  tft.setTextDatum(MC_DATUM);
                  setStoryFont(9);
                  tft.drawString("NO FOTO", 95, 166);
              }
              photoAlreadyDrawn = true;
          }
      } 
      else if (currentState == STATE_SET_MEKANIK_COUNT) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString("JUMLAH MEKANIK", 240, 72);
          drawArrowIcon(112, 158, TFT_GREEN, true);
          drawArrowIcon(368, 158, TFT_RED, false);
          
          tft.fillRect(160, 115, 160, 60, TFT_BLACK);
          setStoryFont(24);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString(twoDigits(targetMekanikCount), 240, 145);
          setStoryFont(18);
          tft.drawString("ORANG", 240, 205);
          drawTftFooter("KEMBALI", "LANJUT");
      } 
      else if (currentState == STATE_MEKANIK_IN) {
          int mekanikMasuk = (safetyQueue.topIndex > 0) ? safetyQueue.topIndex : 0;
          int sisaMekanik  = targetMekanikCount - mekanikMasuk;
          if (sisaMekanik < 0) sisaMekanik = 0;
          
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString("TAPPING MASUK", 240, 75);
          drawRfidIcon(240, 145, TFT_WHITE);
          
          tft.fillRect(40, 180, 400, 30, TFT_BLACK);
          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          String waitText = "MENUNGGU " + String(sisaMekanik) + " MEKANIK";
          tft.drawString(waitText, 240, 195);
          
          setStoryFont(9);
          tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
          tft.drawString("SILAHKAN TAP KARTU MEKANIK", 240, 225);
          drawTftFooterSingle("KEMBALI");
      } 
      else if (currentState == STATE_ALL_WORKERS_REGISTERED) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_GREEN, TFT_BLACK);
          tft.drawString("SEMUA MEKANIK MASUK", 240, 72);
          int totalMekanik = (safetyQueue.topIndex > 0) ? safetyQueue.topIndex : 0;
          drawWorkerGroupIcon(240, 140, totalMekanik, TFT_WHITE);
          
          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString("TOTAL: " + String(totalMekanik) + " MEKANIK TERDAFTAR", 240, 198);
          setStoryFont(9);
          tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
          tft.drawString("SIAP MEMULAI PEKERJAAN", 240, 226);
          drawTftFooter("KEMBALI", "LANJUT");
      }
      else if (currentState == STATE_WORKER_LIST) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          int totalPersonel = safetyQueue.topIndex + 1;
          tft.drawString("DAFTAR PERSONAL (" + String(totalPersonel) + ")", 240, 68);
          
          tft.setTextDatum(TL_DATUM);
          // FIX: Scrolling window — tampilkan 5 item sekaligus, geser sesuai posisi cursor
          const int MAX_VISIBLE = 5;
          int startIdx = 0;
          if (selectedWorkerIndex >= MAX_VISIBLE) {
              startIdx = selectedWorkerIndex - MAX_VISIBLE + 1;
          }
          int endIdx = min(startIdx + MAX_VISIBLE - 1, (int)safetyQueue.topIndex);
          
          for (int i = startIdx; i <= endIdx; i++) {
              bool selected = (i == selectedWorkerIndex);
              int displayRow = i - startIdx;  // posisi visual pada layar (0-4)
              int rowY = 96 + displayRow * 27;
              String role = (i == 0) ? "PENGAWAS" : "MEKANIK";
              
              if (selected) {
                  tft.fillRoundRect(14, rowY, 452, 24, 4, ELOTO_HEADER);
              } else {
                  tft.fillRoundRect(14, rowY, 452, 24, 4, ELOTO_BG);
              }
              
              setStoryFont(9);
              uint16_t nameColor = selected ? ELOTO_BG : ELOTO_TEXT;
              uint16_t roleColor = selected ? ELOTO_BG : ELOTO_MUTED;
              uint16_t rowBgColor = selected ? ELOTO_HEADER : ELOTO_BG;
              String prefix = String(i + 1) + ". ";
              drawTextFit(prefix + safetyQueue.workers[i].name, 22, rowY + 4, 290, nameColor, rowBgColor, 9);
              drawTextFit(role, 340, rowY + 4, 115, roleColor, rowBgColor, 9);
          }
          
          const int16_t boxW = 320;
          const int16_t boxH = 26;
          const int16_t boxX = (480 - boxW) / 2;
          const int16_t boxY = 220;
          
          tft.fillRoundRect(boxX, boxY, boxW, boxH, 4, ELOTO_BG);
          tft.drawRoundRect(boxX, boxY, boxW, boxH, 4, ELOTO_DARK_RED);
          
          setStoryFont(9);
          tft.setTextDatum(MC_DATUM);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          tft.drawString("TEKAN PILIH UNTUK BUKA DETAIL", 240, boxY + (boxH / 2));

          drawTftFooterTriple("KEMBALI", "PILIH", "LANJUT");
      } 
      else if (currentState == STATE_WORKER_DETAIL && safetyQueue.topIndex >= 0) {
          int safeIndex = constrain(selectedWorkerIndex, 0, safetyQueue.topIndex);
          WorkerInfo &worker = safetyQueue.workers[safeIndex];
          int totalWorkers = safetyQueue.topIndex + 1;

          // Hanya full redraw saat pertama masuk worker detail (forceFullRedraw atau state baru)
          bool isFirstDraw = (lastRenderedState != STATE_WORKER_DETAIL) || forceFullRedraw;
          if (isFirstDraw) {
              tft.fillRoundRect(14, 54, 452, 204, 6, ELOTO_BG);
              tft.drawRoundRect(14, 54, 452, 204, 6, ELOTO_DARK_RED);
          }

          // Judul + posisi (selalu update kalau indeks berubah)
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          String titleWithPos = "DETAIL PERSONEL (" + String(safeIndex + 1) + " / " + String(totalWorkers) + ")";
          tft.drawString(titleWithPos, 240, 70);

          // Hanya clear area teks (bukan seluruh box) — cegah flicker
          tft.fillRect(20, 88, 270, 150, ELOTO_BG);

          tft.setTextDatum(TL_DATUM);
          setStoryFont(9);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          drawTextFit(worker.name, 26, 110, 260, ELOTO_HEADER, ELOTO_BG, 9);
          tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
          drawTextFit("SID      : " + formatSid(worker.sid), 26, 150, 260, ELOTO_TEXT, ELOTO_BG, 9);
          drawTextFit("JABATAN  : " + worker.role, 26, 186, 260, ELOTO_TEXT, ELOTO_BG, 9);
          drawTftFooter("KEMBALI", "LANJUT");

          // Foto: hanya redraw kalau worker berubah
          if (!photoAlreadyDrawn) {
              tft.fillRect(296, 88, 154, 154, ELOTO_BG);
              tft.drawRect(296, 88, 154, 154, ELOTO_TEXT);
              if (!drawPhotoFromAPI(worker.uid, 296, 88, 154, 154)) {
                  tft.setTextDatum(MC_DATUM);
                  setStoryFont(9);
                  tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
                  tft.drawString("NO FOTO", 373, 165);
              }
              photoAlreadyDrawn = true;
          }
          lastRenderedWorkerIndex = safeIndex;
      } 
      else if (currentState == STATE_MENU) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          tft.drawString("PILIHAN MENU LOTO", 240, 68);
          
          const char *menuItems[] = {
              "1. KELUAR / SELESAI MAINTENANCE",
              "2. TAMBAH MEKANIK",
              "3. TAMBAH PENGAWAS"
          };
          
          tft.setTextDatum(TL_DATUM);
          for (uint8_t i = 0; i < 3; i++) {
              bool selected = (i == selectedMenuIndex);
              int rowY = 96 + i * 32;
              if (selected) {
                  tft.fillRoundRect(14, rowY, 452, 28, 4, ELOTO_HEADER);
              } else {
                  tft.fillRoundRect(14, rowY, 452, 28, 4, ELOTO_BG);
              }
              setStoryFont(9);
              uint16_t textColor = selected ? ELOTO_BG : ELOTO_TEXT;
              uint16_t bgColor   = selected ? ELOTO_HEADER : ELOTO_BG;
              
              tft.setTextColor(textColor, bgColor);
              tft.drawString(menuItems[i], 24, rowY + 6);
          }
          
          const int16_t boxW = 320;
          const int16_t boxH = 26;
          const int16_t boxX = (480 - boxW) / 2;
          const int16_t boxY = 220;
          tft.fillRoundRect(boxX, boxY, boxW, boxH, 4, ELOTO_BG);
          tft.drawRoundRect(boxX, boxY, boxW, boxH, 4, ELOTO_DARK_RED);
          setStoryFont(9);
          tft.setTextDatum(MC_DATUM);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          tft.drawString("TEKAN OK UNTUK MEMILIH", 240, boxY + (boxH / 2));
          drawTftFooterSingle("KEMBALI");
      }
      else if (currentState == STATE_MEKANIK_OUT) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString("TAPPING KELUAR", 240, 75);
          drawRfidIcon(240, 140, TFT_WHITE);
          int currentMekanikCount = (safetyQueue.topIndex > 0) ? safetyQueue.topIndex : 0;
          
          String countText = (currentMekanikCount == initialMekanikOutCount) ? 
                             (String(currentMekanikCount) + " MEKANIK") : 
                             ("SISA: " + String(currentMekanikCount) + " MEKANIK");
                             
          tft.fillRect(40, 180, 400, 30, TFT_BLACK);
          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString(countText, 240, 195);
          
          setStoryFont(9);
          tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
          tft.drawString("SILAHKAN TAP KARTU MEKANIK", 240, 225);
          drawTftFooterSingle("KEMBALI");
      }
      else if (currentState == STATE_WAIT_SPV_OUT) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString("OTORISASI AKHIR PENGAWAS", 240, 75);
          drawRfidIcon(240, 140, TFT_WHITE);
          
          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString("SEMUA MEKANIK KELUAR", 240, 195);
          setStoryFont(9);
          tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
          tft.drawString("SILAHKAN TAP KARTU PENGAWAS", 240, 225);
          drawTftFooterSingle("KEMBALI");
      }
      else if (currentState == STATE_SPV_OUT_CONFIRM) {
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          tft.drawString("SUPERVISOR VALID", 240, 70);
          tft.fillRect(24, 94, 150, 146, TFT_BLACK);
          tft.drawRect(20, 92, 150, 150, TFT_WHITE);
          
          tft.setTextDatum(TL_DATUM);
          setStoryFont(9);
          tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
          drawTextFit(supervisorName, 190, 112, 260, ELOTO_HEADER, ELOTO_BG, 9);
          
          tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
          drawTextFit("SID      : " + formatSid(lastScannedSID), 190, 148, 260, ELOTO_TEXT, ELOTO_BG, 9);
          drawTextFit("JABATAN  : PENGAWAS", 190, 180, 260, ELOTO_TEXT, ELOTO_BG, 9);
          drawTextFit("STATUS   : KONFIRMASI SELESAI", 190, 212, 260, ELOTO_TEXT, ELOTO_BG, 9);
          drawTftFooter("KEMBALI", "LANJUT");

          if (!photoAlreadyDrawn) {
              if (!drawPhotoFromAPI(supervisorUID, 20, 92, 150, 150)) {
                  tft.setTextDatum(MC_DATUM);
                  setStoryFont(9);
                  tft.drawString("NO FOTO", 95, 166);
              }
              photoAlreadyDrawn = true;
          }
      }
      else if (currentState == STATE_MAINTENANCE_DONE) {
          drawCornerAccents(15, 55, 450, 208, ELOTO_DARK_RED);

          tft.setTextDatum(MC_DATUM);
          setStoryFont(18);
          tft.setTextColor(TFT_GREEN, TFT_BLACK);
          tft.drawString("MAINTENANCE SELESAI", 240, 90);

          drawDecorativeLine(115, ELOTO_DARK_RED);

          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString("SEMUA PROSES LOTO SUDAH", 240, 140);
          tft.drawString("BERHASIL DITUTUP", 240, 170);

          setStoryFont(9);
          tft.setTextColor(ELOTO_DARK_RED, TFT_BLACK);
          tft.drawString("UNIT AMAN DIGUNAKAN", 240, 220);
          drawTftFooter("", "");
      }
      else if (currentState == STATE_REGISTER_RFID) {
          drawCornerAccents(15, 55, 450, 208, ELOTO_DARK_RED);

          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString("MODE REGISTRASI KARTU", 240, 75);

          drawDecorativeLine(95, ELOTO_DARK_RED);

          if (regHasCard) {
              // Tampilkan info kartu terakhir yang di-tap (tetap sampai kartu berikutnya)
              tft.fillRect(25, 100, 150, 140, TFT_BLACK);
              tft.drawRect(25, 100, 150, 140, TFT_WHITE);
              if (!drawPhotoFromAPI(regLastUID, 25, 100, 150, 140)) {
                  drawSinglePersonIcon(100, 170, 2.0, ELOTO_HEADER, false);
              }

              tft.setTextDatum(TL_DATUM);
              setStoryFont(9);
              tft.setTextColor(ELOTO_HEADER, TFT_BLACK);
              drawTextFit("STATUS : " + regLastStatus, 190, 108, 260, regLastSuccess ? TFT_GREEN : TFT_RED, TFT_BLACK, 9);

              tft.setTextColor(TFT_WHITE, TFT_BLACK);
              drawTextFit("NAMA   : " + regLastName, 190, 138, 260, TFT_WHITE, TFT_BLACK, 9);
              drawTextFit("ROLE   : " + regLastRole, 190, 160, 260, TFT_WHITE, TFT_BLACK, 9);

              if (regLastSuccess) {
                  drawTextFit("UID    : " + regLastUID, 190, 182, 260, TFT_LIGHTGREY, TFT_BLACK, 9);
                  tft.setTextDatum(MC_DATUM);
                  setStoryFont(9);
                  tft.setTextColor(TFT_GREEN, TFT_BLACK);
                  tft.drawString("TAP KARTU BERIKUTNYA ATAU TEKAN KEMBALI", 240, 230);
              } else {
                  tft.setTextDatum(MC_DATUM);
                  setStoryFont(9);
                  tft.setTextColor(TFT_RED, TFT_BLACK);
                  tft.drawString("KARTU SUDAH TERDAFTAR - TAP LAGI", 240, 230);
              }
          } else {
              // Belum ada kartu di-tap — tampilkan icon RFID
              drawRfidIcon(240, 140, TFT_WHITE);
              setStoryFont(12);
              tft.setTextColor(TFT_WHITE, TFT_BLACK);
              tft.drawString("TAP KARTU RFID BARU", 240, 200);
              drawDecorativeLine(220, ELOTO_DARK_RED);
              setStoryFont(9);
              tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
              tft.drawString("KARTU AKAN MUNCUL DI DASHBOARD", 240, 240);
          }
          drawTftFooterSingle("KEMBALI");
      }
      else {
          String lcd0; String lcd1;
          getLcdText(lcd0, lcd1);
          tft.setTextDatum(MC_DATUM);
          setStoryFont(12);
          tft.setTextColor(TFT_YELLOW, TFT_BLACK);
          tft.drawString(lcd0, 240, 110);
          setStoryFont(12);
          tft.setTextColor(TFT_WHITE, TFT_BLACK);
          tft.drawString(lcd1, 240, 160);
          drawTftFooter("", "");
      }
      lastRenderedState = currentState;
      needsRedraw = false;
  }

  void handleStatus() {
      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      server.sendHeader("Access-Control-Allow-Headers", "*");
      
      DynamicJsonDocument doc(2048);
      String lcd0; String lcd1;
      getLcdText(lcd0, lcd1);
      doc["lcd0"] = lcd0;
      doc["lcd1"] = lcd1;
      doc["id_box"] = getDeviceId(); doc["state"] = stateToString(currentState);
      doc["supervisor_uid"] = supervisorUID; doc["active_fuelman"] = activeFuelmanUID;
      doc["last_uid"] = lastScannedUID; doc["relay_open"] = relayOpen;
      
      if (gpsHasFix) {
          doc["lat"] = currentLatitude;
          doc["lon"] = currentLongitude;
          doc["lng"] = currentLongitude;
      } else {
          doc["lat"] = nullptr;
          doc["lon"] = nullptr;
          doc["lng"] = nullptr;
      }
      
      doc["gps_fix"] = gpsHasFix; doc["wifi_connected"] = (WiFi.status() == WL_CONNECTED);
      doc["gps_bytes"] = gpsByteCount;
      doc["gps_sentences"] = gpsSentenceCount;
      doc["gps_satellites_visible"] = gpsSatellitesInView;
      doc["gps_satellites_used"] = gpsSatellitesUsed;
      doc["gps_hdop"] = gpsHdop;
      doc["gps_last_byte_ms"] = gpsLastByteMillis;
      doc["gps_last_fix_ms"] = gpsLastFixMillis;
      doc["gps_respon_valid"] = gpsSentenceCount;
      doc["uptime_ms"] = millis(); doc["is_online"] = (WiFi.status() == WL_CONNECTED) ? 1 : 0;
      
      JsonArray q = doc.createNestedArray("queue");
      for (int i = 0; i <= safetyQueue.topIndex; i++) {
          JsonObject o = q.createNestedObject();
          o["uid"]  = safetyQueue.workers[i].uid; o["name"] = safetyQueue.workers[i].name; o["role"] = safetyQueue.workers[i].role;
      }
      String json; serializeJson(doc, json); server.send(200, "application/json", json);
  }

  void handleOptions() { 
      server.sendHeader("Access-Control-Allow-Origin", "*"); 
      server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS"); 
      server.send(204); 
  }

  void handleNotFound() { 
      server.sendHeader("Access-Control-Allow-Origin", "*"); 
      server.send(404, "text/plain", "Not found"); 
  }

  void setup() {
      // --- 1. Serial paling awal, supaya semua log kelihatan sejak detik pertama ---
      Serial.begin(115200);
      delay(50);
      Serial.println();
      Serial.println("[ELOTO] Booting...");

      // Initialize random seed for unique event_id generation
      randomSeed(analogRead(0) + micros());

      // --- 2. Siapkan & non-aktifkan (HIGH) SEMUA chip-select di bus SPI ---
      // Khurslabs Shield V4 memiliki 3 perangkat SPI pada jalur yang sama:
      // 1. Layar TFT (CS = GPIO 15)
      // 2. MicroSD Card (CS = GPIO 5)
      // 3. Touch Controller XPT2046 (CS = GPIO 21)
      // Ketiganya WAJIB di-set HIGH agar tidak terjadi tabrakan pada pin MISO (GPIO 19).
      pinMode(TFT_CS_PIN, OUTPUT);
      digitalWrite(TFT_CS_PIN, HIGH);
      pinMode(SD_CS_PIN, OUTPUT);
      digitalWrite(SD_CS_PIN, HIGH);
      pinMode(TOUCH_CS_PIN, OUTPUT);
      digitalWrite(TOUCH_CS_PIN, HIGH);

      // --- 3. SD.begin() di initializeSDCard() mengatur VSPI ESP32 ---
      // Mount pertama memakai 1 MHz pada SCK=18, MISO=19, MOSI=23.
      pinMode(SPI_MISO_PIN, INPUT_PULLUP);
      delay(300);

      sdMutex = xSemaphoreCreateMutex();
      gpsMutex = xSemaphoreCreateMutex();
      networkQueue = xQueueCreate(20, sizeof(NetworkJob));

      // --- 4. Mount SD Card DULUAN sebelum TFT_eSPI menyentuh bus SPI ---
      // Shield ini memakai SCK/MISO/MOSI bersamaan untuk TFT dan MicroSD.
      // Inisialisasi SD Card WAJIB diselesaikan duluan saat TFT dan Touch masih tidur (CS HIGH).
      if (initializeSDCard()) {
          sdCardMounted = true;
          loadUsersToRAM();
          loadConfigFromSD();
      } else {
          sdCardMounted = false;
      }

      // --- 5. Baru inisialisasi Layar TFT setelah SD Card selesai ---
      tft.init();
      tft.setRotation(1);
      tft.setSwapBytes(true);
      tft.fillScreen(TFT_BLACK);

      tft.setTextColor(ELOTO_TEXT);
      tft.setTextDatum(MC_DATUM);
      setStoryFont(12);
      tft.drawString("MEMULAI SISTEM...", 240, 160);

      digitalWrite(TFT_CS_PIN, HIGH);
      digitalWrite(TOUCH_CS_PIN, HIGH);
      digitalWrite(SD_CS_PIN, HIGH);
      delay(50);

      Serial.println("[ELOTO] GPS monitor aktif: UART2 RX=GPIO16 TX=GPIO17 baud=9600");
      
      TJpgDec.setJpgScale(1);
      TJpgDec.setCallback(tft_output);
      gpsSerial.setRxBufferSize(1024);
      gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
      
      // RD6300 / Modul RFID HID dihubungkan ke UART1 (RX=GPIO14, TX=GPIO27)
      rd6300Serial.end();
      delay(100);
      rd6300Serial.begin(9600, SERIAL_8N1, RD6300_RX_PIN, RD6300_TX_PIN);
      delay(500);
      while (rd6300Serial.available()) {
          rd6300Serial.read();
      }
      Serial.printf("[RFID SETUP] Modul RFID UART1 siap di RX=GPIO%d, TX=GPIO%d (Baud: 9600)\n", RD6300_RX_PIN, RD6300_TX_PIN);
      
      pinMode(PIN_RELAY, OUTPUT);
      pinMode(PIN_BUZZER, OUTPUT);
      digitalWrite(PIN_RELAY, LOW);
      digitalWrite(PIN_BUZZER, LOW);
      relayOpen = false;

      // Buzzer startup: bunyi 2x singkat sebagai tanda alat menyala
      digitalWrite(PIN_BUZZER, HIGH); delay(100);
      digitalWrite(PIN_BUZZER, LOW);  delay(80);
      digitalWrite(PIN_BUZZER, HIGH); delay(100);
      digitalWrite(PIN_BUZZER, LOW);
      pinMode(PIN_AD_KEY, INPUT);
      
      WiFi.mode(WIFI_STA); 
      WiFi.disconnect(); 
      server.on("/status", HTTP_GET, handleStatus);
      server.on("/status", HTTP_OPTIONS, handleOptions);
      server.onNotFound(handleNotFound); 
      server.begin();
      
      xTaskCreatePinnedToCore(networkTaskCore0, "NetworkTask", 16384, NULL, 1, NULL, 0);
      logAuditAsync("SYS_INIT", "SYSTEM");
      clearMainScreenArea();
      
      if (sdCardMounted && loadSessionFromSD()) {
          // Session restored - jangan override currentState (sudah benar dari loadSessionFromSD)
          buzzSuccess();
          // Reconnect WiFi di background dengan multi-WiFi scan
          tryConnectBestWifi();
          Serial.println("[RESTORE] Session dipulihkan dari SD card, WiFi reconnect di background...");
      } else {
          currentState = STATE_WELCOME;
      }
      
      forceFullRedraw = true; 
      lastRenderedState = STATE_SYSTEM_ERROR;
      needsRedraw = true;
  }

  void loop() {
      // GPS init dijalankan di background task supaya tidak memblok tampilan
      if (!gpsInitStarted) {
          gpsInitStarted = true;
          xTaskCreatePinnedToCore(gpsInitTask, "GPSInit", 4096, NULL, 1, NULL, 0);
      }

      server.handleClient();
      feedGPS();

      // WiFi auto-reconnect di main loop (safety net)
      static unsigned long lastWifiLoopRetry = 0;
      if (WiFi.status() != WL_CONNECTED && millis() - lastWifiLoopRetry > 60000) {
          lastWifiLoopRetry = millis();
          tryConnectBestWifi();
          Serial.println("[WIFI] Loop reconnect attempt (multi-WiFi scan)...");
      }
      
      // SD Card auto re-check: jika tidak terbaca saat boot, coba lagi tiap 30 detik
      static unsigned long lastSdRecheck = 0;
      if (!sdCardMounted && millis() - lastSdRecheck > 30000) {
          lastSdRecheck = millis();
          Serial.println("[SD] Re-check: mencoba mount SD Card...");
          if (initializeSDCard()) {
              sdCardMounted = true;
              loadUsersToRAM();
              loadConfigFromSD();
              needsRedraw = true;  // Update header indicator
              Serial.println("[SD] Re-check BERHASIL! SD Card terbaca.");
              buzzSuccess();
          }
      }
      
      if (millis() - lastClockUpdateMillis >= 1000) {
          lastClockUpdateMillis = millis();
          updateHeaderClock();
          // Auto-update indicator GPS/SD/WiFi — hanya jika status berubah (mencegah kedip)
          bool wifiNow = WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0";
          bool gpsNow = hasValidGpsFix();
          bool sdNow = sdCardMounted;
          static bool lastGpsState = false;
          static bool lastSdState = false;
          static bool lastWifiState = false;
          if (gpsNow != lastGpsState || sdNow != lastSdState || wifiNow != lastWifiState) {
              lastGpsState = gpsNow; lastSdState = sdNow; lastWifiState = wifiNow;
              tft.fillRoundRect(312, 8, 62, 25, 4, gpsNow ? TFT_GREEN : TFT_YELLOW);
              tft.setTextDatum(MC_DATUM);
              tft.setTextColor(TFT_BLACK, gpsNow ? TFT_GREEN : TFT_YELLOW);
              setStoryFont(9);
              tft.drawString(gpsNow ? "GPS OK" : "GPS --", 343, 21);
              tft.fillRoundRect(378, 8, 62, 25, 4, sdNow ? TFT_GREEN : TFT_RED);
              tft.setTextColor(TFT_BLACK, sdNow ? TFT_GREEN : TFT_RED);
              tft.drawString(sdNow ? "SD OK" : "SD --", 409, 21);
              tft.fillRoundRect(444, 8, 28, 25, 4, wifiNow ? TFT_GREEN : TFT_RED);
              tft.setTextColor(TFT_BLACK, wifiNow ? TFT_GREEN : TFT_RED);
              tft.drawString(wifiNow ? "ON" : "--", 458, 21);
          }
      }
      
      if (needsRedraw) {
          drawScreen();
      }
      
      static uint8_t activeKeyRegistered = KEY_NONE;
      static unsigned long pressStartTimestamp = 0;
      static bool holdActionExecuted = false;
      uint8_t currentDebouncedKey = getDebouncedKey();
      
      if (currentDebouncedKey != KEY_NONE) {
          if (activeKeyRegistered == KEY_NONE) {
              activeKeyRegistered = currentDebouncedKey;
              pressStartTimestamp = millis();
              holdActionExecuted = false;
          } else if (activeKeyRegistered == currentDebouncedKey) {
              if (!holdActionExecuted && (millis() - pressStartTimestamp >= 3000)) {
                  executeSystemAction(activeKeyRegistered, true);
                  holdActionExecuted = true;
              }
          }
      } else {
          if (activeKeyRegistered != KEY_NONE) {
              if (!holdActionExecuted && (millis() - pressStartTimestamp >= 45)) {
                  executeSystemAction(activeKeyRegistered, false);
              }
              activeKeyRegistered = KEY_NONE;
              holdActionExecuted = false;
          }
      }
      
      bool rfidInputEnabled = (
          currentState == STATE_REGISTER_RFID ||
          currentState == STATE_WELCOME ||
          currentState == STATE_SYSTEM_READY ||
          currentState == STATE_SERVER_OFFLINE ||
          currentState == STATE_WAIT_SPV_IN ||
          currentState == STATE_WAIT_SPV_OUT ||
          currentState == STATE_MEKANIK_IN ||
          currentState == STATE_MEKANIK_OUT ||
          currentState == STATE_WORKER_LIST ||
          currentState == STATE_WORKER_DETAIL ||
          (isSessionActive && currentState != STATE_COUNTDOWN &&
           currentState != STATE_MAINTENANCE_DONE &&
           currentState != STATE_SPV_OUT_CONFIRM)
      );

      String authUID = checkRfidSensor();
      if (authUID != "") {
          if (!rfidInputEnabled) {
              Serial.printf("[RFID IGNORED] Kartu UID=%s terdeteksi, namun state '%s' tidak menerima tapping saat ini!\n", 
                            authUID.c_str(), stateToString(currentState).c_str());
              clearRfidBuffer();
          } else {
              Serial.printf("[RFID TAP] KARTU TERDETEKSI: %s | State: %s\n", authUID.c_str(), stateToString(currentState).c_str());
              if (authUID == lastScannedRfidUID && (millis() - lastScannedRfidTime < 1500)) {
                  Serial.printf("[RFID COOLDOWN] UID=%s diabaikan (anti double-tap < 1500ms)\n", authUID.c_str());
                  clearRfidBuffer();
                  return;
              }

              lastScannedRfidUID = authUID;

              digitalWrite(PIN_BUZZER, HIGH);
              delay(50);
              digitalWrite(PIN_BUZZER, LOW);

              processRfidLogic(authUID);

              lastScannedRfidTime = millis();
              lastScanTime = millis();
          }
      }
  }

  void getLcdText(String &lcd0, String &lcd1) {
      lcd0 = "SISTEM READY";
      lcd1 = "TEKAN 1 UTK MULAI";

      if (currentState == STATE_WELCOME) {
          lcd0 = "SELAMAT DATANG";
          lcd1 = "PILIH DAFTAR ATAU LANJUT";
      } else if (currentState == STATE_BOOT_IP) {
          lcd0 = "E-LOTO";
          lcd1 = "MEMULAI SISTEM...";
      } else if (currentState == STATE_SYSTEM_READY || currentState == STATE_SYSTEM_READY_FINAL) {
          lcd0 = "SYSTEM READY";
          lcd1 = "SIAPKAN TALI SLING";
      } else if (currentState == STATE_COUNTDOWN && exitCountdownActive) {
          lcd0 = "PENUTUPAN PROSES";
          lcd1 = "KEMBALI STANDBY";
      } else if (currentState == STATE_CONNECTING) {
          lcd0 = "CONNECTING WIFI";
          lcd1 = WiFi.status() == WL_CONNECTED ? "TERHUBUNG" : "MENCARI SINYAL...";
      } else if (currentState == STATE_SERVER_OFFLINE) {
          lcd0 = "JARINGAN TIDAK DITEMUKAN";
          lcd1 = "WIFI GAGAL TERHUBUNG";
      } else if (currentState == STATE_SHOW_IP) {
          lcd0 = "IP ADDRESS";
          lcd1 = WiFi.localIP().toString();
      } else if (currentState == STATE_WAIT_SPV_IN) {
          lcd0 = "TAPPING MASUK";
          lcd1 = "TAP KARTU PENGAWAS";
      } else if (currentState == STATE_MEKANIK_IN) {
          lcd0 = "TAPPING MASUK";
          lcd1 = "TAP KARTU MEKANIK";
      } else if (currentState == STATE_WAIT_SPV_OUT) {
          lcd0 = "OTORISASI AKHIR";
          lcd1 = "TAP KARTU PENGAWAS";
      } else if (currentState == STATE_MAINTENANCE_DONE) {
          lcd0 = "MAINTENANCE SELESAI";
          lcd1 = "UNIT AMAN DIGUNAKAN";
      } else if (currentState == STATE_SUPERVISOR_VALID) {
          lcd0 = "SUPERVISOR VALID";
          lcd1 = "LANJUTKAN PROSES";
      } else if (currentState == STATE_SET_MEKANIK_COUNT) {
          lcd0 = "JUMLAH MEKANIK";
          lcd1 = String(targetMekanikCount) + " ORANG";
      } else if (currentState == STATE_ALL_WORKERS_REGISTERED) {
          lcd0 = "SEMUA MEKANIK MASUK";
          lcd1 = "SIAP MEMULAI PEKERJAAN";
      } else if (currentState == STATE_WORKER_LIST) {
          lcd0 = "DAFTAR PERSONAL";
          lcd1 = "PILIH ATAU LANJUT";
      } else if (currentState == STATE_WORKER_DETAIL) {
          lcd0 = "DETAIL PERSONEL";
          lcd1 = "TEKAN OK UNTUK LANJUT";
      } else if (currentState == STATE_MENU) {
          lcd0 = "PILIHAN MENU LOTO";
          lcd1 = "TEKAN OK UNTUK MEMILIH";
      } else if (currentState == STATE_MEKANIK_OUT) {
          lcd0 = "TAPPING KELUAR";
          lcd1 = "SILAHKAN TAP KARTU MEKANIK";
      } else if (currentState == STATE_SPV_OUT_CONFIRM) {
          lcd0 = "SUPERVISOR VALID";
          lcd1 = "KONFIRMASI SELESAI";
      } else if (currentState == STATE_REGISTER_RFID) {
          lcd0 = "MODE REGISTRASI";
          lcd1 = "TAP KARTU RFID";
      } else if (currentState == STATE_UNLOCKING) {
          lcd0 = "MEMBUKA GEMBOK...";
          lcd1 = "LEPASKAN TALI SLING LOTO";
      }
  }
