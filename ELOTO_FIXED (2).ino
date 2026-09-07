#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#include <WiFi.h>
#include <WiFiClientSecure.h> 
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPS++.h>
#include <SPI.h>
#include <SD.h>
#include <LittleFS.h>
#include <TFT_eSPI.h>
#include <TJpg_Decoder.h>

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
#define RD6300_RX_PIN   4       
#define RD6300_TX_PIN   2       
#define PIN_GPS_RX      16      
#define PIN_GPS_TX      17      
#define PIN_AD_KEY      34      
#define SD_CS_PIN       5       
#define TFT_CS_PIN      15      
#define DEVICE_ID       "BOX ELOTO 1"

// ============================================================================
// KONFIGURASI JARINGAN & SERVER (DIBACA DARI SD CARD NANTINYA)
// ============================================================================
String wifi_ssid        = "vivoV29";
String wifi_password    = "112233445566";
String server_host      = "192.168.137.1:5002";
const char* SERVER_PROJECT_PATH  = "";

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
    String configuredId = DEVICE_ID;
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
    STATE_LOGOUT_SUCCESS, STATE_ALL_WORKERS_OUT, STATE_UNLOCKING, STATE_SYSTEM_READY_FINAL
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
    char event[32];
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
double currentLatitude    = 0;
double currentLongitude   = 0;
bool gpsHasFix            = false;
bool firstGpsFixSent      = false;
bool relayOpen            = false;
bool sdCardMounted        = false;
bool exitCountdownActive  = false;

bool hasValidGpsFix() {
    return gpsHasFix && currentLatitude >= -90.0 && currentLatitude <= 90.0 &&
           currentLongitude >= -180.0 && currentLongitude <= 180.0 &&
           (currentLatitude != 0.0 || currentLongitude != 0.0);
}

QueueHandle_t networkQueue;
SemaphoreHandle_t sdMutex = NULL;

TFT_eSPI tft = TFT_eSPI();

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
HardwareSerial rd6300Serial(1);
WebServer server(80);

SystemState currentState = STATE_BOOT_IP;
LotoQueue safetyQueue;
String supervisorUID = ""; String supervisorName = ""; String supervisorRole = "";
String lastScannedSID = "-----";
String lastScannedUID = "—";
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

String rd6300Buffer = "";
unsigned long bootIpTimer = 0;
unsigned long lastScanTime = 0; 
unsigned long lastClockUpdateMillis = 0;
unsigned long gpsLastByteMillis = 0;
unsigned long gpsLastFixMillis = 0;
uint32_t gpsByteCount = 0;
uint32_t gpsSentenceCount = 0;
unsigned long gpsLastSerialReportMillis = 0;
double gpsLastSerialLatitude = 0;
double gpsLastSerialLongitude = 0;

// Variabel Global Anti Phantom Double-Tap
String lastScannedRfidUID = "";
unsigned long lastScannedRfidTime = 0;

// ============================================================================
// PROTOTIPE FUNGSI FULL (AGAR COMPILER TIDAK ERROR)
// ============================================================================
void processRfidLogic(String uid);
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
void updateHeaderClock();
void executeSystemAction(uint8_t activeKey, bool isHoldAction);
void drawSinglePersonIcon(int16_t x, int16_t y, float scale, uint16_t color, bool withOutline = false, uint16_t outlineColor = TFT_BLACK);
void drawWorkerGroupIcon(int16_t cx, int16_t cy, uint8_t count, uint16_t color);
void buzzSuccess();
void buzzFailed();
void buzzTick();
void connectWiFiRoutine();
WorkerInfo fetchCardDataAPI(String uid);
uint8_t readADKeypadRaw();
void getLcdText(String &lcd0, String &lcd1);
void sanitizeQueueDeadlock();
void displayCardNotification(String uid, String name, String role, String statusMsg, bool isSuccess);
void displayErrorCardPopup(String uid, String title, String name, String role, String sid, String bottomHint);
bool drawPhotoFromAPI(String uid, int32_t boxX, int32_t boxY, uint16_t boxW, uint16_t boxH);
void resetPhotoPrecache();
void precacheNextWorkerPhoto();
void amanDelay(uint32_t ms);
void clearMainScreenArea();
void executeFooterChoice();

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
                if (line.startsWith("SSID=")) wifi_ssid = line.substring(5);
                else if (line.startsWith("PASS=")) wifi_password = line.substring(5);
                else if (line.startsWith("SERVER=")) server_host = line.substring(7);
            }
            configFile.close();
            Serial.println("[CONFIG] Berhasil memuat konfigurasi dari SD Card.");
        }
    } else {
        File configFile = SD.open("/config.txt", FILE_WRITE);
        if (configFile) {
            configFile.println("SSID=" + wifi_ssid);
            configFile.println("PASS=" + wifi_password);
            configFile.println("SERVER=" + server_host);
            configFile.close();
            Serial.println("[CONFIG] File config.txt baru dibuat di SD Card.");
        }
    }
}

// ============================================================================
// INISIALISASI MICROSD AMAN
// ============================================================================
// PERBAIKAN:
// - Selalu non-aktifkan TFT_CS sebelum & sesudah setiap percobaan, supaya TFT
//   benar-benar lepas dari bus SPI saat SD dicoba dibaca (anti "tabrakan").
// - SD.end() dipanggil sebelum setiap percobaan ulang, supaya driver SD
//   benar-benar reset (percobaan sebelumnya yang gagal bisa meninggalkan
//   state SPI yang setengah jalan dan bikin percobaan berikutnya ikut gagal).
// - Ditambah 1 tingkat kecepatan lagi (100 kHz) untuk kartu yang lambat naik.
// - Ditambah log ke Serial supaya kelihatan persis di tahap mana gagalnya.
// - Bug lama: SD.rmdir() dipanggil ke "/user.csv" padahal itu FILE bukan
//   folder (rmdir tidak akan pernah berhasil menghapus file) -> diganti
//   SD.remove().
bool initializeSDCard() {
    const uint32_t speedTiers[] = { 400000, 200000, 100000 };
    bool terhubung = false;

    for (uint8_t attempt = 0; attempt < 3 && !terhubung; attempt++) {
        // Lepaskan dulu koneksi SD sebelumnya (kalau ada) supaya bus benar-benar bersih
        SD.end();

        // Pastikan TFT benar-benar "diam" (CS HIGH = tidak aktif) sebelum SD dipakai
        digitalWrite(TFT_CS_PIN, HIGH);
        digitalWrite(SD_CS_PIN, HIGH);
        delay(20);

        Serial.printf("[SD] Percobaan #%d, kecepatan %lu Hz...\n", attempt + 1, (unsigned long)speedTiers[attempt]);

        if (SD.begin(SD_CS_PIN, SPI, speedTiers[attempt])) {
            terhubung = true;
            Serial.println("[SD] SD.begin() BERHASIL.");
        } else {
            Serial.println("[SD] SD.begin() gagal, coba lagi...");
            digitalWrite(SD_CS_PIN, HIGH);
            delay(100);
        }
    }

    if (!terhubung) {
        Serial.println("[SD] GAGAL total setelah 3 percobaan. Cek: kartu terpasang benar, sudah diformat FAT32, dan kabel/pin CS/SCK/MISO/MOSI tidak longgar.");
        digitalWrite(SD_CS_PIN, HIGH);
        return false;
    }

    // Info kartu untuk verifikasi lewat Serial Monitor
    uint8_t cardType = SD.cardType();
    if (cardType == CARD_NONE) {
        Serial.println("[SD] Terhubung tapi tidak ada kartu terdeteksi (CARD_NONE). Cek kartu/slot.");
        digitalWrite(SD_CS_PIN, HIGH);
        return false;
    }
    uint64_t cardSizeMB = SD.cardSize() / (1024 * 1024);
    Serial.printf("[SD] Tipe kartu: %s, ukuran: %llu MB\n",
        cardType == CARD_MMC ? "MMC" : cardType == CARD_SD ? "SDSC" : cardType == CARD_SDHC ? "SDHC" : "UNKNOWN",
        (unsigned long long)cardSizeMB);

    if (SD.exists("/user.csv")) SD.remove("/user.csv");
    if (SD.exists("/users.csv.txt")) SD.remove("/users.csv.txt");
    if (!SD.exists("/foto")) SD.mkdir("/foto");

    if (!SD.exists("/users.csv")) {
        File initFile = SD.open("/users.csv", FILE_WRITE);
        if (initFile) {
            initFile.println("9D88FA1200,Budi Santoso,PENGAWAS,1");
            initFile.println("1A2B3C4D5E,Agus Prayitno,MEKANIK,0");
            initFile.close();
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
    return currentState == STATE_BOOT_IP || currentState == STATE_SHOW_IP || 
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
    while (millis() - startMillis < ms) {
        server.handleClient();
        feedGPS();
        
        if (millis() - lastClockUpdateMillis >= 1000) {
            lastClockUpdateMillis = millis();
            updateHeaderClock();
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
        WiFiClient client; client.setTimeout(600); 
        HTTPClient http;
        String url = getApiUrl("users/photo/") + uid + "?size=" + String(PHOTO_DISPLAY_SIZE) + "&quality=82";
        http.begin(client, url);
        http.addHeader("Accept", "image/jpeg");
        http.setTimeout(1000); 
        
        int httpCode = http.GET();
        if (httpCode == HTTP_CODE_OK) {
            String jpeg = http.getString(); 
            if (jpeg.length() > 100 && (uint8_t)jpeg[0] == 0xFF && (uint8_t)jpeg[1] == 0xD8) {
                jpegSize = jpeg.length();
                jpegData = static_cast<uint8_t *>(malloc(jpegSize));
                if (jpegData != NULL) {
                    memcpy(jpegData, jpeg.c_str(), jpegSize);
                    
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
                }
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
                if (jpegSize > 100 && jpegSize < 100000) {
                    jpegData = static_cast<uint8_t *>(malloc(jpegSize));
                    if (jpegData != NULL) {
                        f.read(jpegData, jpegSize);
                    }
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

void feedGPS() {
    while (gpsSerial.available() > 0) {
        char c = gpsSerial.read();
        gpsLastByteMillis = millis();
        gpsByteCount++;
        if (gps.encode(c)) {
            gpsSentenceCount++;
            if (gps.location.isValid()) {
                currentLatitude  = gps.location.lat();
                currentLongitude = gps.location.lng();
                gpsHasFix        = true;
                gpsLastFixMillis  = millis();
                bool positionChanged = fabs(currentLatitude - gpsLastSerialLatitude) > 0.00001 ||
                                       fabs(currentLongitude - gpsLastSerialLongitude) > 0.00001;
                
                if (positionChanged || millis() - gpsLastSerialReportMillis >= 5000) {
                    Serial.printf("[GPS] FIX lat=%.6f lon=%.6f sats=%lu hdop=%.2f age=%lu ms\n",
                                  currentLatitude,
                                  currentLongitude,
                                  gps.satellites.isValid() ? gps.satellites.value() : 0UL,
                                  gps.hdop.isValid() ? gps.hdop.hdop() : 0.0,
                                  gps.location.age());
                    gpsLastSerialLatitude = currentLatitude;
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
    }
    
    if (gps.location.age() > 30000) {
        if (gpsHasFix) needsRedraw = true;
        gpsHasFix = false;
        if (gps.location.age() > 60000) {
            firstGpsFixSent = false;
        }
    }
}

void clearRfidBuffer() {
    while (rd6300Serial.available() > 0) rd6300Serial.read();
    rd6300Buffer = "";
}

String checkRfidSensor() {
    while (rd6300Serial.available() > 0) {
        char c = rd6300Serial.read();
        rd6300Buffer += c;
    }
    
    if (rd6300Buffer.length() > 64) {
        rd6300Buffer = rd6300Buffer.substring(rd6300Buffer.length() - 30);
    }
    int stxPos = rd6300Buffer.indexOf((char)0x02);
    if (stxPos >= 0) {
        int etxPos = rd6300Buffer.indexOf((char)0x03, stxPos + 1);
        if (etxPos > stxPos) {
            String frame = rd6300Buffer.substring(stxPos + 1, etxPos);
            rd6300Buffer = rd6300Buffer.substring(etxPos + 1); 
            
            frame.trim();
            if (frame.length() == 12) {
                String cardUid = frame.substring(0, 10);
                return cardUid;
            }
        }
    } else {
        if (rd6300Buffer.length() > 20) rd6300Buffer = "";
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

void clearMainScreenArea() {
    tft.fillRect(0, 42, 480, 228, ELOTO_BG); 
    tft.drawRoundRect(8, 49, 464, 212, 6, TFT_DARKGREY); 
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
    drawTextFit("SID      : " + formatSid(lastScannedSID), 190, 142, 260, ELOTO_TEXT, ELOTO_BG, 9);
    drawTextFit("JABATAN  : " + role, 190, 174, 260, ELOTO_TEXT, ELOTO_BG, 9);
    
    tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
    tft.drawString("BERHASIL TERVERIFIKASI", 190, 206);
    drawTftFooter("", "");
    
    uint32_t displayDuration = isSuccess ? NOTIFICATION_SUCCESS_DURATION : NOTIFICATION_ERROR_DURATION;
    unsigned long startNotify = millis();
    while (millis() - startNotify < displayDuration) {
        server.handleClient();
        feedGPS();
        if (millis() - startNotify > 200 && readADKeypadRaw() != KEY_NONE) break; 
        delay(5);
    }
    
    clearMainScreenArea();
    clearRfidBuffer();
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
        setStoryFont(24);
        tft.setTextDatum(MC_DATUM);
        tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
        tft.drawString("[ X ]", 240, 130);
        
        setStoryFont(9);
        tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
        tft.drawString(bottomHint, 240, 190);
    }
    
    drawTftFooter("", "");
    unsigned long startNotify = millis();
    while (millis() - startNotify < NOTIFICATION_ERROR_DURATION) {
        server.handleClient();
        feedGPS();
        if (millis() - startNotify > 200 && readADKeypadRaw() != KEY_NONE) break; 
        delay(5);
    }
    
    clearMainScreenArea();
    clearRfidBuffer();
    lastRenderedState = STATE_SYSTEM_ERROR;
    needsRedraw = true;
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
                    if (stateInt < STATE_BOOT_IP || stateInt > STATE_SYSTEM_READY_FINAL) stateInt = STATE_IDLE;
                    currentState = (SystemState)stateInt;
                    
                    supervisorUID      = doc["spv_uid"].as<String>();
                    String savedSupervisorSid = doc["spv_sid"] | "-----";
                    supervisorName     = doc["spv_name"].as<String>();
                    supervisorRole     = doc["spv_role"].as<String>();
                    targetMekanikCount = doc["target_count"] | 0;
                    safetyQueue.topIndex = doc["top_index"] | -1;
                    
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
                    
                    if (stateInt >= STATE_WAIT_SPV_IN && stateInt <= STATE_ALL_WORKERS_OUT) {
                        isSessionActive = true;
                        sessionStartTime = millis(); 
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
                        int p1 = line.indexOf(',');
                        int p2 = line.indexOf(',', p1 + 1);
                        int p3 = line.indexOf(',', p2 + 1);
                        
                        if (p1 != -1 && p2 != -1 && p3 != -1) {
                            ramUserCache[ramUserCount].uid  = line.substring(0, p1);
                            ramUserCache[ramUserCount].name = line.substring(p1 + 1, p2);
                            ramUserCache[ramUserCount].role = line.substring(p2 + 1, p3);
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
    resetPhotoPrecache(); // daftar pekerja berubah -> mulai lagi putaran cek foto (yang sudah ada tetap dilewati, bukan didownload ulang)
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
    
    WiFiClient client; client.setTimeout(2500);
    HTTPClient http;
    http.begin(client, getApiUrl("users"));
    http.addHeader("User-Agent", "ESP32-E-LOTO/5.0");
    http.setTimeout(3500);
    
    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
        String jsonStr = http.getString();
        DynamicJsonDocument doc(6144);
        DeserializationError err = deserializeJson(doc, jsonStr);
        JsonArray arr = !err && doc["data"].is<JsonArray>() ? doc["data"].as<JsonArray>() : JsonArray();
        
        if (!err && !arr.isNull()) {
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
                            userFile.println(uid + "," + name + "," + role + "," + String(isSpv ? 1 : 0));
                        }
                    }
                    userFile.close();
                }
                digitalWrite(SD_CS_PIN, HIGH);
                xSemaphoreGive(sdMutex);
            }
            loadUsersToRAM();
        }
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
    
    for (int i = 0; i < ramUserCount; i++) {
        if (ramUserCache[i].uid.equalsIgnoreCase(cleanUID) || 
            ramUserCache[i].uid.equalsIgnoreCase(decPadded) || 
            ramUserCache[i].uid.equalsIgnoreCase(decUnpadded)) {
            card = ramUserCache[i];
            card.uid = cleanUID;
            card.isSpv = checkIsSupervisorRole(card.role);
            return card; 
        }
    }
    
    if (sdCardMounted) {
        card = searchUserFromSDCard(cleanUID);
        if (!card.isRegistered) card = searchUserFromSDCard(decPadded);
        if (!card.isRegistered) card = searchUserFromSDCard(decUnpadded);
        if (card.isRegistered) return card;
    }
    
    if (WiFi.status() == WL_CONNECTED && ESP.getFreeHeap() > 30000) {
        WiFiClient client; client.setTimeout(600); 
        HTTPClient http;
        String url = getApiUrl("users/check-card");
        http.begin(client, url);
        http.addHeader("Content-Type", "application/json");
        http.setTimeout(800);
        DynamicJsonDocument requestDoc(256);
        requestDoc["rfid_uid"] = cleanUID;
        String requestBody;
        serializeJson(requestDoc, requestBody);
        
        int httpCode = http.POST(requestBody);
        if (httpCode == HTTP_CODE_OK) {
            String responseStr = http.getString();
            DynamicJsonDocument doc(512);
            if (!deserializeJson(doc, responseStr)) {
                JsonObject userData = doc["data"].as<JsonObject>();
                String status = (doc["success"] | false) ? "success" : "";
                String apiName = userData["nama"] | "UNKNOWN";
                String apiRole = normalizeUserRole(userData["role"] | "MEKANIK");
                apiName.trim();
                
                bool knownName = apiName.length() > 0 &&
                                 !apiName.equalsIgnoreCase("UNKNOWN") &&
                                 !apiName.equalsIgnoreCase("NOT_FOUND") &&
                                 !apiName.equalsIgnoreCase("TIDAK TERDAFTAR");
                                 
                if (knownName && (status.equalsIgnoreCase("success") || knownName)) {
                    card.uid = cleanUID;
                    card.sid = formatSid(userData["sid"] | "");
                    card.name = apiName;
                    card.role = apiRole;
                    card.isSpv = checkIsSupervisorRole(apiRole);
                    card.isRegistered = true;
                    card.isAssigned = true;
                }
            }
        }
        http.end();
    }
    return card;
}

// ============================================================================
// PRE-CACHE FOTO SEMUA PEKERJA SAAT ONLINE (ANTI DUPLIKAT, JALAN PELAN-PELAN)
// ============================================================================
// Tujuan: begitu device online, foto SEMUA pekerja terdaftar (di /users.csv)
// otomatis diunduh & disimpan ke /foto/{UID}.jpg di background - supaya nanti
// pas device offline, foto siapa pun yang tap tetap muncul, bukan cuma orang
// yang kebetulan pernah tap saat online.
//
// Aturan anti-duplikat: SEBELUM download, selalu dicek dulu apakah file foto
// itu SUDAH ADA di SD. Kalau sudah ada -> dilewati, TIDAK didownload ulang.
// Dicek lagi sekali lagi tepat sebelum ditulis (double-check) untuk jaga-jaga
// race condition kalau foto yang sama sempat kesimpan lewat jalur lain
// (misalnya orang itu keburu tap manual) di saat yang hampir bersamaan.
int precacheIndex = 0;
unsigned long lastPrecacheAttemptMs = 0;

void resetPhotoPrecache() {
    precacheIndex = 0;
}

// Panggil fungsi ini berkala (sekali per putaran networkTaskCore0). Fungsi ini
// sendiri yang mengatur jeda antar percobaan, jadi aman dipanggil sesering apa
// pun tanpa membanjiri server atau mengunci bus SD lama-lama.
void precacheNextWorkerPhoto() {
    if (!sdCardMounted || sdMutex == NULL) return;
    if (WiFi.status() != WL_CONNECTED) return;
    if (ramUserCount <= 0) return;
    if (precacheIndex >= ramUserCount) return; // satu putaran penuh sudah selesai

    // Jeda antar percobaan supaya tidak menembak banyak request beruntun ke server
    if (millis() - lastPrecacheAttemptMs < 2000) return;
    lastPrecacheAttemptMs = millis();

    String uid = ramUserCache[precacheIndex].uid;
    uid.trim(); uid.toUpperCase();
    precacheIndex++; // giliran berikutnya lanjut ke index selanjutnya

    if (uid == "") return;
    String photoPath = "/foto/" + uid + ".jpg";

    // 1) Cek dulu, sudah ada belum di SD?
    bool alreadyCached = false;
    if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(150)) == pdTRUE) {
        digitalWrite(TFT_CS_PIN, HIGH);
        alreadyCached = SD.exists(photoPath);
        digitalWrite(SD_CS_PIN, HIGH);
        xSemaphoreGive(sdMutex);
    }
    if (alreadyCached) return; // SUDAH ADA -> lewati, anti duplikat

    if (ESP.getFreeHeap() < 40000) return; // jaga-jaga heap sempit

    // 2) Belum ada -> download dari server
    WiFiClient client; client.setTimeout(600);
    HTTPClient http;
    String url = getApiUrl("users/photo/") + uid + "?size=" + String(PHOTO_DISPLAY_SIZE) + "&quality=82";
    http.begin(client, url);
    http.addHeader("Accept", "image/jpeg");
    http.setTimeout(3000);

    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
        String jpeg = http.getString();
        if (jpeg.length() > 100 && (uint8_t)jpeg[0] == 0xFF && (uint8_t)jpeg[1] == 0xD8) {
            if (xSemaphoreTake(sdMutex, pdMS_TO_TICKS(300)) == pdTRUE) {
                digitalWrite(TFT_CS_PIN, HIGH);
                // Cek SEKALI LAGI persis sebelum menulis (anti race/duplikat)
                if (!SD.exists(photoPath)) {
                    File f = SD.open(photoPath, FILE_WRITE);
                    if (f) {
                        f.write((const uint8_t*)jpeg.c_str(), jpeg.length());
                        f.close();
                        Serial.println("[PRECACHE] Foto baru tersimpan: " + photoPath);
                    }
                }
                digitalWrite(SD_CS_PIN, HIGH);
                xSemaphoreGive(sdMutex);
            }
        }
    }
    http.end();
}

void networkTaskCore0(void * pvParameters) {
    unsigned long lastWifiCheckTask = 0;
    unsigned long lastHeartbeatTask = 0;
    unsigned long lastDbSyncTask    = 0;
    bool wasWifiConnected = (WiFi.status() == WL_CONNECTED);
    
    for (;;) {
        NetworkJob job;
        if (xQueueReceive(networkQueue, &job, pdMS_TO_TICKS(50)) == pdTRUE) {
            if (WiFi.status() == WL_CONNECTED && ESP.getFreeHeap() > 25000) {
                WiFiClient client; client.setTimeout(2000);
                HTTPClient http;
                http.begin(client, getApiUrl("boxes/") + getDeviceIdPath() + "/telemetry");
                http.addHeader("User-Agent", "ESP32-E-LOTO/5.0");
                http.addHeader("Content-Type", "application/json");
                http.setTimeout(3000);
                
                DynamicJsonDocument doc(2048);
                doc["id_box"]         = getDeviceId(); doc["event"] = String(job.event);
                doc["last_uid"]       = String(job.uid); doc["uid"] = String(job.uid);
                doc["is_tap"]         = isTapEventName(String(job.event));
                doc["is_register_scan"] = String(job.event).indexOf("REGISTER_NEW_CARD") != -1;
                doc["ip"]             = WiFi.localIP().toString(); doc["ssid"] = WiFi.SSID();
                if (gpsHasFix) {
                    doc["lat"] = currentLatitude;
                    doc["lng"] = currentLongitude;
                } else {
                    doc["lat"] = nullptr;
                    doc["lng"] = nullptr;
                }
                doc["gps_fix"]        = gpsHasFix; doc["state"] = stateToString(currentState);
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
                if (httpCode < 200 || httpCode >= 300) saveOfflineLogToSDCard(String(job.event), String(job.uid));
                http.end();
            } else if (WiFi.status() != WL_CONNECTED) {
                saveOfflineLogToSDCard(String(job.event), String(job.uid));
            }
        }
        
        if (millis() - lastWifiCheckTask > 10000) {
            lastWifiCheckTask = millis();
            if (WiFi.status() != WL_CONNECTED) {
                wasWifiConnected = false;
            } else if ((!wasWifiConnected || millis() - lastDbSyncTask > 300000) && ESP.getFreeHeap() > 30000) {
                bool justReconnected = !wasWifiConnected; 
                wasWifiConnected = true;
                lastDbSyncTask = millis(); 
                syncDatabaseToSDCard(); 
                uploadOfflineLogsSDCard();
                if (justReconnected) {
                    logAuditAsync("HEARTBEAT_SYNC", lastScannedUID);
                    needsRedraw = true;
                    resetPhotoPrecache(); // WiFi baru connect/reconnect -> mulai lagi putaran cek foto (yang sudah ada tetap dilewati)
                }
            }
        }
        
        if (millis() - lastHeartbeatTask > 8000) {
            lastHeartbeatTask = millis(); 
            logAuditAsync("HEARTBEAT_SYNC", lastScannedUID);
        }

        precacheNextWorkerPhoto(); // aman dipanggil tiap putaran, ada jeda & syarat internal sendiri
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
            displayErrorCardPopup(uid, "SUDAH TERDAFTAR", card.name, card.role, card.sid, "KARTU SUDAH TERDAFTAR MASUK");
        } else {
            buzzSuccess(); logAuditAsync("REGISTER_NEW_CARD", uid);
            displayCardNotification(uid, "KARTU BARU", "MEKANIK", "REGISTRASI OK!", true);
        }
        return;
    }
    
    if (!card.isRegistered || card.name == "UNKNOWN" || card.name == "Tidak Terdaftar") {
        buzzFailed(); logAuditAsync("SCAN_REJECTED_UNREGISTERED", uid);
        displayErrorCardPopup(uid, "AKSES DITOLAK", "", "", "", "KARTU TIDAK TERDAFTAR");
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

void connectWiFiRoutine() {
    currentState = STATE_CONNECTING;
    forceFullRedraw = true;
    drawScreen();
    
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    delay(40);
    WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());
    
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
        selectedFooterAction = 1; 
        currentState = STATE_SHOW_IP;
        logAuditAsync("WIFI_CONNECTED", WiFi.localIP().toString());
    } else {
        buzzFailed();
        selectedFooterAction = 1; 
        currentState = STATE_SERVER_OFFLINE;
    }
    forceFullRedraw = true;
    needsRedraw = true;
}

void executeFooterChoice() {
    if (currentState == STATE_BOOT_IP) {
        if (selectedFooterAction == 0) {
            selectedFooterAction = 1; 
            currentState = STATE_SYSTEM_READY;
        } else {
            connectWiFiRoutine();
        }
    } else if (currentState == STATE_SERVER_OFFLINE) {
        if (selectedFooterAction == 0) {
            connectWiFiRoutine(); 
        } else {
            selectedFooterAction = 1; 
            currentState = STATE_SYSTEM_READY; 
        }
    } else if (currentState == STATE_SHOW_IP) {
        currentState = (selectedFooterAction == 0) ? STATE_BOOT_IP : STATE_SYSTEM_READY;
    } else if (currentState == STATE_SYSTEM_READY) {
        if (selectedFooterAction == 0) {
            currentState = (WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0") ? STATE_SHOW_IP : STATE_BOOT_IP;
        } else {
            buzzSuccess(); 
            digitalWrite(PIN_RELAY, HIGH); 
            relayOpen = true;
            saveSessionToSD(); 
            logAuditAsync("LOCK_INITIALIZED", "—");
            
            isSessionActive = true;
            sessionStartTime = millis();

            for (int detik = 10; detik >= 1; detik--) {
                exitCountdownActive = false;
                currentState = STATE_COUNTDOWN;
                notificationMessage = String(detik);
                needsRedraw = true;
                drawScreen();
                
                if (detik <= 3) {
                    digitalWrite(PIN_BUZZER, HIGH); amanDelay(500); 
                    digitalWrite(PIN_BUZZER, LOW);  amanDelay(500);
                } else {
                    digitalWrite(PIN_BUZZER, HIGH); amanDelay(60); 
                    digitalWrite(PIN_BUZZER, LOW);  amanDelay(940);
                }
            }
            digitalWrite(PIN_RELAY, LOW); 
            relayOpen = false; 
            amanDelay(100); 
            clearRfidBuffer(); 
            
            isAddingFromMenu = false;
            currentState = STATE_WAIT_SPV_IN; 
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
            currentState = STATE_ALL_WORKERS_REGISTERED;
        } else {
            selectedMenuIndex = 0;
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

                // Disamakan dengan pola bunyi hitung mundur MASUK:
                // 3 detik terakhir bunyi lebih mendesak (500ms nyala / 500ms mati),
                // sebelumnya tik singkat tiap detik (60ms nyala / 940ms mati)
                if (detik <= 3) {
                    digitalWrite(PIN_BUZZER, HIGH); amanDelay(500);
                    digitalWrite(PIN_BUZZER, LOW);  amanDelay(500);
                } else {
                    digitalWrite(PIN_BUZZER, HIGH); amanDelay(60);
                    digitalWrite(PIN_BUZZER, LOW);  amanDelay(940);
                }
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
            lastScannedUID = "—"; lastScannedSID = "-----";
            activeFuelmanUID = ""; activeFuelmanName = "";
            safetyQueue.topIndex = -1; targetMekanikCount = 0; isAddingFromMenu = false;
            clearSessionFromSD();
            
            isSessionActive = false;
            sessionStartTime = 0;
            
            logAuditAsync("SESSION_CLOSED_NORMAL", "SYSTEM");
            
            currentState = STATE_BOOT_IP;
        }
    }
    forceFullRedraw = true;
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
            buzzSuccess(); currentState = STATE_BOOT_IP;
            logAuditAsync("EXIT_REGISTER_MODE", "ADMIN");
        }
        forceFullRedraw = true;
        needsRedraw = true; clearRfidBuffer(); return;
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
        } else if (activeKey == KEY_4 || activeKey == KEY_1) { 
            uint8_t newAction = (activeKey == KEY_4) ? 0 : 1;
            if (selectedFooterAction != newAction) {
                selectedFooterAction = newAction;
                buzzTick();
                drawTftFooter("KEMBALI", "LANJUT");
            }
            return;
        } else if (activeKey == KEY_5) { 
            buzzTick();
            if (selectedFooterAction == 1) {
                selectedMenuIndex = 0;
                currentState = STATE_MENU;
            } else if (selectedFooterAction == 0 && (activeKey == KEY_4)) {
                currentState = STATE_ALL_WORKERS_REGISTERED;
            } else {
                currentState = STATE_WORKER_DETAIL;
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
            } else {
                if (selectedWorkerIndex < safetyQueue.topIndex) {
                    selectedWorkerIndex++;
                } else {
                    currentState = STATE_WORKER_LIST;
                }
            }
            forceFullRedraw = true;
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
                if (currentState == STATE_BOOT_IP) {
                    drawTftFooter("OFFLINE", "ONLINE");
                } else if (currentState == STATE_SERVER_OFFLINE) {
                    drawTftFooter("COBA LAGI", "MODE OFFLINE");
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
        if (currentState == STATE_BOOT_IP || currentState == STATE_SERVER_OFFLINE || currentState == STATE_SYSTEM_READY) {
            selectedFooterAction = 1; 
        } else {
            selectedFooterAction = 0; 
        }
        
        tft.fillRect(0, 42, 480, 228, TFT_BLACK); 
        drawTftHeader();
        tft.drawRoundRect(8, 49, 464, 212, 6, TFT_DARKGREY);
    }
    
    if (!stateChanged && currentState == STATE_COUNTDOWN) {
        tft.fillRect(185, 130, 110, 60, TFT_BLACK);
    } else if (!stateChanged && currentState == STATE_UNLOCKING) {
        tft.fillRect(185, 120, 110, 60, TFT_BLACK);
    }
    
    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    
    if (currentState == STATE_BOOT_IP) {
        tft.setTextDatum(MC_DATUM);
        setStoryFont(24);
        drawGearIcon(240, 205, TFT_LIGHTGREY);
        tft.setTextColor(TFT_YELLOW, TFT_BLACK);
        tft.drawString("SELAMAT DATANG", 240, 95);
        setStoryFont(12);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.drawString("PILIH METODE OPERASIONAL", 240, 140);
        drawTftFooter("OFFLINE", "ONLINE");
    } 
    else if (currentState == STATE_CONNECTING) {
        tft.setTextDatum(MC_DATUM);
        drawWifiIcon(105, 156, TFT_LIGHTGREY);
        setStoryFont(12);
        tft.setTextColor(TFT_YELLOW, TFT_BLACK);
        tft.drawString("CONNECTING WIFI", 240, 72);
        
        setStoryFont(12);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.setTextDatum(TL_DATUM);
        tft.drawString("NAMA WIFI", 215, 120);
        
        tft.fillRect(215, 135, 250, 40, TFT_BLACK); 
        tft.fillRect(215, 200, 250, 25, TFT_BLACK); 
        
        setStoryFont(12);
        if (WiFi.status() == WL_CONNECTED) {
            drawTextFit(WiFi.SSID(), 215, 153, 250, TFT_WHITE, TFT_BLACK, 12);
        } else {
            drawTextFit("MENCARI SINYAL...", 215, 153, 250, TFT_LIGHTGREY, TFT_BLACK, 12);
        }
        
        setStoryFont(12);
        tft.drawString("STATUS", 215, 190);
        tft.setTextColor(TFT_YELLOW, TFT_BLACK);
        
        String statusTxt = "MEMINDAI...";
        if(WiFi.status() == WL_CONNECTED) {
            statusTxt = (WiFi.localIP().toString() == "0.0.0.0") ? "MENDAPAT IP..." : "TERHUBUNG";
        }
        tft.drawString(statusTxt, 215, 218);
        drawTftFooter("", "");
    } 
    else if (currentState == STATE_SERVER_OFFLINE) {
        tft.setTextDatum(MC_DATUM);
        setStoryFont(12);
        tft.setTextColor(ELOTO_HEADER, TFT_BLACK);
        tft.drawString("JARINGAN TIDAK DITEMUKAN", 240, 75);
        setStoryFont(24);
        tft.setTextColor(ELOTO_HEADER, TFT_BLACK);
        tft.drawString("[ X ]", 240, 125);
        setStoryFont(9);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.drawString("WIFI GAGAL TERHUBUNG", 240, 180);
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
        drawTftFooter("KEMBALI", "LANJUT");
    } 
    else if (currentState == STATE_SYSTEM_READY || currentState == STATE_SYSTEM_READY_FINAL) {
        tft.setTextDatum(TL_DATUM);
        setStoryFont(12);
        tft.setTextColor(TFT_GREEN, TFT_BLACK);
        tft.drawString("SYSTEM READY", 20, 72);
        setStoryFont(12);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.drawString("SIAPKAN TALI SLING UNTUK", 20, 118);
        tft.drawString("MENGUNCI", 20, 150);
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
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
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
        if (!drawPhotoFromAPI(safetyQueue.workers[safetyQueue.topIndex].uid, 20, 92, 150, 150)) {
            tft.setTextDatum(MC_DATUM);
            setStoryFont(9);
            tft.drawString("NO FOTO", 95, 166);
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
        for (int i = 0; i <= safetyQueue.topIndex && i < 5; i++) {
            bool selected = (i == selectedWorkerIndex);
            int rowY = 96 + i * 27;
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
        tft.drawString("TEKAN OK UNTUK BUKA DETAIL", 240, boxY + (boxH / 2));
        
        drawTftFooter("KEMBALI", "LANJUT");
    } 
    else if (currentState == STATE_WORKER_DETAIL && safetyQueue.topIndex >= 0) {
        int safeIndex = constrain(selectedWorkerIndex, 0, safetyQueue.topIndex);
        WorkerInfo &worker = safetyQueue.workers[safeIndex];
        
        tft.fillRoundRect(14, 54, 452, 204, 6, ELOTO_BG);
        tft.drawRoundRect(14, 54, 452, 204, 6, ELOTO_DARK_RED);
        tft.setTextDatum(MC_DATUM);
        setStoryFont(12);
        tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
        tft.drawString("DETAIL PERSONEL", 240, 70);
        tft.fillRect(296, 88, 154, 154, TFT_BLACK);
        tft.drawRect(296, 88, 154, 154, ELOTO_TEXT);
        
        tft.setTextDatum(TL_DATUM);
        setStoryFont(9);
        tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
        drawTextFit(worker.name, 26, 110, 260, ELOTO_HEADER, ELOTO_BG, 9);
        tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
        drawTextFit("SID      : " + formatSid(worker.sid), 26, 150, 400, ELOTO_TEXT, ELOTO_BG, 9);
        drawTextFit("JABATAN  : " + worker.role, 26, 186, 400, ELOTO_TEXT, ELOTO_BG, 9);
        drawTftFooter("KEMBALI", "LANJUT");
        
        if (!drawPhotoFromAPI(worker.uid, 296, 88, 154, 154)) {
            tft.setTextDatum(MC_DATUM);
            setStoryFont(9);
            tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
            tft.drawString("NO FOTO", 373, 165);
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
        
        if (!drawPhotoFromAPI(supervisorUID, 20, 92, 150, 150)) {
            tft.setTextDatum(MC_DATUM);
            setStoryFont(9);
            tft.drawString("NO FOTO", 95, 166);
        }
    }
    else if (currentState == STATE_MAINTENANCE_DONE) {
        tft.setTextDatum(MC_DATUM);
        setStoryFont(12);
        tft.setTextColor(TFT_GREEN, TFT_BLACK);
        tft.drawString("MAINTENANCE SELESAI", 240, 95);
        setStoryFont(12);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.drawString("SEMUA PROSES LOTO SUDAH", 240, 145);
        tft.drawString("BERHASIL DITUTUP", 240, 175);
        
        setStoryFont(9);
        tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        tft.drawString("UNIT AMAN DIGUNAKAN", 240, 225);
        drawTftFooter("", "");
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
    } else {
        doc["lat"] = nullptr;
        doc["lon"] = nullptr;
    }
    
    doc["gps_fix"] = gpsHasFix; doc["wifi_connected"] = (WiFi.status() == WL_CONNECTED);
    doc["gps_bytes"] = gpsByteCount;
    doc["gps_sentences"] = gpsSentenceCount;
    doc["gps_last_byte_ms"] = gpsLastByteMillis;
    doc["gps_last_fix_ms"] = gpsLastFixMillis;
    doc["gps_chars_processed"] = gps.charsProcessed();
    doc["gps_failed_checksum"] = gps.failedChecksum();
    doc["gps_passed_checksum"] = gps.passedChecksum();
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
    // 1) Serial paling awal, supaya semua log (termasuk log SD di bawah) kelihatan dari detik pertama
    Serial.begin(115200);
    Serial.println();
    Serial.println("[ELOTO] Booting...");

    // 2) Siapkan kedua pin CS sebagai OUTPUT dan non-aktifkan (HIGH) dari awal,
    //    supaya TFT dan SD tidak sama-sama "aktif" saat bus SPI baru dinyalakan
    pinMode(TFT_CS_PIN, OUTPUT); 
    digitalWrite(TFT_CS_PIN, HIGH);
    pinMode(SD_CS_PIN, OUTPUT);  
    digitalWrite(SD_CS_PIN, HIGH);

    // 3) Nyalakan bus SPI SATU KALI di sini, SEBELUM tft.init() (urutan lama kebalik,
    //    itu salah satu penyebab SD kadang gagal terdeteksi saat cold boot)
    SPI.begin(18, 19, 23, SD_CS_PIN);

    // 4) Baru setelah bus siap, inisialisasi TFT
    tft.init();
    tft.setRotation(1);
    tft.setSwapBytes(true);
    tft.fillScreen(TFT_BLACK); 
    
    tft.setTextColor(ELOTO_TEXT);
    tft.setTextDatum(MC_DATUM);
    setStoryFont(12);
    tft.drawString("MEMULAI SISTEM...", 240, 160);

    Serial.println("[ELOTO] GPS monitor aktif: UART2 RX=GPIO16 TX=GPIO17 baud=9600");
    
    sdMutex = xSemaphoreCreateMutex();
    networkQueue = xQueueCreate(10, sizeof(NetworkJob));

    // 5) Pastikan TFT benar-benar nganggur sebelum SD dicoba
    digitalWrite(TFT_CS_PIN, HIGH);

    // Catatan: initializeSDCard() TIDAK menyentuh WiFi/jaringan sama sekali -
    // dia murni bicara ke slot microSD lewat SPI lokal. Status hasilnya
    // ditampilkan lewat badge "SD OK"/"SD --" di header (drawTftHeader),
    // yang otomatis ikut ter-refresh terus selama layar hidup - jadi tidak
    // perlu tulisan sementara lagi di sini (itu penyebab dulu kadang kelihatan
    // kadang tidak, karena keburu ketimpa clearMainScreenArea()).
    if (initializeSDCard()) {
        sdCardMounted = true; 
        loadUsersToRAM(); 
        loadConfigFromSD(); 
    } else { 
        sdCardMounted = false; 
    }
    
    TJpgDec.setJpgScale(1);
    TJpgDec.setCallback(tft_output);
    gpsSerial.setRxBufferSize(1024); 
    gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
    rd6300Serial.begin(9600, SERIAL_8N1, RD6300_RX_PIN, RD6300_TX_PIN);
    
    pinMode(PIN_RELAY, OUTPUT); 
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_RELAY, LOW); 
    digitalWrite(PIN_BUZZER, LOW); 
    relayOpen = false;
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
        buzzSuccess(); 
        currentState = STATE_BOOT_IP;
    } else {
        bootIpTimer = millis();
        currentState = STATE_BOOT_IP;
    }
    
    forceFullRedraw = true; 
    lastRenderedState = STATE_SYSTEM_ERROR;
    needsRedraw = true;
}

void loop() {
    server.handleClient();
    feedGPS();
    
    if (millis() - lastClockUpdateMillis >= 1000) {
        lastClockUpdateMillis = millis();
        updateHeaderClock();
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
    
    bool rfidInputEnabled = (currentState == STATE_REGISTER_RFID ||
                             currentState == STATE_WAIT_SPV_IN ||
                             currentState == STATE_MEKANIK_IN ||
                             currentState == STATE_MEKANIK_OUT ||
                             currentState == STATE_WAIT_SPV_OUT);
                             
    if (rfidInputEnabled) {
        if (millis() - lastScanTime >= 500) { 
            String authUID = checkRfidSensor();
            if (authUID != "") {
                if (authUID == lastScannedRfidUID && (millis() - lastScannedRfidTime < 3500)) {
                    clearRfidBuffer();
                    return; 
                }
                lastScannedRfidUID = authUID;
                
                digitalWrite(PIN_BUZZER, HIGH); 
                delay(60); 
                digitalWrite(PIN_BUZZER, LOW);
                
                processRfidLogic(authUID);
                
                lastScannedRfidTime = millis();
                lastScanTime = millis();
            }
        }
    } else {
        clearRfidBuffer();
        lastScannedRfidUID = ""; 
    }
}

void getLcdText(String &lcd0, String &lcd1) {
    lcd0 = "SISTEM READY";
    lcd1 = "TEKAN 1 UTK MULAI";
    
    if (currentState == STATE_BOOT_IP) {
        lcd0 = "SELAMAT DATANG";
        lcd1 = "PILIH METODE OPERASIONAL";
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
        lcd1 = "TEKAN OK UNTUK DETAIL";
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
    } else if (currentState == STATE_UNLOCKING) {
        lcd0 = "MEMBUKA GEMBOK...";
        lcd1 = "LEPASKAN TALI SLING LOTO";
    }
}