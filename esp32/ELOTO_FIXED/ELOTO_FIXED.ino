// E-LOTO integrated BLE confirmation / shared SPI / single-owner GPS (NEW STABLE REVISION)
// Target: original dual-core ESP32 shield. See PANDUAN_ELOTO.md before upload.
#include <Arduino.h>
#include <esp_system.h>
#include "../ServerDefaults.h"
#include <NimBLEDevice.h>
#include <freertos/queue.h>
#include <utility>
#include <math.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <FS.h>
#include <SD.h>
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
#define TOUCH_CS_PIN    21      
#include "device_secrets.h"
String device_id = ELOTO_DEVICE_ID;
esp_reset_reason_t bootResetReason = ESP_RST_UNKNOWN;


// ============================================================================
// KONFIGURASI JARINGAN & SERVER
// ============================================================================
String wifi_ssid        = "vivoV29";
String wifi_password    = "112233445566";
String server_host      = eloto::DEFAULT_SERVER_BASE;
const char* SERVER_PROJECT_PATH  = "";

const uint32_t NOTIFICATION_SUCCESS_DURATION = 1800;
const uint32_t NOTIFICATION_ERROR_DURATION   = 2000;
const uint32_t MIN_HEAP_TO_VERIFY_CARD      = 12000;
const uint32_t MIN_HEAP_TO_POST_TELEMETRY   = 14000;
const uint16_t PHOTO_DISPLAY_SIZE            = 150;

// Susun alamat dasar server API.
String getServerBaseUrl() {
    String host = server_host;
    host.trim();
    while (host.endsWith("/")) host.remove(host.length() - 1);
    if (host.length() == 0) host = WiFi.gatewayIP().toString() + ":5002";
    if (host.startsWith("http://") || host.startsWith("https://")) {
        return host + SERVER_PROJECT_PATH + "/";
    }
    return "http://" + host + SERVER_PROJECT_PATH + "/";
}

// Gabungkan alamat server dan endpoint API.
String getApiUrl(const char* endpoint) {
    return getServerBaseUrl() + "api/" + endpoint;
}

// Ambil ID perangkat untuk identitas backend.
String getDeviceId() {
    String configuredId = device_id;
    configuredId.trim();
    if (configuredId.length() > 0) return configuredId;

    String mac = WiFi.macAddress();
    mac.replace(":", "");
    mac.toUpperCase();
    return "ESP32-" + mac;
}

// Amankan ID perangkat untuk segmen URL.
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
    STATE_WELCOME, STATE_GEOFENCE
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
    bool lookupUnavailable = false;
    bool offlineFallbackAllowed = false;
};

// Validasi dan rapikan format SID personel.
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

unsigned long sessionStartTime = 0;
bool isSessionActive = false;

String activeFuelmanUID = "";
String activeFuelmanName = "";
int8_t lastMekanikDisplayCount = -99;
int8_t initialMekanikOutCount  = -1;
bool isAddingFromMenu          = false;
bool workerListFromMenu        = false;
bool needsRedraw               = true;
bool forceFullRedraw           = true;
bool photoAlreadyDrawn         = false;
double currentLatitude    = 0;
double currentLongitude   = 0;
bool gpsHasFix            = false;
bool firstGpsFixSent      = false;
bool relayOpen            = false;
volatile bool relayPulseActive = false;
volatile bool sdCardMounted = false;
volatile bool sdCardStatusOk = false;
bool sdSyncOk             = false;
uint16_t sdUserCount      = 0;
uint8_t sdProbeLockMisses = 0;
bool exitCountdownActive  = false;
volatile bool gpsInitStarted = false;
volatile bool gpsInitDone = false;
volatile bool gpsRecoveryRunning = false;

void initGpsModule();
// Jalankan inisialisasi GPS pada task terpisah.
void gpsInitTask(void *pvParameters) {
    initGpsModule();
    gpsInitDone = true;
    vTaskDelete(NULL);
}

// Pastikan koordinat GPS berada dalam rentang valid.
bool hasValidGpsFix() {
    return gpsHasFix && currentLatitude >= -90.0 && currentLatitude <= 90.0 &&
            currentLongitude >= -180.0 && currentLongitude <= 180.0 &&
            (currentLatitude != 0.0 || currentLongitude != 0.0);
}

// Ubah kode penyebab reset ESP32 menjadi teks untuk log diagnosis.
const char *resetReasonName(esp_reset_reason_t reason) {
    switch (reason) {
        case ESP_RST_POWERON: return "POWERON";
        case ESP_RST_EXT: return "EXTERNAL";
        case ESP_RST_SW: return "SOFTWARE";
        case ESP_RST_PANIC: return "PANIC";
        case ESP_RST_INT_WDT: return "INTERRUPT_WATCHDOG";
        case ESP_RST_TASK_WDT: return "TASK_WATCHDOG";
        case ESP_RST_WDT: return "WATCHDOG";
        case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
        case ESP_RST_BROWNOUT: return "BROWNOUT";
        case ESP_RST_SDIO: return "SDIO";
        default: return "UNKNOWN";
    }
}

QueueHandle_t networkQueue;
SemaphoreHandle_t sdMutex = NULL;
SemaphoreHandle_t gpsMutex = NULL;
SemaphoreHandle_t spiBusMutex = NULL;
TaskHandle_t sdStorageWorkerHandle = NULL;
TaskHandle_t sdLockOwnerTask = NULL;
const char *sdLockOwnerOperation = "none";
const char *sdLockStage = "idle";
TickType_t sdLockAcquiredAt = 0;
const uint32_t SD_JOB_PERSONNEL_SYNC = 0x01;
const uint32_t SD_JOB_OFFLINE_UPLOAD = 0x02;
const uint32_t PHOTO_DOWNLOAD_HEAP_RESERVE = 8000;
const uint32_t PHOTO_SD_DISPLAY_HEAP_RESERVE = 3000;
const uint32_t SD_RECHECK_INTERVAL_MS = 5000;

class SpiBusGuard {
public:
    SpiBusGuard() { configASSERT(spiBusMutex); xSemaphoreTakeRecursive(spiBusMutex, portMAX_DELAY); }
    ~SpiBusGuard() { xSemaphoreGiveRecursive(spiBusMutex); }
    SpiBusGuard(const SpiBusGuard&) = delete;
    SpiBusGuard& operator=(const SpiBusGuard&) = delete;
};

class SharedBusTft : public TFT_eSPI {
public:
#define TFT_GUARDED(method)     template<typename... A> auto method(A&&... a)         -> decltype(std::declval<TFT_eSPI&>().method(std::forward<A>(a)...)) {         SpiBusGuard guard; digitalWrite(SD_CS_PIN, HIGH); return TFT_eSPI::method(std::forward<A>(a)...); }
    TFT_GUARDED(drawArc)
    TFT_GUARDED(drawCircle)
    TFT_GUARDED(drawFastHLine)
    TFT_GUARDED(drawFastVLine)
    TFT_GUARDED(drawRect)
    TFT_GUARDED(drawRoundRect)
    TFT_GUARDED(drawString)
    TFT_GUARDED(fillCircle)
    TFT_GUARDED(fillRect)
    TFT_GUARDED(fillRoundRect)
    TFT_GUARDED(fillScreen)
    TFT_GUARDED(fillTriangle)
    TFT_GUARDED(init)
    TFT_GUARDED(pushImage)
#undef TFT_GUARDED
};

// Ambil mutex SD dan bus SPI bersama.
BaseType_t takeSd(TickType_t timeout, const char *operation = "SD") {
    if (!sdMutex || !spiBusMutex) return pdFALSE;
    if (relayPulseActive) return pdFALSE;

    TaskHandle_t currentTask = xTaskGetCurrentTaskHandle();
    if (xSemaphoreTake(sdMutex, timeout) != pdTRUE) {
        TaskHandle_t owner = sdLockOwnerTask;
        TickType_t heldTicks = owner ? xTaskGetTickCount() - sdLockAcquiredAt : 0;
        static TickType_t lastProbeWarning = 0;
        TickType_t now = xTaskGetTickCount();
        bool report = !operation || strcmp(operation, "presence-probe") != 0 ||
                      now - lastProbeWarning >= pdMS_TO_TICKS(5000);
        if (report) {
            if (operation && strcmp(operation, "presence-probe") == 0) lastProbeWarning = now;
            Serial.printf("[SD_LOCK] timeout operation=%s stage=sd-mutex holder=%s holder_operation=%s held_ms=%u wait_ms=%u\n",
                operation, owner ? pcTaskGetName(owner) : "unknown",
                sdLockOwnerOperation,
                (unsigned int)(heldTicks * portTICK_PERIOD_MS),
                (unsigned int)(timeout * portTICK_PERIOD_MS));
            if (owner) Serial.printf("[SD_LOCK] holder_stage=%s\n", sdLockStage);
        }
        return pdFALSE;
    }
    sdLockOwnerTask = currentTask;
    sdLockOwnerOperation = operation;
    sdLockStage = "spi-bus-acquire";
    sdLockAcquiredAt = xTaskGetTickCount();
    if (relayPulseActive) {
        sdLockOwnerTask = NULL;
        sdLockOwnerOperation = "none";
        sdLockStage = "idle";
        xSemaphoreGive(sdMutex);
        return pdFALSE;
    }
    if (xSemaphoreTakeRecursive(spiBusMutex, timeout) != pdTRUE) {
        Serial.printf("[SD_LOCK] timeout operation=%s stage=spi-bus holder=%s held_ms=%u wait_ms=%u\n",
            operation, pcTaskGetName(sdLockOwnerTask),
            (unsigned int)((xTaskGetTickCount() - sdLockAcquiredAt) * portTICK_PERIOD_MS),
            (unsigned int)(timeout * portTICK_PERIOD_MS));
        sdLockOwnerTask = NULL;
        sdLockOwnerOperation = "none";
        sdLockStage = "idle";
        xSemaphoreGive(sdMutex);
        return pdFALSE;
    }
    digitalWrite(TFT_CS_PIN, HIGH);
    digitalWrite(TOUCH_CS_PIN, HIGH);
    sdLockStage = "active";
    return pdTRUE;
}

void setSdLockStage(const char *stage) {
    if (sdLockOwnerTask == xTaskGetCurrentTaskHandle()) sdLockStage = stage;
}

// Lepaskan mutex SD dan bus SPI.
void giveSd() {
    if (sdLockOwnerTask != xTaskGetCurrentTaskHandle()) {
        Serial.printf("[SD_LOCK] invalid release task=%s owner=%s operation=%s\n",
            pcTaskGetName(NULL), sdLockOwnerTask ? pcTaskGetName(sdLockOwnerTask) : "none",
            sdLockOwnerOperation);
        return;
    }
    digitalWrite(SD_CS_PIN, HIGH);
    TickType_t heldTicks = xTaskGetTickCount() - sdLockAcquiredAt;
    if (heldTicks >= pdMS_TO_TICKS(1000)) {
        Serial.printf("[SD_LOCK] long-hold operation=%s stage=%s held_ms=%u\n",
            sdLockOwnerOperation, sdLockStage,
            (unsigned int)(heldTicks * portTICK_PERIOD_MS));
    }
    xSemaphoreGiveRecursive(spiBusMutex);
    sdLockOwnerTask = NULL;
    sdLockOwnerOperation = "none";
    sdLockStage = "idle";
    xSemaphoreGive(sdMutex);
}
SharedBusTft tft;

HardwareSerial gpsSerial(2);

enum GpsPollState { GPS_POLL_IDLE, GPS_POLL_WAITING };
GpsPollState gpsPollState = GPS_POLL_IDLE;
String gpsResponseBuffer = "";
unsigned long gpsPollStartMillis = 0;
unsigned long gpsLastPollMillis = 0;
const unsigned long GPS_POLL_INTERVAL = 1000;
const unsigned long GPS_POLL_TIMEOUT  = 1200; // Toleransi waktu respon SIM808
const unsigned long GPS_NO_RESPONSE_RECOVERY = 20000;
const unsigned long GPS_RECOVERY_COOLDOWN    = 30000;

// Parameter GPS Smart Lock & Adaptive Polling
bool gpsIsLocked = false;
const float HDOP_ACCURACY_THRESHOLD = 2.5;     // Batas presisi akurat (HDOP <= 2.5)
const uint8_t MIN_SATELLITES_LOCKED = 4;       // Minimal 4 satelit untuk 3D Fix
const unsigned long GPS_LOCKED_INTERVAL = 5000;
unsigned long gpsLastSearchLogMillis = 0;

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
uint8_t selectedFooterAction = 0; // Default: 0 = DAFTAR KARTU
SystemState stateBeforeNotification = STATE_IDLE;
SystemState lastRenderedState = STATE_SYSTEM_ERROR;
int8_t lastRenderedWorkerIndex = -1;
String notificationTitle = "";
String notificationMessage = "";
String cachedQueueList = "";

AuditEntry auditRing[AUDIT_RING_SIZE];
uint8_t auditHead = 0; uint16_t auditCount = 0;

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

String lastScannedRfidUID = "";
unsigned long lastScannedRfidTime = 0;
bool rfidTapArmed = true;
unsigned long lastRfidFrameMillis = 0;

bool startupSyncPending = true;
const unsigned long PERSONNEL_SYNC_INTERVAL_MS = 30000UL;
const uint32_t MIN_HEAP_TO_QUEUE_PERSONNEL_SYNC = 26000;

bool regHasCard = false;         
String regLastUID = "";          
String regLastSID = "";          
String regLastName = "";         
String regLastRole = "";         
String regLastStatus = "";       
bool regLastSuccess = true;      

void processRfidLogic(String uid);
bool handleFuelmanTap(const String &uid, WorkerInfo &card);
String checkRfidSensor();
bool syncDatabaseToSDCard();
bool syncPersonnelPhotosToSDCard(const String &uids);
WorkerInfo searchUserFromSDCard(String uid);
void saveOfflineLogToSDCard(String event, String uid, const String &eventId);
void uploadOfflineLogsSDCard();
void sdStorageWorkerTask(void *unused);
bool requestSdStorageJob(uint32_t jobs);
void saveSessionToSD();
void clearSessionFromSD();
bool loadSessionFromSD();
WorkerInfo fetchCardDataAPI(String uid);
bool deviceHasNetwork();
bool isLotoSessionTapState(SystemState state);
void rebuildCachedQueueString();
void logAuditAsync(String event, String uid);
void loadUsersToRAM();
void drawScreen();
extern int geoCount;
extern bool geoHealthy;
void drawTftHeader();
void drawBleBadge(bool isConnected);
void drawBluetoothIcon(int16_t cx, int16_t cy, uint16_t color);
void drawTftFooter(const String &leftText, const String &rightText);
void drawTftFooterSingle(const String &btnText);
void drawTftFooterTriple(const String &leftText, const String &midText, const String &rightText);     
void updateHeaderClock(bool forceRedraw = false);
void drawSinglePersonIcon(int16_t x, int16_t y, float scale, uint16_t color, bool withOutline = false, uint16_t outlineColor = TFT_BLACK);
uint8_t readADKeypadRaw();
void getLcdText(String &lcd0, String &lcd1);
void sanitizeQueueDeadlock();
void displayCardNotification(String uid, String name, String role, String statusMsg, bool isSuccess);
void displayErrorCardPopup(String uid, String title, String name, String role, String sid, String bottomHint);
bool drawPhotoFromAPI(String uid, int32_t boxX, int32_t boxY, uint16_t boxW, uint16_t boxH);
void clearMainScreenArea();
void executeFooterChoice();
void parseGpsResponse(const String &response);
void feedGPS();
void serviceGeofence();
void drawGeofenceWarning();
void drawGeofencePage();
void geoScanTask(void *unused);
void removeQueueAt(int index);
void drawCornerAccents(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
void drawDecorativeLine(int16_t y, uint16_t color);
void reportBlePresence();
bool discoverServer();

// Ubah UID heksadesimal menjadi desimal berpadded.
String hexToDecStringPadded(String hexStr) {
    if (hexStr.length() > 8) hexStr = hexStr.substring(hexStr.length() - 8);
    char* end;
    unsigned long decVal = strtoul(hexStr.c_str(), &end, 16);
    String decStr = String(decVal);
    while(decStr.length() < 10) decStr = "0" + decStr; 
    return decStr;
}

// Ubah UID heksadesimal menjadi desimal biasa.
String hexToDecStringUnpadded(String hexStr) {
    if (hexStr.length() > 8) hexStr = hexStr.substring(hexStr.length() - 8);
    char* end;
    unsigned long decVal = strtoul(hexStr.c_str(), &end, 16);
    return String(decVal); 
}

// Baca tombol keypad analog tanpa debounce.
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

// Kembalikan tombol setelah pembacaan stabil.
uint8_t getDebouncedKey() {
    static uint8_t stableKey = KEY_NONE;
    static uint8_t candidateKey = KEY_NONE;
    static unsigned long candidateTime = 0;
    uint8_t currentSample = readADKeypadRaw();
    
    if (currentSample != candidateKey) {
        candidateKey = currentSample;
        candidateTime = millis();
    }
    if ((millis() - candidateTime) >= 35) {
        stableKey = candidateKey;
    }
    return stableKey;
}

// Pulihkan berkas SD dari transaksi yang terputus.
bool recoverSdFile(const char *active, const char *temporary, const char *backup) {
    if (SD.exists(backup)) {
        if (!SD.exists(active)) {
            if (!SD.rename(backup, active)) {
                return false;
            }
        } else if (!SD.remove(backup)) {
            return false;
        }
    }
    if (SD.exists(temporary) && !SD.remove(temporary)) {
        return false;
    }
    return true;
}

// Ganti berkas SD secara aman melalui berkas cadangan.
bool commitSdFile(const char *active, const char *temporary, const char *backup) {
    bool hadOldFile = SD.exists(active);
    if (hadOldFile && !SD.rename(active, backup)) {
        return false;
    }
    if (!SD.rename(temporary, active)) {
        if (hadOldFile && !SD.rename(backup, active)) {}
        return false;
    }
    if (hadOldFile && !SD.remove(backup)) {}
    return true;
}

// Simpan foto hasil unduhan secara aman ke cache SD.
bool cachePhotoToSD(String uid, String sid, const uint8_t *jpegData, size_t jpegSize) {
    if (!sdCardMounted || !jpegData || jpegSize <= 100 || jpegSize > 40000) return false;
    uid.trim();
    uid.toUpperCase();
    if (uid.length() < 4 || uid.length() > 20) return false;
    for (size_t i = 0; i < uid.length(); ++i) {
        if (!isHexadecimalDigit(uid[i])) return false;
    }
    sid = formatSid(sid);
    if (sid == "-----") {
        Serial.printf("[PHOTO] Cannot cache UID without a valid 5-character SID uid=%s\n", uid.c_str());
        return false;
    }

    String active = "/foto/" + sid + ".jpg";
    String temporary = "/foto/" + sid + ".TMP";
    String backup = "/foto/" + sid + ".BAK";
    if (takeSd(pdMS_TO_TICKS(300), "photo-cache") != pdTRUE) return false;

    bool saved = false;
    setSdLockStage("photo-dir-check");
    bool directoryReady = SD.exists("/foto");
    if (!directoryReady) {
        setSdLockStage("photo-dir-create");
        bool created = SD.mkdir("/foto");
        directoryReady = created || SD.exists("/foto");
    }
    if (directoryReady) {
        setSdLockStage("photo-dir-verify");
        File directory = SD.open("/foto", FILE_READ);
        directoryReady = directory && directory.isDirectory();
        if (directory) directory.close();
    }
    if (!directoryReady) {
        Serial.printf("[PHOTO] Cannot create/verify /foto uid=%s sid=%s card_type=%u\n",
            uid.c_str(), sid.c_str(), SD.cardType());
    } else {
        setSdLockStage("photo-recover");
        bool recovered = recoverSdFile(active.c_str(), temporary.c_str(), backup.c_str());
        if (recovered) {
            setSdLockStage("photo-open-temp");
            File photoFile = SD.open(temporary, FILE_WRITE);
            if (photoFile) {
                setSdLockStage("photo-write");
                size_t written = photoFile.write(jpegData, jpegSize);
                setSdLockStage("photo-flush");
                photoFile.flush();
                photoFile.close();
                setSdLockStage("photo-verify");
                File verifyFile = SD.open(temporary, FILE_READ);
                bool valid = written == jpegSize && verifyFile && verifyFile.size() == jpegSize;
                if (verifyFile) verifyFile.close();
                if (valid) {
                    setSdLockStage("photo-commit");
                    saved = commitSdFile(active.c_str(), temporary.c_str(), backup.c_str());
                }
                if (!saved) Serial.printf("[PHOTO] Write/verify/commit failed uid=%s sid=%s written=%u expected=%u\n",
                    uid.c_str(), sid.c_str(), (unsigned int)written, (unsigned int)jpegSize);
            } else {
                setSdLockStage("photo-open-failed-diagnostics");
                File fotoDirectory = SD.open("/foto");
                bool fotoIsDirectory = fotoDirectory && fotoDirectory.isDirectory();
                if (fotoDirectory) fotoDirectory.close();
                Serial.printf("[PHOTO] Cannot open cache path=%s foto_exists=%d foto_is_dir=%d card_type=%u\n",
                    temporary.c_str(), SD.exists("/foto"), fotoIsDirectory, SD.cardType());
            }
        } else {
            Serial.printf("[PHOTO] Recovery failed uid=%s sid=%s\n", uid.c_str(), sid.c_str());
        }
    }

    digitalWrite(SD_CS_PIN, HIGH);
    giveSd();
    if (!saved) Serial.printf("[PHOTO] SD cache write failed uid=%s bytes=%u\n",
        uid.c_str(), (unsigned int)jpegSize);
    return saved;
}

bool removeCachedPhotoFromSD(String uid, String sid) {
    uid.trim();
    uid.toUpperCase();
    if (uid.length() < 4 || uid.length() > 20 || !sdCardMounted ||
        sdMutex == NULL) return false;
    for (size_t i = 0; i < uid.length(); ++i) {
        if (!isHexadecimalDigit(uid[i])) return false;
    }

    String lowerUid = uid;
    lowerUid.toLowerCase();
    sid = formatSid(sid);
    String paths[4] = {
        "/foto/" + uid + ".jpg",
        "/foto/" + hexToDecStringUnpadded(uid) + ".jpg",
        "/foto/" + lowerUid + ".jpg",
        sid == "-----" ? "" : "/foto/" + sid + ".jpg"
    };
    if (takeSd(pdMS_TO_TICKS(300), "photo-cache-remove") != pdTRUE) return false;

    bool removed = true;
    for (const String &path : paths) {
        if (path.length() == 0) continue;
        if (SD.exists(path) && !SD.remove(path)) removed = false;
    }
    digitalWrite(SD_CS_PIN, HIGH);
    giveSd();
    return removed;
}

bool sdWriteReadbackTest(const char *path) {
    if (SD.exists(path) && !SD.remove(path)) {
        Serial.printf("[SD_DIAG] Cannot remove stale test file path=%s\n", path);
        return false;
    }

    File testFile = SD.open(path, FILE_WRITE);
    if (!testFile) {
        Serial.printf("[SD_DIAG] Create failed path=%s card_type=%u root=%d\n",
            path, SD.cardType(), SD.exists("/"));
        return false;
    }

    const char *expected = "ELOTO_SD_OK";
    size_t written = testFile.print(expected);
    testFile.flush();
    testFile.close();
    if (written != strlen(expected)) {
        Serial.printf("[SD_DIAG] Write failed path=%s expected=%u actual=%u\n",
            path, (unsigned int)strlen(expected), (unsigned int)written);
        SD.remove(path);
        return false;
    }

    File verifyFile = SD.open(path, FILE_READ);
    String actual;
    if (verifyFile) {
        actual.reserve(strlen(expected));
        while (verifyFile.available()) actual += (char)verifyFile.read();
        verifyFile.close();
    }
    bool valid = actual == expected;
    if (!SD.remove(path)) {
        Serial.printf("[SD_DIAG] Could not clean test file path=%s\n", path);
        valid = false;
    }
    if (!valid) Serial.printf("[SD_DIAG] Readback failed path=%s bytes=%u\n",
        path, (unsigned int)actual.length());
    return valid;
}

// Pasang SD dan pulihkan berkas sistem yang diperlukan.
bool initializeSDCard() {
    SpiBusGuard busGuard;
    setSdLockStage("sd-mount");
    digitalWrite(TFT_CS_PIN, HIGH);
    digitalWrite(TOUCH_CS_PIN, HIGH);
    digitalWrite(SD_CS_PIN, HIGH);
    pinMode(SPI_MISO_PIN, INPUT_PULLUP);
    static bool spiStarted = false;
    if (!spiStarted) {
        TFT_eSPI::getSPIinstance().begin(SPI_SCK_PIN, SPI_MISO_PIN, SPI_MOSI_PIN, SD_CS_PIN);
        spiStarted = true;
    }
    delay(600);

    SD.end();
    bool terhubung = false;
    const uint32_t sckSpeeds[] = { 400000, 100000, 1000000 };
    const uint8_t SPEED_COUNT = sizeof(sckSpeeds) / sizeof(sckSpeeds[0]);
    const uint8_t MAX_MOUNT_ROUNDS = 3;

    for (uint8_t round = 0; round < MAX_MOUNT_ROUNDS && !terhubung; round++) {
        for (uint8_t speed = 0; speed < SPEED_COUNT; speed++) {
            setSdLockStage("sd-mount-attempt");
            digitalWrite(TFT_CS_PIN, HIGH);
            digitalWrite(TOUCH_CS_PIN, HIGH);
            digitalWrite(SD_CS_PIN, HIGH);
            delay(75);

            bool mounted = SD.begin(SD_CS_PIN, TFT_eSPI::getSPIinstance(), sckSpeeds[speed], "/sd", 5, false);
            Serial.printf("[SD] Mount attempt round=%u clock=%luHz result=%s\n",
                (unsigned int)(round + 1), (unsigned long)sckSpeeds[speed],
                mounted ? "ok" : "failed");
            if (mounted) {
                terhubung = true;
                break;
            }
            SD.end();
            digitalWrite(SD_CS_PIN, HIGH);
        }
        if (!terhubung && round + 1 < MAX_MOUNT_ROUNDS) {
            Serial.printf("[SD] Mount retry round=%u after card reinitialization clocks\n",
                (unsigned int)(round + 2));
            delay(300);
        }
    }

    if (!terhubung) {
        digitalWrite(SD_CS_PIN, HIGH);
        Serial.printf("[SD] Mount failed after %u attempts; card was not formatted\n",
            (unsigned int)(MAX_MOUNT_ROUNDS * SPEED_COUNT));
        return false;
    }

    uint8_t cardType = SD.cardType();
    if (cardType == CARD_NONE) {
        SD.end();
        Serial.println("[SD] Mount returned no card type");
        return false;
    }

    setSdLockStage("sd-foto-check");
    if (!SD.exists("/foto")) {
        setSdLockStage("init-foto-mkdir");
        bool created = SD.mkdir("/foto");
        if (!created && !SD.exists("/foto")) {
            Serial.println("[SD] /foto directory creation failed; continuing with root temp fallback");
        }
    }
    setSdLockStage("sd-foto-verify");
    File fotoDirectory = SD.open("/foto", FILE_READ);
    bool fotoDirectoryValid = fotoDirectory && fotoDirectory.isDirectory();
    if (fotoDirectory) fotoDirectory.close();
    Serial.printf("[SD] /foto directory exists=%d is_dir=%d\n",
        SD.exists("/foto"), fotoDirectoryValid);

    setSdLockStage("sd-readwrite-test");
    bool rootWritable = sdWriteReadbackTest("/SDTEST.TXT");
    bool photoDirectoryWritable = fotoDirectoryValid && sdWriteReadbackTest("/foto/SDTEST.TXT");
    if (!rootWritable && !photoDirectoryWritable) {
        File root = SD.open("/");
        bool rootReadable = root && root.isDirectory();
        if (root) root.close();
        File photoDirectory = SD.open("/foto");
        bool photoDirectoryReadable = photoDirectory && photoDirectory.isDirectory();
        if (photoDirectory) photoDirectory.close();
        Serial.printf("[SD_DIAG] Write test failed both locations card_type=%u card_mb=%llu root_readable=%d foto_readable=%d total=%llu used=%llu\n",
            SD.cardType(), (unsigned long long)(SD.cardSize() / (1024ULL * 1024ULL)),
            rootReadable, photoDirectoryReadable, (unsigned long long)SD.totalBytes(),
            (unsigned long long)SD.usedBytes());
        SD.end();
        digitalWrite(SD_CS_PIN, HIGH);
        return false;
    }
    if (!rootWritable) Serial.println("[SD_DIAG] Root write failed; /foto is writable, using it for cache staging");

    recoverSdFile("/session.json", "/session.json.tmp", "/session.json.bak");
    recoverSdFile("/users.csv", "/users.csv.tmp", "/users.csv.bak");
    recoverSdFile("/users.csv", "/USERS.TMP", "/USERS.BAK");
    recoverSdFile("/users.csv", "/U.TMP", "/U.BAK");
    recoverSdFile("/users.csv", "/foto/CACHE.TMP", "/users.bak");
    recoverSdFile("/offline_logs.csv", "/offline_logs.csv.tmp", "/offline_logs.csv.bak");

    digitalWrite(SD_CS_PIN, HIGH);
    Serial.printf("[SD] Read/write test passed type=%u size_mb=%llu root_write=%d foto_write=%d\n",
        cardType, (unsigned long long)(SD.cardSize() / (1024ULL * 1024ULL)),
        rootWritable, photoDirectoryWritable);
    return terhubung;
}

// Confirm that the mounted filesystem still responds after card removal or bus failure.
bool probeMountedSDCard() {
    if (!sdCardMounted || sdMutex == NULL) {
        sdCardStatusOk = false;
        return false;
    }
    if (xSemaphoreGetMutexHolder(sdMutex) != NULL) return sdCardMounted;
    if (takeSd(pdMS_TO_TICKS(100), "presence-probe") != pdTRUE) {
        if (WiFi.status() == WL_CONNECTED) {
            return sdCardMounted;
        }
        if (sdProbeLockMisses < 3) sdProbeLockMisses++;
        if (sdProbeLockMisses >= 3 && sdCardStatusOk) {
            Serial.println("[SD] Probe busy but mounted card still healthy; keeping SD badge until real filesystem failure");
        }
        return sdCardMounted;
    }

    bool responding = SD.cardType() != CARD_NONE;
    File root;
    if (responding) {
        root = SD.open("/");
        responding = root && root.isDirectory();
    }
    if (root) root.close();
    sdProbeLockMisses = 0;
    sdCardStatusOk = responding;
    if (!responding) {
        sdCardMounted = false;
        sdSyncOk = false;
    }
    digitalWrite(SD_CS_PIN, HIGH);
    giveSd();
    if (!responding) Serial.println("[SD] Mounted card stopped responding; marking SD unavailable");
    return responding;
}

// Pilih font TFT sesuai ukuran teks.
void setStoryFont(uint8_t pointSize) {
    if (pointSize >= 24) tft.setFreeFont(&FreeMonoBold24pt7b);
    else if (pointSize >= 18) tft.setFreeFont(&FreeMonoBold18pt7b);
    else if (pointSize >= 12) tft.setFreeFont(&FreeMonoBold12pt7b);
    else tft.setFreeFont(&FreeMonoBold9pt7b);
}

// Gambar teks dengan ukuran yang muat di area.
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

// Gambar ikon satu personel pada TFT.
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

// Gambar ikon kelompok sesuai jumlah personel.
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

// Tentukan layar yang menampilkan pilihan bawah.
bool hasFooterChoice() {
    return currentState == STATE_WELCOME ||
            currentState == STATE_SHOW_IP ||
            currentState == STATE_START_CONFIRM || currentState == STATE_SYSTEM_READY ||
            currentState == STATE_SUPERVISOR_VALID || currentState == STATE_SET_MEKANIK_COUNT ||
            currentState == STATE_ALL_WORKERS_REGISTERED || currentState == STATE_WORKER_LIST ||
            currentState == STATE_WORKER_DETAIL || currentState == STATE_SPV_OUT_CONFIRM ||
            currentState == STATE_SERVER_OFFLINE;
}

// Gambar ikon Wi-Fi pada layar.
void drawWifiIcon(int16_t x, int16_t y, uint16_t color) {
    tft.drawArc(x, y, 22, 18, 220, 320, color, ELOTO_BG);
    tft.drawArc(x, y, 14, 11, 220, 320, color, ELOTO_BG);
    tft.fillCircle(x, y, 2, color);
}

// Gambar panah navigasi ke atas atau bawah.
void drawArrowIcon(int16_t x, int16_t y, uint16_t color, bool up) {
    if (up) {
        tft.fillTriangle(x, y - 28, x - 25, y, x + 25, y, color);
        tft.fillRect(x - 10, y, 20, 28, color);
    } else {
        tft.fillTriangle(x, y + 28, x - 25, y, x + 25, y, color);
        tft.fillRect(x - 10, y - 28, 20, 28, color);
    }
}

// Gambar ikon pembaca kartu RFID.
void drawRfidIcon(int16_t x, int16_t y, uint16_t color) {
    tft.drawRoundRect(x - 24, y - 17, 42, 34, 5, color);
    tft.drawCircle(x - 12, y - 5, 3, color);
    tft.drawCircle(x - 12, y + 7, 3, color);
    tft.drawArc(x + 27, y, 13, 9, 225, 315, color, TFT_BLACK);
    tft.drawArc(x + 27, y, 20, 15, 225, 315, color, TFT_BLACK);
}

// Gambar ikon roda gigi untuk pengaturan.
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

// Teruskan blok gambar JPEG ke TFT.
bool tft_output(int16_t x, int16_t y, uint16_t w, uint16_t h, uint16_t* bitmap) {
    if (y >= tft.height()) return 0;
    tft.pushImage(x, y, w, h, bitmap);
    return 1;
}

// Gambar ikon Bluetooth pada indikator.
void drawBluetoothIcon(int16_t cx, int16_t cy, uint16_t color) {
    tft.drawFastVLine(cx, cy - 7, 15, color);
    tft.drawLine(cx, cy - 7, cx + 4, cy - 3, color);
    tft.drawLine(cx + 4, cy - 3, cx - 4, cy + 3, color);
    tft.drawLine(cx - 4, cy - 3, cx + 4, cy + 3, color);
    tft.drawLine(cx + 4, cy + 3, cx, cy + 7, color);
}

// Tampilkan jumlah tag BLE pada header.
void drawBleBadge(bool isConnected) {
    // Latar hijau jika ada tag terdeteksi (> 0), kuning jika 0 / standby
    uint16_t bg = (geoCount > 0) ? TFT_GREEN : TFT_YELLOW;
    uint16_t fg = TFT_BLACK;

    tft.fillRoundRect(246, 8, 60, 25, 4, bg);
    drawBluetoothIcon(259, 20, fg);

    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(fg, bg);
    setStoryFont(9);
    // Tampilkan angka jumlah geofencing / iTag yang tersambung di samping logo bluetooth
    String bleText = "--";
    if (geoHealthy) {
        bleText = String(geoCount);
    }
    tft.drawString(bleText, 285, 21);
}

// Format angka waktu minimal dua digit.
String twoDigits(unsigned long value) {
    return value < 10 ? String("0") + String(value) : String(value);
}

// Perbarui jam sesi pada header TFT.
void updateHeaderClock(bool forceRedraw) {
    static String lastClockText = "";
    if (!isSessionActive) {
        if (!forceRedraw && lastClockText.length() > 0) {
            tft.fillRect(135, 4, 105, 34, TFT_NAVY);
        }
        lastClockText = "";
        return;
    }

    unsigned long elapsedSeconds = (millis() - sessionStartTime) / 1000;
    String clockText = twoDigits(elapsedSeconds / 3600) + ":" +
                        twoDigits((elapsedSeconds / 60) % 60) + ":" +
                        twoDigits(elapsedSeconds % 60);

    if (!forceRedraw && clockText == lastClockText) return;
    lastClockText = clockText;

    tft.fillRect(135, 4, 105, 34, TFT_NAVY);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(ELOTO_BG, ELOTO_HEADER);
    setStoryFont(9);
    tft.drawString(clockText, 185, 21);
}

// Gambar header status BLE, GPS, SD, dan Wi-Fi.
void drawTftHeader() {
    tft.fillRect(0, 0, 480, 42, TFT_NAVY);
    tft.drawFastHLine(0, 41, 480, ELOTO_BG);
    
    tft.setTextDatum(ML_DATUM);
    tft.setTextColor(ELOTO_BG, ELOTO_HEADER);
    setStoryFont(9);
    tft.drawString("E-LOTO", 8, 21);
    
    updateHeaderClock(true);
    bool wifiReady = WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0";
    uint16_t networkColor = wifiReady ? TFT_GREEN : TFT_RED;
    
    // 1. Badge BLE di sebelah kiri GPS (X: 246)
    bool bleConnected = geoHealthy && (geoCount > 0);
    drawBleBadge(bleConnected);

    // 2. Badge GPS (X: 312)
    bool gpsNow = hasValidGpsFix();
    bool gpsHasHistory = (!gpsNow && currentLatitude != 0.0 && currentLongitude != 0.0);
    uint16_t gpsColor = gpsNow ? TFT_GREEN : (gpsHasHistory ? TFT_YELLOW : TFT_RED);
    String gpsText = gpsNow ? "GPS OK" : (gpsHasHistory ? "GPS LAST" : "GPS --");

    tft.fillRoundRect(312, 8, 60, 25, 4, gpsColor);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_BLACK, gpsColor);
    setStoryFont(9);
    tft.drawString(gpsText, 342, 21);
    
    // 3. Badge SD (X: 378)
    tft.fillRoundRect(378, 8, 60, 25, 4, sdCardStatusOk ? TFT_GREEN : TFT_RED);
    tft.setTextColor(TFT_BLACK, sdCardStatusOk ? TFT_GREEN : TFT_RED);
    tft.drawString(sdCardStatusOk ? "SD OK" : "SD --", 408, 21);
    
    // 4. Badge WiFi (X: 444)
    tft.fillRoundRect(444, 8, 28, 25, 4, networkColor);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_BLACK, networkColor);
    tft.drawString(wifiReady ? "ON" : "--", 458, 21);
}

// Gambar tombol navigasi bawah TFT.
void drawTftFooter(const String &leftText, const String &rightText) {
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

// Gambar satu tombol pada footer TFT.
void drawTftFooterSingle(const String &btnText) {
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

// Gambar tiga tombol pilihan pada footer.
void drawTftFooterTriple(const String &leftText, const String &midText, const String &rightText) {
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

// Tampilkan foto dari SD atau unduh dari API backend.
bool drawPhotoFromAPI(String uid, int32_t boxX, int32_t boxY, uint16_t boxW, uint16_t boxH) {
    uid.trim();
    if (uid == "") {
        Serial.println("[PHOTO] Display skipped reason=empty-uid");
        return false;
    }

    String hexUid = uid;
    hexUid.toUpperCase();
    String decUid = hexToDecStringUnpadded(hexUid);
    String hexLower = hexUid;
    hexLower.toLowerCase();
    String cacheSid = "";
    for (int i = 0; i < ramUserCount; ++i) {
        if (ramUserCache[i].uid.equalsIgnoreCase(hexUid) ||
            ramUserCache[i].uid.equalsIgnoreCase(decUid)) {
            cacheSid = formatSid(ramUserCache[i].sid);
            break;
        }
    }

    String paths[4] = {
        "/foto/" + hexUid + ".jpg",
        "/foto/" + decUid + ".jpg",
        "/foto/" + hexLower + ".jpg",
        cacheSid == "-----" || cacheSid.length() == 0 ? "" : "/foto/" + cacheSid + ".jpg"
    };

    uint8_t *jpegData = NULL;
    size_t jpegSize = 0;
    bool backendPhotoMissing = false;

    // Ambil foto terbaru dari backend terlebih dahulu saat jaringan tersedia.
    if (WiFi.status() == WL_CONNECTED && ESP.getFreeHeap() > 30000) {
        if (server_host.length() == 0) discoverServer();
        if (server_host.length() > 0) {
            WiFiClient client;
            client.setTimeout(2500);
            HTTPClient http;
            String photoUrl = getApiUrl("users/photo/") + hexUid + "?size=320&quality=78";
            http.begin(client, photoUrl);
            http.addHeader("X-Device-Id", getDeviceId());
            http.setTimeout(3500);
            int code = http.GET();
            int length = code == HTTP_CODE_OK ? http.getSize() : -1;
            backendPhotoMissing = code == HTTP_CODE_NOT_FOUND;
            if (code == HTTP_CODE_OK && length > 100 && length <= 40000 &&
                ESP.getFreeHeap() > (uint32_t)length + PHOTO_DOWNLOAD_HEAP_RESERVE) {
                jpegData = static_cast<uint8_t *>(malloc((size_t)length));
                if (jpegData != NULL) {
                    WiFiClient *stream = http.getStreamPtr();
                    size_t received = stream->readBytes(jpegData, (size_t)length);
                    if (received == (size_t)length && jpegData[0] == 0xFF && jpegData[1] == 0xD8) jpegSize = received;
                    else {
                        free(jpegData);
                        jpegData = NULL;
                    }
                }
            }
            if (jpegData != NULL && sdCardMounted) cachePhotoToSD(hexUid, cacheSid, jpegData, jpegSize);
            Serial.printf("[PHOTO] GET %s => HTTP %d content=%d bytes=%u free_heap=%u\n",
                photoUrl.c_str(), code, length, (unsigned int)jpegSize, ESP.getFreeHeap());
            http.end();
        } else {
            Serial.println("[PHOTO] Backend belum ditemukan; mencoba cache SD");
        }
    } else if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("[PHOTO] Backend download skipped reason=low-heap free_heap=%u; trying SD cache\n",
            ESP.getFreeHeap());
    }

    // Prefer the backend, but use its SD cache if the request could not provide an image.
    if (jpegData == NULL && !backendPhotoMissing && sdCardMounted) {
        String photoPath = "";
        if (takeSd(pdMS_TO_TICKS(100), "photo-display-read") == pdTRUE) {
            for (int p = 0; p < 4; p++) {
                if (paths[p].length() > 0 && SD.exists(paths[p])) {
                    photoPath = paths[p];
                    break;
                }
            }
            if (photoPath.length() > 0) {
                File f = SD.open(photoPath, FILE_READ);
                if (f) {
                    size_t cachedPhotoSize = f.size();
                    if (cachedPhotoSize > 100 && cachedPhotoSize <= 40000 &&
                        ESP.getFreeHeap() > cachedPhotoSize + PHOTO_SD_DISPLAY_HEAP_RESERVE) {
                        jpegSize = cachedPhotoSize;
                        jpegData = static_cast<uint8_t *>(malloc(jpegSize));
                        if (jpegData != NULL && f.read(jpegData, jpegSize) != jpegSize) {
                            free(jpegData);
                            jpegData = NULL;
                        }
                        if (jpegData != NULL) Serial.printf("[PHOTO] Using SD cache fallback path=%s bytes=%u wifi=%d\n",
                            photoPath.c_str(), (unsigned int)jpegSize,
                            WiFi.status() == WL_CONNECTED);
                    } else {
                        Serial.printf("[PHOTO] SD fallback skipped path=%s bytes=%u heap=%u\n",
                            photoPath.c_str(), (unsigned int)cachedPhotoSize, ESP.getFreeHeap());
                    }
                    f.close();
                }
            } else {
                Serial.printf("[PHOTO] SD cache path not found uid=%s sid=%s\n",
                    hexUid.c_str(), cacheSid.c_str());
            }
            digitalWrite(SD_CS_PIN, HIGH);
            giveSd();
        } else {
            Serial.printf("[PHOTO] SD cache read lock unavailable uid=%s\n", hexUid.c_str());
        }
    }
    
    bool drawn = false;
    if (jpegData != NULL && jpegSize > 100 && jpegData[0] == 0xFF && jpegData[1] == 0xD8) {
        uint16_t sourceW = 0, sourceH = 0;
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
            if (!drawn) Serial.printf("[PHOTO] JPEG render failed uid=%s size=%u dimensions=%ux%u\n",
                hexUid.c_str(), (unsigned int)jpegSize, sourceW, sourceH);
        } else {
            Serial.printf("[PHOTO] Invalid JPEG data uid=%s size=%u\n",
                hexUid.c_str(), (unsigned int)jpegSize);
        }
    } else if (jpegData != NULL) {
        Serial.printf("[PHOTO] Invalid JPEG signature uid=%s size=%u\n",
            hexUid.c_str(), (unsigned int)jpegSize);
    }
    
    if (jpegData != NULL) free(jpegData);
    return drawn;
}

// Kenali nama event yang berasal dari tap kartu.
bool isTapEventName(String event) {
    event.toUpperCase();
    return event.indexOf("SUPERVISOR_LOCK_IN") != -1 ||
            event.indexOf("SUPERVISOR_EXTRA_LOCK_IN") != -1 ||
            event.indexOf("SUPERVISOR_LOG_OUT") != -1 ||
            event.indexOf("SUPERVISOR_EXTRA_LOG_OUT") != -1 ||
            event.indexOf("MECHANIC_LOG_IN") != -1 ||
            event.indexOf("MECHANIC_LOG_OUT") != -1 ||
            event.indexOf("REFUEL_START") != -1 ||
            event.indexOf("REFUEL_END") != -1;
}

// Kenali variasi nama peran pengawas.
bool checkIsSupervisorRole(String role) {
    String r = role; r.toUpperCase(); r.trim();
    return (r.indexOf("PENGAWAS") != -1 || 
            r.indexOf("SUPERVISOR") != -1 || 
            r.indexOf("SPV") != -1 || 
            r.indexOf("K3") != -1 || 
            r.indexOf("ADMIN") != -1);
}

// Periksa apakah personel antrean adalah pengawas.
bool isQueueSupervisor(int index) {
    return index >= 0 && index <= safetyQueue.topIndex &&
            checkIsSupervisorRole(safetyQueue.workers[index].role);
}

// Hitung mekanik yang sedang masuk antrean.
int countQueueMechanics() {
    int count = 0;
    for (int i = 0; i <= safetyQueue.topIndex; i++) {
        if (!isQueueSupervisor(i)) count++;
    }
    return count;
}

// Hitung pengawas yang sedang masuk antrean.
int countQueueSupervisors() {
    int count = 0;
    for (int i = 0; i <= safetyQueue.topIndex; i++) {
        if (isQueueSupervisor(i)) count++;
    }
    return count;
}

// Normalisasi UID sebelum pencarian atau penyimpanan.
String normalizeRfidUid(String uid) {
    uid.trim(); uid.replace(" ", ""); uid.replace(":", ""); uid.replace("-", ""); uid.toUpperCase();
    return uid;
}

// Samakan variasi penulisan peran personel.
String normalizeUserRole(String role) {
    role.trim(); role.replace("\r", ""); role.replace("\n", ""); role.toUpperCase();
    if (checkIsSupervisorRole(role)) return "PENGAWAS";
    if (role.indexOf("FUEL") != -1 || role.indexOf("BBM") != -1) return "FUELMAN";
    return "MEKANIK";
}

// Kenali peran petugas pengisian bahan bakar.
bool isFuelmanRole(const String &role) {
    String r = role; r.trim(); r.toUpperCase();
    return (r.indexOf("FUEL") != -1 || r.indexOf("BBM") != -1);
}

const char *const GEO_MECHANIC_MACS[] = { "" };
const uint32_t GEO_TAG_TIMEOUT_MS = 25000;
const uint32_t GEO_WARNING_DELAY_MS = 3000;
const uint32_t GEO_SCANNER_STALE_MS = 10000;
const uint8_t GEO_MAX_TAGS = 20;
struct GeoTag { char mac[18]; int rssi; uint32_t seen; };
GeoTag geoTags[GEO_MAX_TAGS] = {};
uint8_t geoTagCount = 0;
portMUX_TYPE geoMux = portMUX_INITIALIZER_UNLOCKED;
uint32_t geoScanHeartbeat = 0, geoOverflowSeen = 0;
bool geoScanCompleted = false, geoOverflow = false;
TaskHandle_t geoTaskHandle = NULL;
int geoCount = 0, geoTapCount = 0;
bool geoHealthy = false, geoWarning = false;
bool geoPending = false;
uint32_t geoPendingSince = 0;
uint32_t geoLastPaint = 0;
bool geoBannerWasVisible = false;
volatile int blePresenceHttpStatus = 0;
volatile uint8_t blePresenceReportedCount = 0;
volatile uint32_t blePresenceLastReportAt = 0;

// Batasi alamat BLE ke format MAC yang valid.
bool geoAllowedMac(const String &mac) {
    bool configured = false;
    for (const char *allowed : GEO_MECHANIC_MACS) {
        if (!allowed[0]) continue;
        configured = true;
        if (mac.equalsIgnoreCase(allowed)) return true;
    }
    return !configured;
}

class GeoAdvertCallbacks : public NimBLEScanCallbacks {
    void onResult(const NimBLEAdvertisedDevice *device) override {
        if (!device) return;
        String mac = device->getAddress().toString().c_str();
        if (!geoAllowedMac(mac)) return;
        String name = device->haveName() ? device->getName().c_str() : "";
        name.toUpperCase();
        if (name.indexOf("WATCH") >= 0 || name.indexOf("HAYLOU") >= 0 ||
            name.indexOf("BAND") >= 0 || name.indexOf("BUDS") >= 0 || name.indexOf("PHONE") >= 0) return;
        bool itag = (device->haveServiceUUID() &&
            device->isAdvertisingService(NimBLEUUID((uint16_t)0x1802))) ||
            name.indexOf("ITAG") >= 0 || name.indexOf("ISEARCH") >= 0;
            
        uint32_t now = millis();
        portENTER_CRITICAL(&geoMux);
        for (uint8_t i = 0; i < geoTagCount; ++i) {
            if (strcasecmp(mac.c_str(), geoTags[i].mac) == 0) {
                geoTags[i].seen = now; geoTags[i].rssi = device->getRSSI();
                portEXIT_CRITICAL(&geoMux); return;
            }
        }
        if (itag) {
            if (geoTagCount < GEO_MAX_TAGS) {
                mac.toCharArray(geoTags[geoTagCount].mac, 18);
                geoTags[geoTagCount].rssi = device->getRSSI();
                geoTags[geoTagCount++].seen = now;
            } else { geoOverflow = true; geoOverflowSeen = now; }
        }
        portEXIT_CRITICAL(&geoMux);
    }
};

// Pindai tag BLE pada task terpisah.
void geoScanTask(void *unused) {
    vTaskDelay(pdMS_TO_TICKS(1500));
    NimBLEDevice::init("ELOTO_iTag_Confirm");
    NimBLEScan *scan = NimBLEDevice::getScan();
    static GeoAdvertCallbacks callbacks;
    scan->setScanCallbacks(&callbacks, true); 
    scan->setActiveScan(true); 
    scan->setInterval(160);
    scan->setWindow(80); 
    scan->setMaxResults(0); 
    unsigned long lastTaskHealthLog = millis();
    for (;;) {
        uint32_t scanStart = millis();
        scan->getResults(2000, false);
        bool scanRan = uint32_t(millis() - scanStart) >= 1500;
        scan->clearResults();
        
        uint32_t now = millis();
        portENTER_CRITICAL(&geoMux);
        for (uint8_t i = 0; i < geoTagCount;) {
            if (uint32_t(now - geoTags[i].seen) > GEO_TAG_TIMEOUT_MS) {
                geoTags[i] = geoTags[--geoTagCount];
            } else ++i;
        }
        if (geoOverflow && uint32_t(now - geoOverflowSeen) > GEO_TAG_TIMEOUT_MS)
            geoOverflow = false;
        geoScanHeartbeat = now; geoScanCompleted = scanRan;
        portEXIT_CRITICAL(&geoMux);
        if (millis() - lastTaskHealthLog >= 60000) {
            lastTaskHealthLog = millis();
            Serial.printf("[HEALTH] task=BLEConfirm stack_high_water=%u free_heap=%u min_free_heap=%u\n",
                (unsigned int)uxTaskGetStackHighWaterMark(NULL), ESP.getFreeHeap(), ESP.getMinFreeHeap());
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

// Hitung tag mekanik yang terdeteksi.
int geoMechanicsTapped() {
    int total = 0;
    for (int i = 0; i <= safetyQueue.topIndex; ++i) {
        if (!isQueueSupervisor(i) && !isFuelmanRole(safetyQueue.workers[i].role)) ++total;
    }
    return total;
}

// Perbarui status geofence dari hasil pemindaian BLE.
void serviceGeofence() {
    uint32_t now = millis();
    int count; uint32_t heartbeat; bool completed, overflow;
    portENTER_CRITICAL(&geoMux);
    count = geoTagCount; heartbeat = geoScanHeartbeat;
    completed = geoScanCompleted; overflow = geoOverflow;
    portEXIT_CRITICAL(&geoMux);
    
    bool healthy = completed && !overflow && uint32_t(now - heartbeat) <= GEO_SCANNER_STALE_MS;
    int taps = geoMechanicsTapped();
    bool excess = isSessionActive && healthy && count > taps;
    if (excess) {
        if (!geoPending) { geoPending = true; geoPendingSince = now; }
    } else geoPending = false;
    bool warning = excess && uint32_t(now - geoPendingSince) >= GEO_WARNING_DELAY_MS;
    
    if (warning != geoWarning) {
        logAuditAsync(warning ? "BLE_COUNT_WARNING" : "BLE_WARNING_ENDED", "SYSTEM");
    }
    
    if ((count != geoCount || taps != geoTapCount || healthy != geoHealthy) && currentState == STATE_GEOFENCE) {
        needsRedraw = true; 
    }
    if (healthy != geoHealthy && isSessionActive) {
        needsRedraw = true; 
    }
    geoCount = count; geoTapCount = taps; geoHealthy = healthy; geoWarning = warning;
}

// Kirim daftar tag BLE terbaru ke backend.
void reportBlePresence() {
    if (WiFi.status() != WL_CONNECTED || ESP.getFreeHeap() < 30000) return;

    char detectedTags[GEO_MAX_TAGS][18] = {};
    uint8_t tagCount;
    portENTER_CRITICAL(&geoMux);
    tagCount = geoTagCount;
    for (uint8_t i = 0; i < tagCount; ++i) {
        memcpy(detectedTags[i], geoTags[i].mac, sizeof(detectedTags[i]));
    }
    portEXIT_CRITICAL(&geoMux);

    DynamicJsonDocument doc(1536);
    doc["id_box"] = getDeviceId();
    JsonArray tags = doc.createNestedArray("ble_tags");
    for (uint8_t i = 0; i < tagCount; ++i) tags.add(detectedTags[i]);
    if (doc.overflowed()) {
        Serial.printf("[BLE] Presence JSON overflow tags=%u heap=%u\n", tagCount, ESP.getFreeHeap());
        return;
    }

    WiFiClient client;
    client.setTimeout(1500);
    HTTPClient http;
    http.begin(client, getApiUrl("loto/presence"));
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Id", getDeviceId());
    http.setTimeout(2500);
    String payload;
    serializeJson(doc, payload);
    int httpCode = http.POST(payload);
    http.end();
    blePresenceHttpStatus = httpCode;
    blePresenceReportedCount = tagCount;
    blePresenceLastReportAt = millis();

    static int lastLoggedStatus = 0;
    static uint32_t lastLogAt = 0;
    if (httpCode < 200 || httpCode >= 300 || httpCode != lastLoggedStatus ||
        uint32_t(millis() - lastLogAt) >= 30000) {
        Serial.printf("[BLE] Presence report HTTP=%d tags=%u heap=%u\n",
            httpCode, tagCount, ESP.getFreeHeap());
        lastLoggedStatus = httpCode;
        lastLogAt = millis();
    }
}

// Gambar halaman informasi geofence.
void drawGeofencePage() {
    tft.fillRect(10, 90, 460, 150, ELOTO_BG); 
    
    tft.setTextDatum(MC_DATUM); setStoryFont(12);
    tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
    tft.drawString("KONFIRMASI GEOFENCE / BLE", 240, 72);
    setStoryFont(12); tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
    tft.drawString("iTag terdeteksi : " + String(geoCount), 240, 112);
    tft.drawString("Mekanik sudah tap : " + String(geoTapCount), 240, 144);
    setStoryFont(9); tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
    const char *status = !geoHealthy ? "BLE BELUM SIAP / DATA TIDAK VALID" :
        !isSessionActive ? "MONITOR - SESI BELUM AKTIF" :
        geoWarning ? "WARNING: ADA TAG LEBIH DARI TAP" :
        geoCount > geoTapCount ? "MENUNGGU KONFIRMASI 3 DETIK" :
        geoCount < geoTapCount ? "TAG KURANG - PERIKSA MANUAL" : "JUMLAH SAMA - CEK IDENTITAS";
    tft.drawString(status, 240, 184);
    tft.setTextColor(ELOTO_MUTED, ELOTO_BG);
    tft.drawString("BLE scan, bukan koneksi / posisi GPS", 240, 214);
    tft.drawString("Tag hilang dihapus setelah 25 detik", 240, 236);
    drawTftFooterSingle("KEMBALI");
}

// Tampilkan peringatan ketidakcocokan geofence.
void drawGeofenceWarning() {
    bool visible = isSessionActive && (geoWarning || !geoHealthy) && currentState != STATE_GEOFENCE;
    if (!visible) {
        if (geoBannerWasVisible) { 
            forceFullRedraw = true; needsRedraw = true; 
        }
        geoBannerWasVisible = false; return;
    }
    
    static int lastWarnCount = -1;
    static int lastWarnTap = -1;
    static bool lastWarnHealthy = true;

    if (!geoBannerWasVisible || lastWarnCount != geoCount || lastWarnTap != geoTapCount || lastWarnHealthy != geoHealthy) {
        geoBannerWasVisible = true;
        lastWarnCount = geoCount; lastWarnTap = geoTapCount; lastWarnHealthy = geoHealthy;

        tft.fillRect(10, 246, 460, 23, ELOTO_HEADER);
        tft.setTextDatum(MC_DATUM); setStoryFont(9);
        tft.setTextColor(ELOTO_BG, ELOTO_HEADER);
        String text = !geoHealthy ? "BLE TIDAK VALID - PERIKSA PERSONEL" :
            "WARNING: BLE " + String(geoCount) + " / TAP MEKANIK " + String(geoTapCount);
        tft.drawString(text, 240, 257);
    }
}

// Kirim perintah AT ke modul GPS.
bool kirimPerintahAT(const char* perintah, unsigned long tunggu) {
    while (gpsSerial.available()) gpsSerial.read();
    gpsSerial.println(perintah);
    unsigned long mulai = millis();
    String response;
    response.reserve(96);
    while (millis() - mulai < tunggu) {
        while (gpsSerial.available()) {
            char c = (char)gpsSerial.read();
            if (response.length() < 192) response += c;
        }
        if (response.indexOf("\nOK") >= 0 || response.startsWith("OK")) return true;
        if (response.indexOf("ERROR") >= 0) return false;
        vTaskDelay(pdMS_TO_TICKS(1));
    }
    return false;
}

// Inisialisasi modem GPS dan konfigurasi dasarnya.
void initGpsModule() {
    bool modemReady = false;
    for (uint8_t attempt = 1; attempt <= 5 && !modemReady; attempt++) {
        modemReady = kirimPerintahAT("AT", 400);
        if (!modemReady) vTaskDelay(pdMS_TO_TICKS(250));
    }
    if (!modemReady) {
        Serial.println("[GPS] Modem AT not responding; scheduled recovery will retry");
    } else {
        kirimPerintahAT("ATE0", 250);
        bool powered = kirimPerintahAT("AT+CGNSPWR=1", 1000);
        if (!powered) {
            vTaskDelay(pdMS_TO_TICKS(500));
            powered = kirimPerintahAT("AT+CGNSPWR=1", 1000);
        }
        Serial.printf("[GPS] GNSS power command=%s\n", powered ? "accepted" : "no-ack");
        kirimPerintahAT("AT+CGNSSEQ=\"RMC\"", 400);
        kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK313,1*2E\"", 400);
        kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK301,2*2E\"", 400);
        kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK220,1000*1F\"", 400);
    }
    gpsLastPollMillis = millis();
    gpsLastValidResponseMillis = millis();
}

// Pulihkan koneksi GPS tanpa menghentikan loop utama.
void gpsRecoveryTask(void *pvParameters) {
    bool ready = kirimPerintahAT("AT", 700);
    if (ready) {
        kirimPerintahAT("ATE0", 300);
        bool powered = kirimPerintahAT("AT+CGNSPWR=1", 1000);
        if (!powered) vTaskDelay(pdMS_TO_TICKS(500));
        if (!powered) powered = kirimPerintahAT("AT+CGNSPWR=1", 1000);
        Serial.printf("[GPS] Recovery modem=%s gnss=%s\n",
            ready ? "ready" : "no-ack", powered ? "powered" : "no-ack");
    } else {
        Serial.println("[GPS] Recovery: modem AT still not responding");
    }
    gpsPollState = GPS_POLL_IDLE;
    gpsResponseBuffer = "";
    gpsLastPollMillis = millis();
    gpsLastValidResponseMillis = millis();
    gpsRecoveryRunning = false;
    vTaskDelete(NULL);
}

// Uraikan koordinat dan status dari respons GPS.
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
    if (idx < 6) return;

    gpsSentenceCount++;
    gpsLastValidResponseMillis = millis();

    String fixStatus = field[1];
    String latStr     = field[3];
    String lonStr     = field[4];
    fixStatus.trim();
    latStr.trim();
    lonStr.trim();

    if (idx > 10 && field[10].length() > 0) gpsHdop = field[10].toFloat();
    if (idx > 14 && field[14].length() > 0) gpsSatellitesInView = (uint8_t)field[14].toInt();
    if (idx > 15 && field[15].length() > 0) gpsSatellitesUsed = (uint8_t)field[15].toInt();

    if (fixStatus == "1" && latStr.length() > 0 && lonStr.length() > 0) {
        double newLat = strtod(latStr.c_str(), NULL);
        double newLon = strtod(lonStr.c_str(), NULL);
        
        if (xSemaphoreTake(gpsMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            currentLatitude  = newLat;
            currentLongitude = newLon;
            gpsHasFix        = true;
            gpsLastFixMillis = millis();
            xSemaphoreGive(gpsMutex);
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
        }

        // Logika Smart Lock: Kunci koordinat jika sudah akurat (satelit >= 4 dan HDOP <= 2.5)
        if (!gpsIsLocked && gpsSatellitesUsed >= MIN_SATELLITES_LOCKED && gpsHdop <= HDOP_ACCURACY_THRESHOLD) {
            gpsIsLocked = true;
            Serial.printf("[GPS LOCK] Koordinat Akurat Terkunci! Sat: %d, HDOP: %.2f | Lat: %.6f, Lon: %.6f\n", gpsSatellitesUsed, gpsHdop, currentLatitude, currentLongitude);
            logAuditAsync("GPS_ACCURATE_LOCKED", "SYSTEM");
        }
    } else if (millis() - gpsLastSearchLogMillis >= 10000) {
        gpsLastSearchLogMillis = millis();
        Serial.printf("[GPS] Acquiring fix status=%s sats_used=%u sats_view=%u hdop=%.2f\n",
            fixStatus.c_str(), gpsSatellitesUsed, gpsSatellitesInView, gpsHdop);
    }
}

// Baca data serial GPS dan perbarui status lokasi.
void feedGPS() {
    if (!gpsInitDone || gpsRecoveryRunning) return;
    unsigned long now = millis();
    unsigned long currentInterval = gpsIsLocked ? GPS_LOCKED_INTERVAL : GPS_POLL_INTERVAL;
    if (gpsPollState == GPS_POLL_IDLE) {
        if (now - gpsLastPollMillis >= currentInterval) {
            gpsLastPollMillis = now;
            if (gpsSerial.available() > 500) {
                while (gpsSerial.available()) gpsSerial.read();
            }
            gpsSerial.println("AT+CGNSINF");
            gpsResponseBuffer = "";
            gpsPollStartMillis = now;
            gpsPollState = GPS_POLL_WAITING;
        }
    } else {
        int bytesRead = 0;
        while (gpsSerial.available() && bytesRead < 64) {
            char c = gpsSerial.read();
            if (gpsResponseBuffer.length() < 512) gpsResponseBuffer += c;
            gpsByteCount++;
            gpsLastByteMillis = now;
            bytesRead++;
        }
        int infIdx = gpsResponseBuffer.indexOf("+CGNSINF:");
        bool barisLengkap = false;
        if (infIdx >= 0) {
            int nlIdx = gpsResponseBuffer.indexOf('\n', infIdx);
            if (nlIdx > infIdx) barisLengkap = true;
        }
        bool timeout = now - gpsPollStartMillis >= GPS_POLL_TIMEOUT;
        if (barisLengkap || timeout) {
            if (barisLengkap) parseGpsResponse(gpsResponseBuffer);
            gpsPollState = GPS_POLL_IDLE;
        }
    }
    now = millis();
    if (!gpsRecoveryRunning &&
        now - gpsLastValidResponseMillis >= GPS_NO_RESPONSE_RECOVERY &&
        now - gpsLastRecoveryMillis >= GPS_RECOVERY_COOLDOWN) {
        gpsRecoveryRunning = true;
        gpsLastRecoveryMillis = now;
        gpsPollState = GPS_POLL_IDLE;
        if (xTaskCreatePinnedToCore(gpsRecoveryTask, "GPSRecover", 4096,
                NULL, 1, NULL, 0) != pdPASS) {
            gpsRecoveryRunning = false;
        }
        return;
    }
    // Jangan reset fix jika koordinat sudah di-lock akurat
    if (!gpsIsLocked) {
        if (gpsHasFix && now - gpsLastFixMillis > 45000) gpsHasFix = false;
        if (firstGpsFixSent && gpsLastFixMillis != 0 && now - gpsLastFixMillis > 90000)
            firstGpsFixSent = false;
    }
}

// Bersihkan byte tertunda dari pembaca RFID.
void clearRfidBuffer() {
    unsigned long t = millis();
    while (rd6300Serial.available() > 0 && millis() - t < 40) {
        rd6300Serial.read();
    }
    rd6300ByteCount   = 0;
    rd6300LastByteTime = 0;
    memset(rd6300ByteBuffer, 0, RD6300_BUFFER_SIZE);
}

// Pastikan UID hanya berisi heksadesimal yang valid.
bool isValidRfidUID(const String &uid) {
    int len = uid.length();
    if (len != 10) return false;
    for (size_t i = 0; i < len; i++) {
        char c = uid.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f')))
            return false;
    }
    if (uid == "00000000" || uid == "0000000000" ||
        uid == "FFFFFFFF" || uid == "FFFFFFFFFF") return false;
    return true;
}

// Verifikasi checksum frame RDM6300.
bool validateRDM6300Checksum(const String &frame) {
    if (frame.length() != 12) return false;
    for (size_t i = 0; i < frame.length(); i++) {
        char c = frame.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F'))) return false;
    }
    uint8_t checksum = 0;
    for (int i = 0; i < 10; i += 2) {
        char hexPair[3] = { frame.charAt(i), frame.charAt(i+1), ' ' };
        checksum ^= (uint8_t)strtoul(hexPair, NULL, 16);
    }
    char expectedHex[3] = { frame.charAt(10), frame.charAt(11), ' ' };
    uint8_t expectedChecksum = (uint8_t)strtoul(expectedHex, NULL, 16);
    return (checksum == expectedChecksum);
}

// Ambil UID hanya dari frame RFID lengkap dan valid.
String extractRfidCardID() {
    if (rd6300ByteCount == 0) return "";
    
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
        String frame = "";
        for (int i = stxPos + 1; i < etxPos; i++) {
            char c = (char)rd6300ByteBuffer[i];
            if (c != '\r' && c != '\n') frame += c;
        }
        frame.trim(); frame.toUpperCase();
        if (frame.length() == 12 && validateRDM6300Checksum(frame)) {
            String uid = frame.substring(0, 10);
            if (isValidRfidUID(uid)) return uid;
        }
    }

    // Bersihkan buffer serial noise tanpa membuat ghost card UID palsu
    rd6300ByteCount = 0;

    return "";
}

// Baca serial RFID dan kembalikan UID kartu baru.
String checkRfidSensor() {
    while (rd6300Serial.available() > 0) {
        uint8_t data = rd6300Serial.read();
        rd6300LastByteTime = millis();

        // 1. Deteksi awal frame RDM6300 (STX = 0x02)
        if (data == 0x02) {
            rd6300ByteBuffer[0] = 0x02;
            rd6300ByteCount = 1;
            continue;
        }

        // 2. Kumpulkan byte isi frame jika sudah diawali 0x02
        if (rd6300ByteCount > 0 && rd6300ByteCount < RD6300_BUFFER_SIZE) {
            rd6300ByteBuffer[rd6300ByteCount++] = data;

            // Jika akhir frame (ETX = 0x03) terdeteksi dan panjang pas 14 byte
            if (data == 0x03 && rd6300ByteCount >= 14) {
                String uid = extractRfidCardID();
                rd6300ByteCount = 0;
                if (uid.length() > 0) {
                    return uid;
                }
            }
        }
    }

    // 3. Timeout aman (150 ms): Hanya reset buffer jika transmisi terputus di tengah jalan
    if (rd6300ByteCount > 0 && (millis() - rd6300LastByteTime > 150)) {
        rd6300ByteCount = 0;
    }
    return "";
}

// Ubah state firmware ke nama yang dipahami API.
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
        case STATE_GEOFENCE: return "GEOFENCE";
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

// Buzzer cepat dan tegas (80 ms) - bebas lag
// Bunyi tanda operasi berhasil.
void buzzSuccess() {
    digitalWrite(PIN_BUZZER, HIGH); delay(80);
    digitalWrite(PIN_BUZZER, LOW); 
}

// Bunyi tanda operasi ditolak atau gagal.
void buzzFailed() {
    digitalWrite(PIN_BUZZER, HIGH); delay(60);
    digitalWrite(PIN_BUZZER, LOW);  delay(40);
    digitalWrite(PIN_BUZZER, HIGH); delay(60);
    digitalWrite(PIN_BUZZER, LOW);
}

// Bunyi pendek untuk perpindahan pilihan.
void buzzTick() {
    digitalWrite(PIN_BUZZER, HIGH); delay(15);
    digitalWrite(PIN_BUZZER, LOW);
}

// Bunyi hitung mundur sesuai sisa waktu.
void countdownBeep(int detik) {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(detik <= 3 ? 300 : 60); // Angka 3, 2, 1 bunyi lebih panjang (300 ms)
    digitalWrite(PIN_BUZZER, LOW);
}

// Bersihkan area konten utama TFT.
void clearMainScreenArea() {
    tft.fillRect(0, 42, 480, 228, ELOTO_BG);
    tft.drawRoundRect(8, 49, 464, 212, 6, TFT_DARKGREY);
}

// Gambar aksen pada sudut panel TFT.
void drawCornerAccents(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color) {
    int16_t len = 20;
    tft.drawFastHLine(x, y, len, color);
    tft.drawFastVLine(x, y, len, color);
    tft.drawFastHLine(x + w - len, y, len, color);
    tft.drawFastVLine(x + w - 1, y, len, color);
    tft.drawFastHLine(x, y + h - 1, len, color);
    tft.drawFastVLine(x, y + h - len, len, color);
    tft.drawFastHLine(x + w - len, y + h - 1, len, color);
    tft.drawFastVLine(x + w - 1, y + h - len, len, color);
}

// Gambar garis dekoratif horizontal.
void drawDecorativeLine(int16_t y, uint16_t color) {
    tft.drawFastHLine(60, y, 360, color);
    tft.fillCircle(240, y, 3, color);
    tft.fillCircle(60, y, 2, color);
    tft.fillCircle(420, y, 2, color);
}

// Tampilkan hasil tap kartu beserta foto personel.
void displayCardNotification(String uid, String name, String role, String statusMsg, bool isSuccess) {
    tft.fillRoundRect(14, 54, 452, 204, 8, ELOTO_BG);
    tft.drawRoundRect(14, 54, 452, 204, 8, ELOTO_HEADER);

    tft.fillRect(180, 70, 280, 160, ELOTO_BG);

    tft.setTextDatum(MC_DATUM);
    setStoryFont(12);
    tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
    tft.drawString(statusMsg, 240, 72);

    tft.fillRect(25, 86, 160, 160, ELOTO_BG);
    tft.drawRect(25, 86, 160, 160, ELOTO_TEXT);
    if (!drawPhotoFromAPI(uid, 25, 86, 160, 160)) {
        drawSinglePersonIcon(105, 166, 2.5, ELOTO_HEADER, false);
    }

    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
    drawTextFit(name, 200, 106, 250, ELOTO_HEADER, ELOTO_BG, 9);

    drawTextFit("SID      : " + formatSid(lastScannedSID), 200, 142, 250, ELOTO_TEXT, ELOTO_BG, 9);
    drawTextFit("JABATAN  : " + role, 200, 174, 250, ELOTO_TEXT, ELOTO_BG, 9);
    tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
    tft.drawString("BERHASIL TERVERIFIKASI", 200, 206);
    drawTftFooter("", "");
    
    uint32_t displayDuration = isSuccess ? NOTIFICATION_SUCCESS_DURATION : NOTIFICATION_ERROR_DURATION;
    unsigned long startNotify = millis();
    while (millis() - startNotify < displayDuration) {
        server.handleClient();
        feedGPS();
        clearRfidBuffer();  
        if (millis() - startNotify > 200 && readADKeypadRaw() != KEY_NONE) break;
        delay(5);
    }
    clearRfidBuffer();
    digitalWrite(PIN_BUZZER, LOW);
    // Cooldown tetap aktif agar tidak berulang membaca kartu
    lastRenderedState = STATE_SYSTEM_ERROR;
    needsRedraw = true;
}

// Tampilkan alasan tap kartu ditolak atau belum terverifikasi.
void displayErrorCardPopup(String uid, String title, String name, String role, String sid, String bottomHint) {
    tft.fillRoundRect(14, 54, 452, 204, 8, ELOTO_BG);
    tft.drawRoundRect(14, 54, 452, 204, 8, ELOTO_HEADER);

    tft.fillRect(180, 70, 280, 160, ELOTO_BG);

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
        tft.setTextDatum(MC_DATUM);
        setStoryFont(12);
        tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
        tft.drawString("KARTU TIDAK TERDAFTAR", 240, 110);

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
        clearRfidBuffer(); 
        if (millis() - startNotify > 200 && readADKeypadRaw() != KEY_NONE) break;
        delay(5);
    }
    clearRfidBuffer();
    digitalWrite(PIN_BUZZER, LOW);
    lastRenderedState = STATE_SYSTEM_ERROR;
    needsRedraw = true;
}

// Catat tap petugas BBM dan tampilkan konfirmasinya.
bool handleFuelmanTap(const String &uid, WorkerInfo &card) {
    if (!isFuelmanRole(card.role)) return false;

    bool refuelingEnded = activeFuelmanUID.equalsIgnoreCase(uid);
    if (refuelingEnded) {
        logAuditAsync("REFUEL_END", uid);
        activeFuelmanUID = "";
        activeFuelmanName = "";
    } else {
        activeFuelmanUID = uid;
        activeFuelmanName = card.name;
        logAuditAsync("REFUEL_START", uid);
    }

    buzzSuccess();

    tft.fillRoundRect(14, 54, 452, 204, 8, ELOTO_BG);
    tft.drawRoundRect(14, 54, 452, 204, 8, TFT_GREEN);
    tft.fillRect(180, 70, 280, 160, ELOTO_BG);

    tft.setTextDatum(MC_DATUM);
    setStoryFont(12);
    tft.setTextColor(TFT_GREEN, ELOTO_BG);
    tft.drawString(refuelingEnded ? "PENGISIAN SELESAI" : "PENGISIAN BBM", 240, 72);

    tft.fillRect(25, 86, 160, 160, ELOTO_BG);
    tft.drawRect(25, 86, 160, 160, TFT_GREEN);
    if (!drawPhotoFromAPI(uid, 25, 86, 160, 160)) {
        drawSinglePersonIcon(105, 166, 2.5, TFT_GREEN, false);
    }

    tft.setTextDatum(TL_DATUM);
    setStoryFont(9);
    tft.setTextColor(TFT_GREEN, ELOTO_BG);
    drawTextFit(card.name, 200, 106, 250, TFT_GREEN, ELOTO_BG, 9);
    tft.setTextColor(TFT_WHITE, ELOTO_BG);
    drawTextFit("SID      : " + formatSid(card.sid), 200, 138, 250, TFT_WHITE, ELOTO_BG, 9);
    drawTextFit("JABATAN  : PETUGAS BBM", 200, 166, 250, TFT_WHITE, ELOTO_BG, 9);
    drawTextFit(refuelingEnded ? "STATUS   : SELESAI" : "STATUS   : PENGISIAN BBM",
        200, 194, 250, TFT_GREEN, ELOTO_BG, 9);

    drawTftFooter("", "");

    unsigned long startNotify = millis();
    while (millis() - startNotify < 1200) {
        server.handleClient();
        feedGPS();
        delay(5);
    }
    clearRfidBuffer();
    digitalWrite(PIN_BUZZER, LOW);
    lastRenderedState = STATE_SYSTEM_ERROR;
    needsRedraw = true;
    saveSessionToSD();
    return true;
}

// Pulihkan antrean bila susunan personel tidak konsisten.
void sanitizeQueueDeadlock() {
    if (safetyQueue.topIndex < 0) return;
    bool changed = false;
    for (int i = 1; i <= safetyQueue.topIndex; i++) {
        String uid = normalizeRfidUid(safetyQueue.workers[i].uid);
        bool duplicate = uid.length() == 0;
        for (int j = 0; j < i && !duplicate; j++) {
            duplicate = uid.equalsIgnoreCase(normalizeRfidUid(safetyQueue.workers[j].uid));
        }
        if (duplicate) {
            for (int j = i; j < safetyQueue.topIndex; j++) {
                safetyQueue.workers[j] = safetyQueue.workers[j + 1];
            }
            safetyQueue.workers[safetyQueue.topIndex] = WorkerInfo();
            safetyQueue.topIndex--;
            i--;
            changed = true;
        }
    }
    if (changed) rebuildCachedQueueString();
}

// Bangun ulang ringkasan antrean untuk tampilan.
void rebuildCachedQueueString() {
    cachedQueueList = "";
    cachedQueueList.reserve(512);
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

// Simpan sesi cepat tanpa membaca ulang seluruh JSON (anti-lag)
// Simpan status sesi dan antrean ke kartu SD.
void saveSessionToSD() {
    if (!sdCardMounted || sdMutex == NULL) return;
    if (takeSd(pdMS_TO_TICKS(150), "session-save") == pdTRUE) {
        const char *active = "/session.json";
        const char *temporary = "/session.json.tmp";
        const char *backup = "/session.json.bak";
        if (recoverSdFile(active, temporary, backup)) {
            File sessionFile = SD.open(temporary, FILE_WRITE);
            if (sessionFile) {
                DynamicJsonDocument doc(4096);
                doc["state"]               = (int)(currentState == STATE_GEOFENCE ? STATE_MENU : currentState);
                doc["spv_uid"]             = supervisorUID;
                doc["spv_sid"]             = safetyQueue.topIndex >= 0 ? safetyQueue.workers[0].sid : "-----";
                doc["spv_name"]            = supervisorName;
                doc["spv_role"]            = supervisorRole;
                doc["target_count"]        = targetMekanikCount;
                doc["top_index"]           = safetyQueue.topIndex;
                doc["is_session_active"]   = isSessionActive;
                doc["session_elapsed_ms"]  = isSessionActive ? (millis() - sessionStartTime) : 0;
                doc["is_adding_from_menu"] = isAddingFromMenu;
                doc["worker_list_from_menu"] = workerListFromMenu;
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
                if (doc.overflowed()) {
                    sessionFile.close();
                    SD.remove(temporary);
                } else {
                    size_t expected = measureJson(doc);
                    size_t written = serializeJson(doc, sessionFile);
                    sessionFile.flush();
                    sessionFile.close();

                    bool valid = (expected > 0 && written == expected);
                    if (valid) commitSdFile(active, temporary, backup);
                }
            }
        }
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
    }
}

// Hapus berkas sesi tersimpan dari kartu SD.
void clearSessionFromSD() {
    if (!sdCardMounted || sdMutex == NULL) return;
    if (takeSd(pdMS_TO_TICKS(150), "session-clear") == pdTRUE) {
        bool backupCleared = !SD.exists("/session.json.bak") || SD.remove("/session.json.bak");
        bool temporaryCleared = !SD.exists("/session.json.tmp") || SD.remove("/session.json.tmp");
        if (backupCleared && temporaryCleared) {
            SD.remove("/session.json");
        }
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
    }
}

// Pulihkan sesi dan antrean dari kartu SD.
bool loadSessionFromSD() {
    if (!sdCardMounted || sdMutex == NULL) return false;
    bool success = false;

    if (takeSd(pdMS_TO_TICKS(200), "session-load") == pdTRUE) {
        recoverSdFile("/session.json", "/session.json.tmp", "/session.json.bak");
        if (SD.exists("/session.json")) {
            File sessionFile = SD.open("/session.json", FILE_READ);
            if (sessionFile) {
                DynamicJsonDocument doc(4096);
                DeserializationError err = deserializeJson(doc, sessionFile);
                sessionFile.close();

                if (!err) {
                    int stateInt = doc["state"] | STATE_IDLE;
                    JsonArray q = doc["queue"].as<JsonArray>();
                    bool validQueue = !q.isNull() && q.size() <= MAX_WORKERS &&
                                        stateInt >= STATE_BOOT_IP && stateInt <= STATE_WELCOME;
                    for (JsonVariant item : q) {
                        if (!item.is<JsonObject>() || item["uid"].as<String>().length() == 0) {
                            validQueue = false;
                            break;
                        }
                    }
                    if (validQueue && q.size() > 0 &&
                        !checkIsSupervisorRole(q[0]["role"].as<String>())) validQueue = false;
                    
                    if (validQueue) {
                        currentState = (SystemState)stateInt;

                        supervisorUID      = doc["spv_uid"].as<String>();
                        String savedSupervisorSid = doc["spv_sid"] | "-----";
                        supervisorName     = doc["spv_name"].as<String>();
                        supervisorRole     = doc["spv_role"].as<String>();
                        targetMekanikCount = doc["target_count"] | 0;
                        safetyQueue.topIndex = (int)q.size() - 1;
                        
                        isAddingFromMenu   = doc["is_adding_from_menu"] | false;
                        workerListFromMenu = doc["worker_list_from_menu"] | false;
                        selectedWorkerIndex = doc["selected_worker_idx"] | 0;
                        selectedMenuIndex  = doc["selected_menu_idx"] | 0;
                        selectedFooterAction = doc["selected_footer"] | 0;
                        lastMekanikDisplayCount = doc["mekanik_display"] | -99;
                        initialMekanikOutCount  = doc["mekanik_init_out"] | -1;
                        activeFuelmanUID   = doc["fuelman_uid"] | "";
                        activeFuelmanName  = doc["fuelman_name"] | "";
                        lastScannedUID     = doc["last_scanned_uid"] | "---";
                        lastScannedSID     = doc["last_scanned_sid"] | "-----";

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
                        if (currentState == STATE_MEKANIK_OUT && safetyQueue.topIndex == 0) {
                            currentState = STATE_WAIT_SPV_OUT;
                        }
                        if (safetyQueue.topIndex >= 0) {
                            supervisorUID = safetyQueue.workers[0].uid;
                            supervisorName = safetyQueue.workers[0].name;
                            supervisorRole = safetyQueue.workers[0].role;
                        }
                        rebuildCachedQueueString();
                        targetMekanikCount = constrain((int)targetMekanikCount, 0, MAX_WORKERS - countQueueSupervisors());
                        selectedWorkerIndex = constrain((int)selectedWorkerIndex, 0, max(0, (int)safetyQueue.topIndex));
                        selectedMenuIndex = constrain((int)selectedMenuIndex, 0, 3);
                        selectedFooterAction = constrain((int)selectedFooterAction, 0, currentState == STATE_WORKER_LIST ? 2 : 1);

                        bool savedSessionActive = doc["is_session_active"] | false;
                        unsigned long savedElapsed = doc["session_elapsed_ms"] | 0UL;

                        if (savedSessionActive && stateInt >= STATE_WAIT_SPV_IN && stateInt <= STATE_ALL_WORKERS_OUT) {
                            isSessionActive = true;
                            sessionStartTime = millis() - savedElapsed;
                        } else {
                            isSessionActive = false;
                            sessionStartTime = 0;
                            currentState = STATE_WELCOME; // Jangan biarkan boot terjebak di offline jika sesi lama sudah selesai
                            selectedFooterAction = 1;
                        }

                        if (isSessionActive && currentState == STATE_WAIT_SPV_IN &&
                            !isAddingFromMenu && safetyQueue.topIndex == 0 &&
                            isQueueSupervisor(0) &&
                            supervisorUID.equalsIgnoreCase(safetyQueue.workers[0].uid)) {
                            currentState = STATE_SUPERVISOR_VALID;
                            selectedFooterAction = 1;
                            Serial.println("[SESSION] Restored supervisor already tapped; continuing at confirmation");
                        }

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
        } 
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
    } 
    return success;
}

// Muat daftar personel SD ke cache RAM.
void loadUsersToRAM() {
    if (!sdCardMounted || sdMutex == NULL) return;
    if (takeSd(pdMS_TO_TICKS(200), "users-ram-load") == pdTRUE) {
        bool usersReady = recoverSdFile("/users.csv", "/USERS.TMP", "/USERS.BAK");
        usersReady = recoverSdFile("/users.csv", "/U.TMP", "/U.BAK") && usersReady;
        usersReady = recoverSdFile("/users.csv", "/foto/CACHE.TMP", "/users.bak") && usersReady;
        usersReady = recoverSdFile("/users.csv", "/users.csv.tmp", "/users.csv.bak") && usersReady;
        if (usersReady && !SD.exists("/users.csv")) {
            ramUserCount = 0;
            sdUserCount = 0;
        }
        if (usersReady && SD.exists("/users.csv")) {
            File userFile = SD.open("/users.csv", FILE_READ);
            if (userFile) {
                ramUserCount = 0;
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
                            int p4 = line.indexOf(',', p3 + 1);
                            ramUserCache[ramUserCount].sid = (p4 != -1) ? line.substring(p4 + 1) : "";
                            ramUserCache[ramUserCount].sid.trim();
                            ramUserCache[ramUserCount].isSpv = checkIsSupervisorRole(ramUserCache[ramUserCount].role);
                            ramUserCache[ramUserCount].isRegistered = true;
                            ramUserCache[ramUserCount].isAssigned = true;
                            ramUserCount++;
                        }
                    }
                }
                userFile.close();
                sdUserCount = ramUserCount;
            }
        }
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
    }
}

// Tambahkan personel terverifikasi ke antrean LOTO.
bool pushQueue(String uid, String sid, String name, String role) {
    if (safetyQueue.topIndex >= MAX_WORKERS - 1) return false;
    
    String normalized = normalizeRfidUid(uid);
    for (int i = 0; i <= safetyQueue.topIndex; i++) {
        if (normalizeRfidUid(safetyQueue.workers[i].uid) == normalized) {
            return false;
        }
    }

    safetyQueue.topIndex++;
    WorkerInfo &entry = safetyQueue.workers[safetyQueue.topIndex];
    entry.uid = uid;
    entry.sid = sid;
    entry.name = name;
    entry.role = normalizeUserRole(role);
    entry.isSpv = checkIsSupervisorRole(entry.role);
    entry.isRegistered = true;

    int maxMechanics = MAX_WORKERS - countQueueSupervisors();
    if (targetMekanikCount > maxMechanics) targetMekanikCount = maxMechanics;
    rebuildCachedQueueString();
    saveSessionToSD();
    forceFullRedraw = true;
    needsRedraw = true;
    return true;
}

// Hapus personel tertentu dari antrean LOTO.
void removeQueueAt(int index) {
    if (index < 0 || index > safetyQueue.topIndex) return;
    for (int i = index; i < safetyQueue.topIndex; i++) {
        safetyQueue.workers[i] = safetyQueue.workers[i + 1];
    }
    safetyQueue.workers[safetyQueue.topIndex].uid = "";
    safetyQueue.workers[safetyQueue.topIndex].name = "";
    safetyQueue.workers[safetyQueue.topIndex].role = "";
    safetyQueue.topIndex--;
    
    rebuildCachedQueueString();
    saveSessionToSD();
    forceFullRedraw = true;
    needsRedraw = true;
}

// Cari posisi personel berdasarkan UID kartu.
int findWorkerIndex(String uid) {
    String cleanUid = normalizeRfidUid(uid);
    for (int i = 0; i <= safetyQueue.topIndex; i++) {
        if (normalizeRfidUid(safetyQueue.workers[i].uid).equalsIgnoreCase(cleanUid)) return i;
    }
    return -1;
}

// Sinkronkan personel backend ke RAM dan SD.
bool syncDatabaseToSDCard() {
    sdSyncOk = false;
    const uint32_t MIN_SYNC_HEAP = 18000;
    if (!sdCardMounted || WiFi.status() != WL_CONNECTED || sdMutex == NULL || ESP.getFreeHeap() < MIN_SYNC_HEAP) {
        Serial.printf("[SD_SYNC] Not ready sd=%d wifi=%d mutex=%d heap=%u\n",
            sdCardMounted, WiFi.status() == WL_CONNECTED, sdMutex != NULL, ESP.getFreeHeap());
        return false;
    }

    WiFiClient client; client.setTimeout(8000);
    HTTPClient http;
    http.begin(client, getApiUrl("users"));
    http.addHeader("User-Agent", "ESP32-E-LOTO/5.0");
    http.addHeader("X-Device-Id", getDeviceId());
    http.addHeader("Accept", "application/json");
    http.setTimeout(8000);

    int httpCode = http.GET();
    if (httpCode != HTTP_CODE_OK) {
        Serial.printf("[SD_SYNC] GET users failed HTTP=%d url=%s\n", httpCode, getApiUrl("users").c_str());
        http.end();
        return false;
    }

    String csvPayload;
    String photoUidPayload;
    size_t backendUserCount = 0;
    int syncCount = 0;
    size_t documentMemory = 0;
    DeserializationError err;
    {
        DynamicJsonDocument filter(512);
        filter["success"] = true;
        filter["data"][0]["rfid_uid"] = true;
        filter["data"][0]["rfidUid"] = true;
        filter["data"][0]["sid"] = true;
        filter["data"][0]["nama"] = true;
        filter["data"][0]["role"] = true;
        DynamicJsonDocument doc(8192);
        err = deserializeJson(doc, http.getStream(), DeserializationOption::Filter(filter));
        documentMemory = doc.memoryUsage();
        if (err || doc["success"] != true || !doc["data"].is<JsonArray>()) {
            Serial.printf("[SD_SYNC] Invalid users response error=%s capacity=%u heap=%u\n",
                err ? err.c_str() : "unexpected response", (unsigned int)documentMemory, ESP.getFreeHeap());
            http.end();
            return false;
        }

        JsonArray arr = doc["data"].as<JsonArray>();
        backendUserCount = arr.size();
        for (JsonObject u : arr) {
            String uid = "";
            if (u.containsKey("rfidUid") && !u["rfidUid"].isNull()) uid = u["rfidUid"].as<String>();
            else if (u.containsKey("rfid_uid") && !u["rfid_uid"].isNull()) uid = u["rfid_uid"].as<String>();
            uid = normalizeRfidUid(uid);
            if (uid.length() == 0 || uid == "NULL") continue;
            bool duplicateUid = false;
            int rowStart = 0;
            while (rowStart < (int)csvPayload.length()) {
                int rowEnd = csvPayload.indexOf('\n', rowStart);
                if (rowEnd < 0) rowEnd = csvPayload.length();
                int uidEnd = csvPayload.indexOf(',', rowStart);
                if (uidEnd >= rowStart && uidEnd < rowEnd &&
                    csvPayload.substring(rowStart, uidEnd).equalsIgnoreCase(uid)) {
                    duplicateUid = true;
                    break;
                }
                rowStart = rowEnd + 1;
            }
            if (duplicateUid) {
                Serial.printf("[SD_SYNC] Duplicate backend UID ignored uid=%s\n", uid.c_str());
                continue;
            }

            String name = u["nama"] | "UNKNOWN";
            String role = u["role"] | "MEKANIK";
            String sid = u["sid"] | "";
            name.replace(",", " ");
            role.replace(",", " ");
            role.toUpperCase();
            sid.trim();
            bool isSpv = checkIsSupervisorRole(role);
            csvPayload += uid + "," + name + "," + role + "," + String(isSpv ? 1 : 0) + "," + sid + "\n";
            photoUidPayload += uid + "|" + sid + "\n";
            syncCount++;
        }
    }
    http.end();
    Serial.printf("[SD_SYNC] Users response parsed error=none backend_users=%u cards_with_uid=%d json_bytes=%u heap_after_json_release=%u\n",
        (unsigned int)backendUserCount, syncCount, (unsigned int)documentMemory, ESP.getFreeHeap());
    if (syncCount == 0) {
        Serial.printf("[SD_SYNC] Backend has no usable card UIDs; keeping /users.csv (users=%u)\n",
            (unsigned int)backendUserCount);
        return false;
    }

    bool synced = false;
    bool writeOk = true;
    if (takeSd(pdMS_TO_TICKS(250), "users-sync") == pdTRUE) {
        const char *active = "/users.csv";
        const char *temporary = "/U.TMP";
        const char *backup = "/U.BAK";
        setSdLockStage("users-recover");
        bool recovered = recoverSdFile(active, temporary, backup);
        if (recovered) {
            setSdLockStage("users-open-temp");
            File userFile = SD.open(temporary, FILE_WRITE);
            if (userFile) {
                size_t expectedBytes = csvPayload.length();
                setSdLockStage("users-write");
                writeOk = userFile.print(csvPayload) == expectedBytes;
                setSdLockStage("users-flush");
                userFile.flush();
                userFile.close();

                setSdLockStage("users-verify");
                File verifyFile = SD.open(temporary, FILE_READ);
                size_t actualBytes = verifyFile ? verifyFile.size() : 0;
                bool valid = writeOk && syncCount > 0 && verifyFile && actualBytes == expectedBytes;
                if (verifyFile) verifyFile.close();
                if (valid) {
                    setSdLockStage("users-commit");
                    synced = commitSdFile(active, temporary, backup);
                }
                else Serial.printf("[SD_SYNC] Temporary users file invalid write=%d cards=%d expected=%u actual=%u\n",
                    writeOk, syncCount, (unsigned int)expectedBytes,
                    (unsigned int)actualBytes);
            } else Serial.printf("[SD_SYNC] Cannot create temp file path=%s card_type=%u heap=%u total=%llu used=%llu root=%d foto=%d\n",
                temporary,
                SD.cardType(), ESP.getFreeHeap(), (unsigned long long)SD.totalBytes(),
                (unsigned long long)SD.usedBytes(), SD.exists("/"), SD.exists("/foto"));
        } else Serial.println("[SD_SYNC] Cannot recover SD users transaction files");
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
    } else {
        Serial.println("[SD_SYNC] Could not acquire SD/SPI locks; see SD_LOCK timeout stage");
    }

    if (synced) {
        loadUsersToRAM();
        sdUserCount = syncCount;
    } else {
        Serial.printf("[SD_SYNC] Cache update failed; old users.csv preserved (cards=%d write=%d heap=%u)\n",
            syncCount, writeOk, ESP.getFreeHeap());
    }

    Serial.printf("[SD_SYNC] Starting photo cache independently users_cache=%d cards=%d\n",
        synced, syncCount);
    bool photosSynced = syncPersonnelPhotosToSDCard(photoUidPayload);
    sdSyncOk = synced && photosSynced;
    Serial.printf("[SD_SYNC] Complete users_cache=%d photos_ok=%d RAM=%d heap=%u\n",
        synced, photosSynced, ramUserCount, ESP.getFreeHeap());
    sdSyncOk = synced;
    return sdSyncOk;
}

// Cache foto backend sebagai best-effort; foto tidak boleh memblokir mode online utama.
bool syncPersonnelPhotosToSDCard(const String &uids) {
    bool allPhotosSynced = true;
    int cachedCount = 0, missingCount = 0, failedCount = 0, uidStart = 0;
    const uint32_t MIN_PHOTO_SYNC_HEAP = 18000;

    while (uidStart < (int)uids.length()) {
        int uidEnd = uids.indexOf('\n', uidStart);
        if (uidEnd < 0) uidEnd = uids.length();
        String entry = uids.substring(uidStart, uidEnd);
        int separator = entry.indexOf('|');
        String uid = separator >= 0 ? entry.substring(0, separator) : entry;
        String sid = separator >= 0 ? entry.substring(separator + 1) : "";
        uid.trim(); uid.toUpperCase(); sid = formatSid(sid);
        uidStart = uidEnd + 1;
        if (uid.length() < 4 || uid.length() > 20 || sid == "-----") continue;

        bool offlineSkip = WiFi.status() != WL_CONNECTED;
        bool heapSkip = ESP.getFreeHeap() < MIN_PHOTO_SYNC_HEAP;
        if (offlineSkip || heapSkip) {
            Serial.printf("[PHOTO_SYNC] Skipped uid=%s wifi=%d heap=%u reason=%s\n",
                uid.c_str(), WiFi.status() == WL_CONNECTED, ESP.getFreeHeap(),
                offlineSkip ? "wifi-offline" : "low-heap");
            if (!offlineSkip) {
                allPhotosSynced = false;
                failedCount++;
            }
            continue;
        }

        WiFiClient client;
        client.setTimeout(2500);
        HTTPClient http;
        String photoUrl = getApiUrl("users/photo/") + uid + "?size=160&quality=78";
        http.begin(client, photoUrl);
        http.addHeader("X-Device-Id", getDeviceId());
        http.setTimeout(3500);
        int code = http.GET();
        int length = code == HTTP_CODE_OK ? http.getSize() : -1;
        if (code == HTTP_CODE_NOT_FOUND) {
            missingCount++;
            http.end();
            if (!removeCachedPhotoFromSD(uid, sid)) {
                allPhotosSynced = false;
                failedCount++;
                Serial.printf("[PHOTO_SYNC] Could not remove stale SD photo uid=%s\n", uid.c_str());
            }
            continue;
        } else if (code == HTTP_CODE_OK && length > 100 && length <= 40000 &&
            ESP.getFreeHeap() > (uint32_t)length + PHOTO_DOWNLOAD_HEAP_RESERVE) {
            uint8_t *jpegData = static_cast<uint8_t *>(malloc((size_t)length));
            if (jpegData != NULL) {
                WiFiClient *stream = http.getStreamPtr();
                size_t received = stream->readBytes(jpegData, (size_t)length);
                bool validJpeg = received == (size_t)length &&
                    jpegData[0] == 0xFF && jpegData[1] == 0xD8;
                http.end();
                bool saved = validJpeg && cachePhotoToSD(uid, sid, jpegData, received);
                free(jpegData);
                if (saved) cachedCount++;
                else {
                    Serial.printf("[PHOTO_SYNC] Cache failed uid=%s sid=%s bytes=%u\n",
                        uid.c_str(), sid.c_str(), (unsigned int)received);
                    allPhotosSynced = false;
                    failedCount++;
                }
                continue;
            }
            http.end();
            allPhotosSynced = false;
            failedCount++;
            Serial.printf("[PHOTO_SYNC] Allocation failed uid=%s bytes=%d heap=%u\n",
                uid.c_str(), length, ESP.getFreeHeap());
            continue;
        } else {
            allPhotosSynced = false;
            failedCount++;
            const char *reason = code != HTTP_CODE_OK ? "http" :
                (length <= 100 || length > 40000 ? "invalid-size" : "low-heap");
            Serial.printf("[PHOTO_SYNC] Download failed uid=%s HTTP=%d bytes=%d heap=%u reserve=%u reason=%s\n",
                uid.c_str(), code, length, ESP.getFreeHeap(),
                PHOTO_DOWNLOAD_HEAP_RESERVE, reason);
        }
        http.end();
    }

    Serial.printf("[PHOTO_SYNC] Complete cached=%d without_photo=%d failed=%d\n",
        cachedCount, missingCount, failedCount);
    return allPhotosSynced;
}

// Cari personel berdasarkan UID di berkas SD.
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
    
    if (takeSd(pdMS_TO_TICKS(200), "users-cache-read") == pdTRUE) {
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
                            int p4 = line.indexOf(',', p3 + 1);
                            if (p4 != -1) card.sid = line.substring(p4 + 1);
                            else card.sid = "";
                            card.sid.trim();
                            card.isSpv = checkIsSupervisorRole(fileRole);
                            card.isRegistered = (fileName != "UNKNOWN" && fileName != "Tidak Terdaftar");
                            userFile.close();
                            digitalWrite(SD_CS_PIN, HIGH);
                            giveSd();
                            return card;
                        }
                    }
                }
            }
            userFile.close();
        }
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
    }
    return card;
}

// Simpan event yang belum terkirim agar dapat dicoba ulang.
void saveOfflineLogToSDCard(String event, String uid, const String &eventId) {
    if (!sdCardMounted || sdMutex == NULL) return;
    if (takeSd(pdMS_TO_TICKS(500), "offline-log-save") != pdTRUE) {
        Serial.printf("[OFFLINE_SAVE] Failed to lock SD event=%s uid=%s; event was not persisted\n",
            event.c_str(), uid.c_str());
        return;
    }
    File logFile = SD.open("/offline_logs.csv", FILE_APPEND);
    bool fileOpened = (bool)logFile;
    bool saved = false;
    size_t written = 0;
    size_t expected = 0;
    if (logFile) {
        String latitude = hasValidGpsFix() ? String(currentLatitude, 6) : "";
        String longitude = hasValidGpsFix() ? String(currentLongitude, 6) : "";
        String stableId = eventId.length() > 0 ? eventId :
                            "off-" + String(millis()) + "-" + String(random(0x7fffffff), HEX);
        String record = stableId + "," + event + "," + uid + "," + latitude + "," + longitude;
        expected = record.length() + 2;
        written = logFile.println(record);
        logFile.flush();
        saved = written == expected;
        logFile.close();
    }
    digitalWrite(SD_CS_PIN, HIGH);
    giveSd();
    if (!saved) Serial.printf("[OFFLINE_SAVE] Append failed event=%s uid=%s written=%u expected=%u file_open=%d\n",
        event.c_str(), uid.c_str(), (unsigned int)written, (unsigned int)expected, fileOpened);
    else Serial.printf("[OFFLINE_SAVE] Persisted event=%s uid=%s bytes=%u\n",
        event.c_str(), uid.c_str(), (unsigned int)written);
}

// Upload offline logs tanpa menyandera mutex SD Card selama HTTP POST
// Kirim ulang antrean event offline ke backend.
void uploadOfflineLogsSDCard() {
    if (!sdCardMounted || WiFi.status() != WL_CONNECTED || sdMutex == NULL) return;
    const size_t MAX_OFFLINE_SNAPSHOT_BYTES = 8192;
    if (ESP.getFreeHeap() < 30000) return;
    if (takeSd(pdMS_TO_TICKS(300), "offline-log-upload") != pdTRUE) return;

    const char *active = "/offline_logs.csv";
    const char *temporary = "/offline_logs.csv.tmp";
    const char *backup = "/offline_logs.csv.bak";
    String snapshot;
    if (!recoverSdFile(active, temporary, backup) || !SD.exists(active)) {
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
        return;
    }

    File logFile = SD.open(active, FILE_READ);
    if (!logFile) {
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
        Serial.println("[OFFLINE_SYNC] Cannot open offline log; keeping file unchanged");
        return;
    }
    size_t snapshotBytes = logFile.size();
    size_t bytesToRead = snapshotBytes < MAX_OFFLINE_SNAPSHOT_BYTES
        ? snapshotBytes : MAX_OFFLINE_SNAPSHOT_BYTES;
    if (snapshotBytes == 0 || ESP.getFreeHeap() < bytesToRead + 20000) {
        logFile.close();
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
        return;
    }
    snapshot.reserve(bytesToRead + 1);
    while (logFile.available() && snapshot.length() < bytesToRead) {
        snapshot += (char)logFile.read();
    }
    bool snapshotReadOk = snapshot.length() == bytesToRead;
    logFile.close();
    digitalWrite(SD_CS_PIN, HIGH);
    giveSd();
    if (!snapshotReadOk) {
        Serial.printf("[OFFLINE_SYNC] Snapshot read incomplete expected=%u actual=%u; keeping file unchanged\n",
            (unsigned int)snapshotBytes, (unsigned int)snapshot.length());
        return;
    }
    if (snapshotBytes > bytesToRead) {
        int lastCompleteLine = snapshot.lastIndexOf('\n');
        if (lastCompleteLine < 0) snapshot.remove(0);
        else snapshot.remove(lastCompleteLine + 1);
        if (snapshot.length() == 0) {
            Serial.printf("[OFFLINE_SYNC] No complete record in bounded batch bytes=%u; retaining log\n",
                (unsigned int)bytesToRead);
            return;
        }
        Serial.printf("[OFFLINE_SYNC] Processing bounded batch selected=%u total=%u; remaining records retained\n",
            (unsigned int)snapshot.length(), (unsigned int)snapshotBytes);
    }

    String deliveredIds;
    deliveredIds.reserve(snapshotBytes + 1);
    size_t cursor = 0;
    bool stopped = false;
    int deliveredCount = 0;
    while (cursor < snapshot.length()) {
        int lineEnd = snapshot.indexOf('\n', cursor);
        if (lineEnd < 0) lineEnd = snapshot.length();
        String line = snapshot.substring(cursor, lineEnd);
        line.trim();
        cursor = (size_t)lineEnd + 1;
        if (line.length() == 0) continue;

        int p1 = line.indexOf(',');
        int p2 = p1 >= 0 ? line.indexOf(',', p1 + 1) : -1;
        int p3 = p2 >= 0 ? line.indexOf(',', p2 + 1) : -1;
        if (stopped || p1 <= 0 || p2 <= p1 + 1) {
            stopped = true;
            continue;
        }

        String originalId = line.substring(0, p1);
        String eventId = originalId;
        String event = line.substring(p1 + 1, p2);
        String uid = line.substring(p2 + 1, p3 >= 0 ? p3 : line.length());
        int p4 = p3 >= 0 ? line.indexOf(',', p3 + 1) : -1;
        String latitude = p3 >= 0 ? line.substring(p3 + 1, p4 >= 0 ? p4 : line.length()) : "";
        String longitude = p4 >= 0 ? line.substring(p4 + 1) : "";
        uid.trim(); latitude.trim(); longitude.trim();

        bool legacyId = eventId.length() > 0;
        for (size_t i = 0; i < eventId.length(); i++) {
            if (eventId[i] < '0' || eventId[i] > '9') legacyId = false;
        }
        if (legacyId) {
            uint32_t hash = 2166136261UL;
            for (size_t i = 0; i < line.length(); i++) {
                hash = (hash ^ (uint8_t)line[i]) * 16777619UL;
            }
            eventId = "legacy-" + getDeviceId() + "-" + String(hash, HEX);
        }

        DynamicJsonDocument doc(512);
        doc["event_id"] = eventId;
        doc["id_box"] = getDeviceId();
        doc["event"] = event;
        doc["uid"] = uid;
        doc["last_uid"] = uid;
        doc["is_tap"] = isTapEventName(event);
        doc["is_register_scan"] = event.indexOf("REGISTER_NEW_CARD") != -1;
        doc["is_online"] = true;
        doc["replay"] = true;
        if (latitude.length() > 0 && longitude.length() > 0) {
            doc["lat"] = latitude.toDouble();
            doc["lon"] = longitude.toDouble();
            doc["lng"] = longitude.toDouble();
            doc["gps_fix"] = true;
        }
        if (doc.overflowed()) {
            stopped = true;
            continue;
        }

        String payload;
        serializeJson(doc, payload);
        WiFiClient client;
        client.setTimeout(2000);
        HTTPClient http;
        http.begin(client, getApiUrl("boxes/") + getDeviceIdPath() + "/telemetry");
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Device-Id", getDeviceId());
        http.setTimeout(3000);
        int httpCode = http.POST(payload);
        http.end();
        if (httpCode >= 200 && httpCode < 300) {
            deliveredIds += "\n" + originalId + "\n";
            deliveredCount++;
        } else {
            Serial.printf("[OFFLINE_SYNC] Replay stopped HTTP=%d event_id=%s; remaining records retained\n",
                httpCode, originalId.c_str());
            stopped = true;
        }
    }

    if (deliveredCount == 0) return;
    if (takeSd(pdMS_TO_TICKS(1000), "offline-log-commit") != pdTRUE) {
        Serial.printf("[OFFLINE_SYNC] Delivered %d records but could not lock SD to prune them; safe replay may occur\n",
            deliveredCount);
        return;
    }

    bool committed = false;
    if (recoverSdFile(active, temporary, backup) && SD.exists(active)) {
        File currentFile = SD.open(active, FILE_READ);
        File pendingFile = SD.open(temporary, FILE_WRITE);
        bool writeOk = currentFile && pendingFile;
        size_t pendingBytes = 0;
        if (writeOk) {
            while (currentFile.available()) {
                String line = currentFile.readStringUntil('\n');
                line.trim();
                if (line.length() == 0) continue;
                int comma = line.indexOf(',');
                String id = comma > 0 ? line.substring(0, comma) : "";
                if (id.length() > 0 && deliveredIds.indexOf("\n" + id + "\n") >= 0) continue;
                size_t written = pendingFile.print(line) + pendingFile.write('\n');
                if (written != line.length() + 1) {
                    writeOk = false;
                    break;
                }
                pendingBytes += written;
            }
        }
        if (currentFile) currentFile.close();
        if (pendingFile) {
            pendingFile.flush();
            pendingFile.close();
        }
        File verifyFile = SD.open(temporary, FILE_READ);
        bool valid = writeOk && verifyFile && verifyFile.size() == pendingBytes;
        if (verifyFile) verifyFile.close();
        if (valid) {
            if (pendingBytes == 0) {
                committed = SD.remove(active) && SD.remove(temporary);
            } else {
                committed = commitSdFile(active, temporary, backup);
            }
        }
    }
    digitalWrite(SD_CS_PIN, HIGH);
    giveSd();
    if (committed) Serial.printf("[OFFLINE_SYNC] Uploaded and pruned %d records; unsent records retained\n", deliveredCount);
    else Serial.printf("[OFFLINE_SYNC] Uploaded %d records but could not safely prune SD log; records retained\n", deliveredCount);
}

bool requestSdStorageJob(uint32_t jobs) {
    if (sdStorageWorkerHandle == NULL) {
        Serial.printf("[SD_WORKER] Request rejected; worker unavailable jobs=0x%08lx\n",
            (unsigned long)jobs);
        return false;
    }
    if (xTaskNotify(sdStorageWorkerHandle, jobs, eSetBits) != pdPASS) {
        Serial.printf("[SD_WORKER] Request enqueue failed jobs=0x%08lx\n",
            (unsigned long)jobs);
        return false;
    }
    return true;
}

void sdStorageWorkerTask(void *unused) {
    for (;;) {
        uint32_t jobs = 0;
        if (xTaskNotifyWait(0, UINT32_MAX, &jobs, portMAX_DELAY) != pdTRUE) continue;
        if ((jobs & SD_JOB_PERSONNEL_SYNC) != 0) {
            Serial.println("[SD_WORKER] Personnel cache job started");
            bool synced = syncDatabaseToSDCard();
            Serial.printf("[SD_WORKER] Personnel cache job finished users_and_photos=%d\n", synced);
        }
        if ((jobs & SD_JOB_OFFLINE_UPLOAD) != 0) {
            uploadOfflineLogsSDCard();
        }
    }
}

// Pembacaan kartu instan: RAM langsung diakses tanpa ambil mutex SD!
// Verifikasi UID dari cache, SD, lalu API backend.
bool deviceHasNetwork() {
    return WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0";
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
    card.lookupUnavailable = false;

    String cleanUID = normalizeRfidUid(uid);
    String decPadded = hexToDecStringPadded(cleanUID);
    String decUnpadded = hexToDecStringUnpadded(cleanUID);

    // The backend is authoritative whenever reachable; local caches are offline-only.
    bool lookupUnavailable = false;
    bool backendConfirmedMissing = false;
    bool offlineFallbackAllowed = false;
    if (deviceHasNetwork() && server_host.length() == 0) discoverServer();
    bool wifiConnected = deviceHasNetwork();
    bool backendConfigured = server_host.length() > 0;
    if (wifiConnected && backendConfigured && ESP.getFreeHeap() > MIN_HEAP_TO_VERIFY_CARD) {
        WiFiClient client; client.setTimeout(2000);
        HTTPClient http;
        http.begin(client, getApiUrl("users/check-card"));
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Device-Id", getDeviceId());
        http.setTimeout(3000);
        DynamicJsonDocument requestDoc(256);
        requestDoc["rfid_uid"] = cleanUID;
        String requestBody;
        serializeJson(requestDoc, requestBody);

        int httpCode = http.POST(requestBody);
        Serial.printf("[RFID] Online card lookup uid=%s HTTP=%d url=%s\n",
            cleanUID.c_str(), httpCode, getApiUrl("users/check-card").c_str());
        if (httpCode == HTTP_CODE_OK) {
            DynamicJsonDocument doc(2048);
            DeserializationError error = deserializeJson(doc, http.getString());
            if (error) {
                Serial.printf("[RFID] Backend returned invalid card response: %s\n", error.c_str());
                lookupUnavailable = true;
            }
            else {
                JsonObject userData = doc["data"].as<JsonObject>();
                String apiName = userData["nama"] | "UNKNOWN";
                String apiRole = normalizeUserRole(userData["role"] | "MEKANIK");
                apiName.trim();
                if (doc["success"] == true && doc["is_valid"] == true &&
                    userData && apiName.length() > 0 &&
                    !apiName.equalsIgnoreCase("UNKNOWN") && !apiName.equalsIgnoreCase("NOT_FOUND")) {
                    card.uid = cleanUID;
                    card.sid = formatSid(userData["sid"] | "");
                    card.name = apiName;
                    card.role = apiRole;
                    card.isSpv = checkIsSupervisorRole(apiRole);
                    card.isRegistered = true;
                    card.isAssigned = true;
                    if (ramUserCount < MAX_RAM_USERS) ramUserCache[ramUserCount++] = card;
                } else if (doc["success"] == false && doc["is_valid"] == false) {
                    backendConfirmedMissing = true;
                    Serial.printf("[RFID] Backend confirms UID is unregistered uid=%s HTTP=200\n",
                        cleanUID.c_str());
                } else {
                    Serial.println("[RFID] Backend response did not confirm card; refusing local cache fallback");
                    lookupUnavailable = true;
                }
            }
        } else if (httpCode == HTTP_CODE_NOT_FOUND) {
            DynamicJsonDocument missingResponse(512);
            DeserializationError missingError = deserializeJson(missingResponse, http.getString());
            bool explicitlyMissing = !missingError && missingResponse["success"] == false &&
                                     missingResponse["is_valid"] == false;
            if (!explicitlyMissing) {
                Serial.printf("[RFID] Backend endpoint returned non-contract HTTP 404 uid=%s json_error=%s\n",
                    cleanUID.c_str(), missingError ? missingError.c_str() : "missing is_valid=false");
                lookupUnavailable = true;
            } else if (decPadded != cleanUID && decPadded.length() > 0) {
            // Fallback cek format desimal dengan padding jika kartu di database disimpan dalam desimal
            http.end();
            DynamicJsonDocument reqDec(256);
            reqDec["rfid_uid"] = decPadded;
            String reqBodyDec;
            serializeJson(reqDec, reqBodyDec);
            http.begin(client, getApiUrl("users/check-card"));
            http.addHeader("Content-Type", "application/json");
            http.addHeader("X-Device-Id", getDeviceId());
            http.setTimeout(3000);
            int code2 = http.POST(reqBodyDec);
            Serial.printf("[RFID] Online decimal UID lookup uid=%s HTTP=%d\n",
                decPadded.c_str(), code2);
            if (code2 == HTTP_CODE_OK) {
                DynamicJsonDocument doc2(2048);
                DeserializationError error = deserializeJson(doc2, http.getString());
                if (!error && doc2["success"] == true && doc2["is_valid"] == true &&
                    doc2["data"].is<JsonObject>()) {
                    JsonObject uData = doc2["data"].as<JsonObject>();
                    String apiName = uData["nama"] | "UNKNOWN";
                    String apiRole = normalizeUserRole(uData["role"] | "MEKANIK");
                    apiName.trim();
                    if (apiName.length() > 0 && !apiName.equalsIgnoreCase("UNKNOWN") && !apiName.equalsIgnoreCase("NOT_FOUND")) {
                        card.uid = cleanUID;
                        card.sid = formatSid(uData["sid"] | "");
                        card.name = apiName;
                        card.role = apiRole;
                        card.isSpv = checkIsSupervisorRole(apiRole);
                        card.isRegistered = true;
                        card.isAssigned = true;
                        if (ramUserCount < MAX_RAM_USERS) {
                            ramUserCache[ramUserCount++] = card;
                        }
                        backendConfirmedMissing = false;
                    }
                    if (!card.isRegistered) {
                        Serial.println("[RFID] Backend decimal UID response did not confirm card");
                        lookupUnavailable = true;
                    }
                } else {
                    Serial.printf("[RFID] Backend decimal UID response invalid HTTP=%d json_error=%s\n",
                        code2, error ? error.c_str() : "invalid confirmation");
                    lookupUnavailable = true;
                }
            } else if (code2 == HTTP_CODE_NOT_FOUND) {
                DynamicJsonDocument missingDecimal(512);
                DeserializationError missingDecimalError = deserializeJson(missingDecimal, http.getString());
                backendConfirmedMissing = !missingDecimalError &&
                    missingDecimal["success"] == false && missingDecimal["is_valid"] == false;
                if (!backendConfirmedMissing) {
                    Serial.printf("[RFID] Decimal lookup endpoint returned non-contract HTTP 404 uid=%s\n",
                        decPadded.c_str());
                    lookupUnavailable = true;
                }
            } else {
                Serial.printf("[RFID] Backend decimal UID lookup HTTP %d\n", code2);
                lookupUnavailable = true;
            }
            } else {
                backendConfirmedMissing = true;
                Serial.printf("[RFID] Backend confirms UID is unregistered uid=%s\n", cleanUID.c_str());
            }
        } else if (httpCode < 0) {
            Serial.printf("[RFID] Backend transport unavailable HTTP %d\n", httpCode);
            lookupUnavailable = true;
            offlineFallbackAllowed = !deviceHasNetwork();
        } else {
            Serial.printf("[RFID] Backend responded HTTP %d; refusing local cache fallback\n", httpCode);
            lookupUnavailable = true;
        }
        http.end();
    } else {
        lookupUnavailable = true;
        offlineFallbackAllowed = !wifiConnected;
        if (wifiConnected && backendConfigured) {
            Serial.printf("[RFID] Backend lookup skipped due to low heap=%u; refusing local cache fallback\n",
                ESP.getFreeHeap());
        }
    }

    if (!card.isRegistered && offlineFallbackAllowed && !backendConfirmedMissing) {
        for (int i = 0; i < ramUserCount; i++) {
            if (ramUserCache[i].uid.equalsIgnoreCase(cleanUID) ||
                ramUserCache[i].uid.equalsIgnoreCase(decPadded) ||
                ramUserCache[i].uid.equalsIgnoreCase(decUnpadded)) {
                card = ramUserCache[i];
                card.uid = cleanUID;
                card.isSpv = checkIsSupervisorRole(card.role);
                card.lookupUnavailable = false;
                card.offlineFallbackAllowed = true;
                return card;
            }
        }

        if (sdCardMounted) {
            card = searchUserFromSDCard(cleanUID);
            if (!card.isRegistered) card = searchUserFromSDCard(decPadded);
            if (!card.isRegistered) card = searchUserFromSDCard(decUnpadded);
            if (card.isRegistered) {
                if (ramUserCount < MAX_RAM_USERS) ramUserCache[ramUserCount++] = card;
                card.lookupUnavailable = false;
                card.offlineFallbackAllowed = true;
                return card;
            }
        }
    }

    if (!card.isRegistered && !backendConfirmedMissing) card.lookupUnavailable = lookupUnavailable;
    card.offlineFallbackAllowed = offlineFallbackAllowed;
    return card;
}

// Kirim telemetri dan jalankan sinkronisasi jaringan.
void networkTaskCore1(void * pvParameters) {
    unsigned long lastWifiCheckTask = 0;
    unsigned long lastHeartbeatTask = 0;
    unsigned long lastDbSyncTask    = 0;
    unsigned long lastBlePresenceTask = 0;
    unsigned long lastBackendDiscoveryTask = 0;
    unsigned long lastOfflineUploadTask = 0;
    unsigned long lastReconnectAttempt = 0;
    unsigned long lastSyncHeapWarning = 0;
    bool wasWifiConnected = (WiFi.status() == WL_CONNECTED);
    uint8_t heartbeatFailCount = 0;         
    bool initialHeartbeatSent = false;      
    unsigned long lastTaskHealthLog = millis();

    for (;;) {
        NetworkJob job;
        if (xQueueReceive(networkQueue, &job, pdMS_TO_TICKS(50)) == pdTRUE) {
            
            while(relayPulseActive) {
                vTaskDelay(pdMS_TO_TICKS(100)); 
            }

            if (WiFi.status() == WL_CONNECTED && server_host.length() == 0) discoverServer();
            if (WiFi.status() == WL_CONNECTED && server_host.length() > 0 &&
                ESP.getFreeHeap() >= MIN_HEAP_TO_POST_TELEMETRY) {
                String url = getApiUrl("boxes/") + getDeviceIdPath() + "/telemetry";
                WiFiClient client; client.setTimeout(2000);
                HTTPClient http;
                http.begin(client, url);
                http.addHeader("User-Agent", "ESP32-E-LOTO/5.0");
                http.addHeader("Content-Type", "application/json");
                http.addHeader("X-Device-Id", getDeviceId());
                http.setTimeout(3000);

                DynamicJsonDocument doc(2048);
                String eventId = String(job.event) + "-" + String(job.uid) + "-" + String(millis()) + "-" + String(random(1000, 9999));
                doc["event_id"]       = eventId;
                doc["id_box"]         = getDeviceId(); doc["event"] = String(job.event);
                doc["last_uid"]       = String(job.uid); doc["uid"] = String(job.uid);
                doc["is_tap"]         = isTapEventName(String(job.event));
                doc["is_register_scan"] = String(job.event).indexOf("REGISTER_NEW_CARD") != -1;
                doc["ip"]             = WiFi.localIP().toString(); doc["ssid"] = WiFi.SSID();
                
                double snapLat = 0; double snapLon = 0; bool snapFix = false;
                if (xSemaphoreTake(gpsMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
                    snapLat = currentLatitude;
                    snapLon = currentLongitude;
                    snapFix = gpsHasFix;
                    xSemaphoreGive(gpsMutex);
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
                doc["ble_count"] = geoCount; doc["ble_healthy"] = geoHealthy;
                doc["ble_scan_ok"] = geoHealthy; doc["ble_tag_count"] = geoCount;
                doc["mechanics_tapped"] = geoTapCount;
                doc["ble_report_http"] = blePresenceHttpStatus;
                doc["ble_report_tags"] = blePresenceReportedCount;
                doc["ble_report_at_ms"] = blePresenceLastReportAt;
                doc["sd_card_ok"] = sdCardStatusOk;
                doc["sd_sync_ok"] = sdSyncOk;
                doc["sd_user_count"] = sdUserCount;
                doc["reset_reason"] = (int)bootResetReason;
                doc["reset_reason_name"] = resetReasonName(bootResetReason);
                doc["free_heap"] = ESP.getFreeHeap();
                doc["min_free_heap"] = ESP.getMinFreeHeap();
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
                Serial.printf("[TELEMETRY] POST %s event=%s uid=%s => HTTP %d\n", url.c_str(), job.event, job.uid, httpCode);
                http.end();

                if (httpCode >= 200 && httpCode < 300) {
                    heartbeatFailCount = 0;
                } else {
                    heartbeatFailCount++;
                    saveOfflineLogToSDCard(String(job.event), String(job.uid), eventId);
                    if (heartbeatFailCount >= 3 && String(job.event) == "HEARTBEAT_SYNC") {
                        heartbeatFailCount = 0;
                        server_host = "";
                        discoverServer();
                    }
                }
            } else if (WiFi.status() != WL_CONNECTED) {
                saveOfflineLogToSDCard(String(job.event), String(job.uid), String());
                heartbeatFailCount++;
            } else {
                Serial.printf("[TELEMETRY] Deferred event=%s wifi=%d backend=%d free_heap=%u required=%u; saving for retry\n",
                    job.event, WiFi.status() == WL_CONNECTED, server_host.length() > 0,
                    ESP.getFreeHeap(), MIN_HEAP_TO_POST_TELEMETRY);
                saveOfflineLogToSDCard(String(job.event), String(job.uid), String());
            }
        }

        if (WiFi.status() == WL_CONNECTED && server_host.length() == 0 &&
            millis() - lastBackendDiscoveryTask >= 15000 && ESP.getFreeHeap() > 25000) {
            lastBackendDiscoveryTask = millis();
            Serial.println("[NET] Mengulang pencarian backend");
            discoverServer();
        }

        if (WiFi.status() == WL_CONNECTED && server_host.length() > 0 && sdCardMounted &&
            millis() - lastOfflineUploadTask >= 15000 && ESP.getFreeHeap() > 30000) {
            lastOfflineUploadTask = millis();
            requestSdStorageJob(SD_JOB_OFFLINE_UPLOAD);
        }

        if (millis() - lastBlePresenceTask >= 5000) {
            lastBlePresenceTask = millis();
            reportBlePresence();
        }

        if (millis() - lastWifiCheckTask > 10000) {
            lastWifiCheckTask = millis();
            if (WiFi.status() != WL_CONNECTED) {
                wasWifiConnected = false;
                if (millis() - lastReconnectAttempt > 30000) {
                    lastReconnectAttempt = millis();
                    WiFi.disconnect();
                    delay(100);
                    tryConnectBestWifi();
                }
            } else if ((!wasWifiConnected ||
                (startupSyncPending && (lastDbSyncTask == 0 || millis() - lastDbSyncTask >= PERSONNEL_SYNC_INTERVAL_MS)) ||
                millis() - lastDbSyncTask >= PERSONNEL_SYNC_INTERVAL_MS) &&
                ESP.getFreeHeap() >= MIN_HEAP_TO_QUEUE_PERSONNEL_SYNC) {
                bool justReconnected = !wasWifiConnected;
                wasWifiConnected = true;
                lastDbSyncTask = millis();
                if (justReconnected || server_host.length() == 0) discoverServer();
                if (server_host.length() > 0 && sdCardMounted) {
                    startupSyncPending = !requestSdStorageJob(
                        SD_JOB_PERSONNEL_SYNC | SD_JOB_OFFLINE_UPLOAD);
                } else {
                    startupSyncPending = true;
                }
                logAuditAsync("HEARTBEAT_SYNC", lastScannedUID);
            } else if ((!wasWifiConnected ||
                (startupSyncPending && (lastDbSyncTask == 0 || millis() - lastDbSyncTask >= PERSONNEL_SYNC_INTERVAL_MS)) ||
                millis() - lastDbSyncTask >= PERSONNEL_SYNC_INTERVAL_MS) &&
                ESP.getFreeHeap() < MIN_HEAP_TO_QUEUE_PERSONNEL_SYNC &&
                millis() - lastSyncHeapWarning >= 15000) {
                lastSyncHeapWarning = millis();
                Serial.printf("[SD_WORKER] Personnel cache deferred reason=low-heap free_heap=%u required=%u\n",
                    ESP.getFreeHeap(), MIN_HEAP_TO_QUEUE_PERSONNEL_SYNC);
            }
        }

        if (!initialHeartbeatSent) {
            if (millis() > 10000) {
                initialHeartbeatSent = true;
                lastHeartbeatTask = millis();
                if (WiFi.status() == WL_CONNECTED) {
                    logAuditAsync("HEARTBEAT_SYNC", lastScannedUID);
                }
            }
        } else if (millis() - lastHeartbeatTask > 30000) {
            lastHeartbeatTask = millis();
            if (WiFi.status() == WL_CONNECTED) {
                logAuditAsync("HEARTBEAT_SYNC", lastScannedUID);
            }
        }
        if (millis() - lastTaskHealthLog >= 60000) {
            lastTaskHealthLog = millis();
            Serial.printf("[HEALTH] task=NetworkTask core=%d stack_high_water=%u free_heap=%u min_free_heap=%u\n",
                xPortGetCoreID(),
                (unsigned int)uxTaskGetStackHighWaterMark(NULL), ESP.getFreeHeap(), ESP.getMinFreeHeap());
        }
        vTaskDelay(pdMS_TO_TICKS(15));
    }
}

// Antrekan event agar pengiriman jaringan tidak menahan tap.
void logAuditAsync(String event, String uid) {
    NetworkJob job; memset(&job, 0, sizeof(NetworkJob));
    event.toCharArray(job.event, sizeof(job.event)); 
    uid.toCharArray(job.uid, sizeof(job.uid));
    if (networkQueue == NULL || xQueueSend(networkQueue, &job, 0) != pdTRUE) {
        saveOfflineLogToSDCard(event, uid, String());
    }
    
    AuditEntry &slot = auditRing[auditHead];
    slot.event = event; slot.uid = uid; slot.ok = true; slot.ts = millis();
    slot.lat = gpsHasFix ? currentLatitude : 0; slot.lon = gpsHasFix ? currentLongitude : 0;
    auditHead = (auditHead + 1) % AUDIT_RING_SIZE; auditCount++;
}

// Proses hasil tap sesuai state dan hak personel.
bool isLotoSessionTapState(SystemState state) {
    return state == STATE_WAIT_SPV_IN || state == STATE_SUPERVISOR_VALID ||
           state == STATE_SET_MEKANIK_COUNT || state == STATE_MEKANIK_IN ||
           state == STATE_MEKANIK_OUT || state == STATE_WAIT_SPV_OUT;
}

void processRfidLogic(String uid) {
    uid = normalizeRfidUid(uid);
    lastScannedUID = uid;
    SystemState operationalState = currentState;
    stateBeforeNotification = operationalState;
    
    // Mode registrasi hanya menerima kartu baru setelah verifikasi backend/cache.
    if (operationalState == STATE_REGISTER_RFID) {
        WorkerInfo existingCard = fetchCardDataAPI(uid);
        if (existingCard.isRegistered && isFuelmanRole(existingCard.role)) {
            regHasCard = false;
            regLastUID = "";
            if (handleFuelmanTap(uid, existingCard)) return;
        }
        if (existingCard.isRegistered) {
            buzzFailed();
            logAuditAsync("REGISTER_CARD_ALREADY_EXISTS", uid);
            regHasCard = true;
            regLastUID = uid;
            regLastStatus = "STATUS: SUDAH TERDAFTAR!";
            regLastSuccess = false;
        } else if (existingCard.lookupUnavailable) {
            buzzFailed();
            displayErrorCardPopup(uid, "SERVER TIDAK SIAP", "", "", "", "KARTU BELUM DAPAT DIVERIFIKASI");
            return;
        } else {
            buzzSuccess();
            logAuditAsync("REGISTER_NEW_CARD", uid);
            regHasCard = true;
            regLastUID = uid;
            regLastStatus = "STATUS: REGISTRASI OK";
            regLastSuccess = true;
        }
        forceFullRedraw = true;
        needsRedraw = true;
        return;
    }
    
    int workerIdx = findWorkerIndex(uid);
    WorkerInfo card = fetchCardDataAPI(uid);

    // During a confirmed backend outage, the persisted active session may verify its own participants.
    if (!card.isRegistered && card.offlineFallbackAllowed) {
        if (workerIdx != -1) {
            card = safetyQueue.workers[workerIdx];
            card.isRegistered = true;
        } else if (supervisorUID != "" &&
                   (supervisorUID.equalsIgnoreCase(uid) ||
                    supervisorUID.equalsIgnoreCase(hexToDecStringPadded(uid)) ||
                    supervisorUID.equalsIgnoreCase(hexToDecStringUnpadded(uid)))) {
            card.uid = uid;
            card.sid = lastScannedSID;
            card.name = supervisorName;
            card.role = supervisorRole;
            card.isSpv = true;
            card.isRegistered = true;
        }
        card.lookupUnavailable = false;
    }

    if (card.isRegistered && handleFuelmanTap(uid, card)) return;
    if (!isSessionActive || !isLotoSessionTapState(operationalState)) return;

    if (!card.isRegistered && card.lookupUnavailable) {
        buzzFailed();
        displayErrorCardPopup(uid, "SERVER TIDAK SIAP", "", "", "", "KARTU BELUM DAPAT DIVERIFIKASI");
        return;
    }
    
    lastScannedSID = formatSid(card.sid);
    
    if (!card.isRegistered || card.name == "UNKNOWN" || card.name == "Tidak Terdaftar") {
        buzzFailed();
        logAuditAsync("UNREGISTERED_SCAN_DENIED", uid);
        displayErrorCardPopup(uid, "AKSES DITOLAK", "", "", "", "KARTU TIDAK TERDAFTAR");
        return;
    }

    if (operationalState == STATE_WAIT_SPV_IN || operationalState == STATE_MEKANIK_IN) {
        if (workerIdx != -1) {
            if (operationalState == STATE_WAIT_SPV_IN && workerIdx == 0 &&
                isQueueSupervisor(0) && checkIsSupervisorRole(card.role)) {
                buzzSuccess();
                selectedFooterAction = 1;
                currentState = STATE_SUPERVISOR_VALID;
                logAuditAsync("SUPERVISOR_RESUME_CONFIRM", uid);
                saveSessionToSD();
                forceFullRedraw = true;
                needsRedraw = true;
                return;
            }
            buzzFailed();
            logAuditAsync("SCAN_REJECTED_DUPLICATE", uid);
            displayErrorCardPopup(uid, "DUPLIKASI AKSES", card.name, card.role, card.sid, "KARTU SUDAH TERDAFTAR MASUK");
            return;
        }
    }
    
    switch (operationalState) {
        case STATE_SUPERVISOR_VALID:
        case STATE_SET_MEKANIK_COUNT:
            // Jika mekanik langsung tap saat supervisor valid / set mekanik count, otomatis masuk ke antrean mekanik
            if (card.isSpv || checkIsSupervisorRole(card.role)) {
                buzzFailed();
                displayErrorCardPopup(uid, "DUPLIKASI SPV", card.name, card.role, card.sid, "PENGAWAS SUDAH TERDAFTAR");
            } else {
                if (!pushQueue(uid, card.sid, card.name, "MEKANIK")) {
                    buzzFailed();
                    displayErrorCardPopup(uid, "ANTREAN PENUH", card.name, card.role, card.sid, "BATAS PERSONEL SUDAH TERCAPAI");
                    break;
                }
                buzzSuccess();
                logAuditAsync("MECHANIC_LOG_IN", uid);
                displayCardNotification(uid, card.name, "MEKANIK", "MEKANIK MASUK", true);
                currentState = STATE_MEKANIK_IN;
            }
            break;

        case STATE_WAIT_SPV_IN:
            if (card.isSpv || checkIsSupervisorRole(card.role)) {
                bool firstSupervisor = supervisorUID.length() == 0;
                if (firstSupervisor) {
                    supervisorUID = uid; supervisorName = card.name; supervisorRole = "PENGAWAS";
                }
                if (!pushQueue(uid, card.sid, card.name, "PENGAWAS")) {
                    if (firstSupervisor) {
                        supervisorUID = ""; supervisorName = ""; supervisorRole = "";
                    }
                    buzzFailed();
                    displayErrorCardPopup(uid, "ANTREAN PENUH", card.name, card.role, card.sid, "BATAS PERSONEL SUDAH TERCAPAI");
                    break;
                }
                buzzSuccess();
                logAuditAsync(firstSupervisor ? "SUPERVISOR_LOCK_IN" : "SUPERVISOR_EXTRA_LOCK_IN", uid);
                selectedFooterAction = 1;
                currentState = STATE_SUPERVISOR_VALID;
            } else {
                buzzFailed();
                displayErrorCardPopup(uid, "BUKAN PENGAWAS", card.name, card.role, card.sid, "TEMPELKAN KARTU PENGAWAS");
            }
            break;

        case STATE_MEKANIK_IN:
            if (card.isSpv || checkIsSupervisorRole(card.role)) {
                buzzFailed();
                displayErrorCardPopup(uid, "BUKAN MEKANIK", card.name, card.role, card.sid, "TEMPELKAN KARTU MEKANIK");
            } else {
                if (!pushQueue(uid, card.sid, card.name, "MEKANIK")) {
                    buzzFailed();
                    displayErrorCardPopup(uid, "ANTREAN PENUH", card.name, card.role, card.sid, "BATAS PERSONEL SUDAH TERCAPAI");
                    break;
                }
                buzzSuccess();
                logAuditAsync("MECHANIC_LOG_IN", uid);
                
                if (countQueueMechanics() >= targetMekanikCount) {
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
            if (workerIdx == safetyQueue.topIndex && workerIdx > 0) {
                WorkerInfo leavingUser = safetyQueue.workers[workerIdx];
                bool leavingSupervisor = isQueueSupervisor(workerIdx);
                removeQueueAt(workerIdx);
                buzzSuccess();
                logAuditAsync(leavingSupervisor ? "SUPERVISOR_EXTRA_LOG_OUT" : "MECHANIC_LOG_OUT", uid);
                if (safetyQueue.topIndex == 0) {
                    currentState = STATE_WAIT_SPV_OUT;
                    displayCardNotification(uid, leavingUser.name, leavingSupervisor ? "PENGAWAS" : "MEKANIK", "TAP PENGAWAS UTAMA", true);
                } else {
                    currentState = STATE_MEKANIK_OUT;
                    displayCardNotification(uid, leavingUser.name, leavingSupervisor ? "PENGAWAS" : "MEKANIK", "KELUAR BERHASIL", true);
                }
            } else if (workerIdx != -1) {
                buzzFailed();
                displayErrorCardPopup(uid, "SALAH URUTAN", card.name, card.role, card.sid, "TAP KARTU PERSONEL TERAKHIR");
            } else {
                buzzFailed();
                displayErrorCardPopup(uid, "TIDAK DITEMUKAN", card.name, card.role, card.sid, "PERSONEL BELUM MASUK UNIT");
            }
            break;

        case STATE_WAIT_SPV_OUT:
            if (safetyQueue.topIndex == 0 && supervisorUID.length() > 0 &&
                (uid.equalsIgnoreCase(supervisorUID) ||
                supervisorUID.equalsIgnoreCase(hexToDecStringPadded(uid)) ||
                supervisorUID.equalsIgnoreCase(hexToDecStringUnpadded(uid)))) {
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
                buzzFailed();
                displayErrorCardPopup(uid, "BUKAN PENGAWAS", card.name, card.role, card.sid, "TEMPELKAN KARTU PENGAWAS");
            }
            break;
            
        default: 
            buzzFailed(); 
            break;
    }
    digitalWrite(PIN_BUZZER, LOW);
    saveSessionToSD();
    needsRedraw = true;
}

// Mulai koneksi ke profil Wi-Fi terpilih.
bool tryConnectBestWifi() {
    if (WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0") return true;
    if (wifi_ssid.length() == 0 || wifi_ssid.startsWith("ISI_")) return false;
    Serial.printf("[WIFI] Connecting with firmware SSID=%s\n", wifi_ssid.c_str());
    WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());
    return true;
}

// Pastikan host merespons sebagai backend box ini.
bool verifyServerEndpoint() {
    if (WiFi.status() != WL_CONNECTED || server_host.length() == 0) return false;
    WiFiClient client;
    client.setTimeout(2000);
    HTTPClient http;
    String url = getApiUrl("boxes/") + getDeviceIdPath() + "/device-handshake";
    http.begin(client, url);
    http.addHeader("X-Device-Id", getDeviceId());
    http.setTimeout(2500);
    int code = http.GET();
    bool verified = false;
    if (code == HTTP_CODE_OK) {
        DynamicJsonDocument response(768);
        DeserializationError error = deserializeJson(response, http.getStream());
        verified = !error && String(response["data"]["contract"] | "") == "eloto-device-v1" &&
            String(response["data"]["id_box"] | "") == getDeviceId();
    }
    Serial.printf("[SERVER] Handshake %s => HTTP %d verified=%s\n",
        url.c_str(), code, verified ? "yes" : "no");
    http.end();
    return verified;
}

// Temukan alamat backend dan verifikasi handshake perangkat.
bool discoverServer() {
    static unsigned long lastDiscoveryAttempt = 0;
    if (WiFi.status() != WL_CONNECTED) return false;
    if (server_host.length() == 0 && lastDiscoveryAttempt != 0 &&
        millis() - lastDiscoveryAttempt < 15000) return false;
    lastDiscoveryAttempt = millis();
    if (server_host.length() > 0 && verifyServerEndpoint()) return true;
    server_host = "";
    String gateway = WiFi.gatewayIP().toString();
    if (gateway != "0.0.0.0") {
        server_host = gateway + ":5002";
        if (verifyServerEndpoint()) return true;
        server_host = "";
    }
    WiFiUDP udp;
    if (!udp.begin(5003)) return false;

    IPAddress broadcastIP = WiFi.localIP();
    broadcastIP[3] = 255;
    byte pkt[] = { 'E','L','O','T','O','_','D','I','S','C','O','V','E','R' };
    udp.beginPacket(broadcastIP, 5003);
    udp.write(pkt, sizeof(pkt));
    udp.endPacket();

    unsigned long start = millis();
    while (millis() - start < 3000) {
        int cb = udp.parsePacket();
        if (cb > 0) {
            char buf[256];
            int len = udp.read(buf, sizeof(buf) - 1);
            if (len <= 0 || len >= (int)sizeof(buf)) continue;
            buf[len] = 0;
            String response = String(buf);
            response.trim();
            if (response.startsWith("ELOTO_SERVER|")) {
                server_host = response.substring(13);
                server_host.trim();
                udp.stop();
                if (verifyServerEndpoint()) return true;
                server_host = "";
                return false;
            }
        }
        delay(10);
    }

    udp.stop();
    return false;
}

// Hubungkan Wi-Fi dan tampilkan hasil koneksi.
void connectWiFiRoutine() {
    currentState = STATE_CONNECTING;
    forceFullRedraw = true;
    drawScreen();

    // Jika belum memanggil koneksi atau sedang tidak tersambung, inisiasi koneksi
    if (WiFi.status() != WL_CONNECTED) {
        if (!tryConnectBestWifi()) {
            buzzFailed();
            selectedFooterAction = 1;
            currentState = STATE_SERVER_OFFLINE;
            forceFullRedraw = true;
            needsRedraw = true;
            return;
        }
    }

    unsigned long startConn = millis();
    unsigned long lastScreenUpdate = 0;
    bool ipAssigned = false;

    // Batas waktu tunggu maksimal dipercepat menjadi 6 detik agar tidak membuat pengguna menunggu lama
    while (millis() - startConn < 12000) { // Beri waktu 12 detik agar negosiasi IP DHCP berhasil online
        server.handleClient();
        feedGPS();

        if (WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0") {
            ipAssigned = true;
            break;
        }

        if (millis() - lastScreenUpdate > 300) {
            lastScreenUpdate = millis();
            needsRedraw = true;
            drawScreen();
        }
        delay(10);
    }

    if (ipAssigned) {
        buzzSuccess();
        Serial.printf("[WIFI] Terhubung SSID=%s IP=%s gateway=%s\n",
            WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str());
        selectedFooterAction = 1;
        currentState = STATE_SHOW_IP;
        logAuditAsync("WIFI_CONNECTED", WiFi.localIP().toString());
        startupSyncPending = true;
    } else {
        buzzFailed();
        selectedFooterAction = 1;
        currentState = STATE_SERVER_OFFLINE;
    }
    forceFullRedraw = true;
    needsRedraw = true;
}

// Jalankan pilihan tombol footer sesuai layar aktif.
void executeFooterChoice() {
    if (currentState == STATE_WELCOME) {
        if (selectedFooterAction == 0) {
            // Langsung berpindah ke Mode Registrasi Kartu seketika tanpa delay WiFi
            buzzTick();
            currentState = STATE_REGISTER_RFID;
            regHasCard = false;  
            logAuditAsync("ENTER_REGISTER_MODE", "ADMIN");
        } else {
            // Cek apakah Wi-Fi SUDAH berhasil terhubung di latar belakang
            if (WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0") {
                // Jaringan sudah siap! Langsung lompat seketika ke STATE_SHOW_IP tanpa jeda (0 ms)
                buzzSuccess();
                Serial.printf("[WIFI] Terhubung SSID=%s IP=%s gateway=%s\n",
                    WiFi.SSID().c_str(), WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str());
                selectedFooterAction = 1;
                currentState = STATE_SHOW_IP;
                logAuditAsync("WIFI_CONNECTED", WiFi.localIP().toString());
                startupSyncPending = true; // Core 0 akan otomatis menangani discoverServer dan sync di latar belakang
                forceFullRedraw = true;
                needsRedraw = true;
                return;
            } else {
                // Jika ditekan sangat cepat sebelum Wi-Fi selesai, tunggu singkat dengan batas timeout
                connectWiFiRoutine();
                return;
            }
        }
    } else if (currentState == STATE_SERVER_OFFLINE) {
        if (WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0") {
            buzzSuccess();
            currentState = STATE_SHOW_IP;
            startupSyncPending = true;
            logAuditAsync("WIFI_CONNECTED", WiFi.localIP().toString());
            forceFullRedraw = true;
            needsRedraw = true;
            return;
        }
        if (selectedFooterAction == 0) {
            connectWiFiRoutine();
            return;
        } else {
            buzzSuccess();
            selectedFooterAction = 1;
            relayOpen = true;
            saveSessionToSD();
            delay(50);
            relayPulseActive = true;
            digitalWrite(PIN_RELAY, HIGH);
            logAuditAsync("OFFLINE_MODE_START", "---");

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
                unsigned long startTick = millis();
                unsigned long waitDuration = (detik <= 3) ? 700 : 940;
                while (millis() - startTick < waitDuration) {
                    server.handleClient();
                    feedGPS();
                    vTaskDelay(pdMS_TO_TICKS(15));
                }
            }
            digitalWrite(PIN_RELAY, LOW);
            relayOpen = false;
            delay(500);
            relayPulseActive = false;
            clearRfidBuffer();

            isAddingFromMenu = false;
            workerListFromMenu = false;
            currentState = STATE_WAIT_SPV_IN;
            startupSyncPending = true;
        }
    } else if (currentState == STATE_SHOW_IP) {
        if (selectedFooterAction == 0) {
            buzzTick();
            currentState = STATE_WELCOME; // KEMBALI ke Selamat Datang
        } else {
            currentState = STATE_SYSTEM_READY;
        }
    } else if (currentState == STATE_SYSTEM_READY) {
        if (selectedFooterAction == 0) {
            currentState = (WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0") ? STATE_SHOW_IP : STATE_WELCOME;
        } else {
            buzzSuccess();
            relayOpen = true;
            saveSessionToSD();
            delay(50);
            relayPulseActive = true;
            digitalWrite(PIN_RELAY, HIGH);
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
                unsigned long startTick = millis();
                unsigned long waitDuration = (detik <= 3) ? 700 : 940;
                while (millis() - startTick < waitDuration) {
                    server.handleClient();
                    feedGPS();
                    vTaskDelay(pdMS_TO_TICKS(15));
                }
            }
            digitalWrite(PIN_RELAY, LOW);
            relayOpen = false;
            delay(500);
            relayPulseActive = false;
            clearRfidBuffer();

            isAddingFromMenu = false;
            workerListFromMenu = false;
            currentState = STATE_WAIT_SPV_IN;
            startupSyncPending = true;
        }
    } else if (currentState == STATE_START_CONFIRM) {
        if (selectedFooterAction == 0) currentState = STATE_IDLE;
        else currentState = STATE_WAIT_SPV_IN;
    } else if (currentState == STATE_SUPERVISOR_VALID) {
        if (selectedFooterAction == 0) {
            if (!isAddingFromMenu) {
                supervisorUID = ""; supervisorName = ""; supervisorRole = "";
                lastScannedSID = "-----";
            }
            if (safetyQueue.topIndex >= 0) removeQueueAt(safetyQueue.topIndex);
            currentState = isAddingFromMenu ? STATE_MENU : STATE_WAIT_SPV_IN;
            isAddingFromMenu = false;
            saveSessionToSD();
        } else {
            saveSessionToSD();
            if (isAddingFromMenu) {
                isAddingFromMenu = false;
                workerListFromMenu = true;
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
            int mekanikDiDalam = countQueueMechanics();
            if (targetMekanikCount <= mekanikDiDalam) {
                workerListFromMenu = isAddingFromMenu;
                isAddingFromMenu = false;
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
            if (safetyQueue.topIndex > 0 && !isQueueSupervisor(safetyQueue.topIndex)) {
                removeQueueAt(safetyQueue.topIndex);
                currentState = STATE_MEKANIK_IN;
            } else {
                currentState = STATE_SET_MEKANIK_COUNT;
            }
        } else {
            workerListFromMenu = isAddingFromMenu;
            isAddingFromMenu = false;
            selectedWorkerIndex = 0;
            currentState = STATE_WORKER_LIST;
        }
    } else if (currentState == STATE_WORKER_LIST) {
        if (selectedFooterAction == 0) {
            currentState = workerListFromMenu ? STATE_MENU : STATE_ALL_WORKERS_REGISTERED;
        } else if (selectedFooterAction == 1) {
            currentState = STATE_WORKER_DETAIL;
        } else if (selectedFooterAction == 2) {
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
            relayPulseActive = true;
            digitalWrite(PIN_RELAY, HIGH); 
            relayOpen = true;
            delay(500); 

            exitCountdownActive = true;
            for (int detik = 10; detik >= 1; detik--) {
                currentState = STATE_COUNTDOWN;
                notificationMessage = String(detik);
                needsRedraw = true;
                drawScreen();
                countdownBeep(detik);
                unsigned long startTick = millis();
                unsigned long waitDuration = (detik <= 3) ? 700 : 940;
                while (millis() - startTick < waitDuration) {
                    server.handleClient();
                    feedGPS();
                    vTaskDelay(pdMS_TO_TICKS(15));
                }
            }
            exitCountdownActive = false;

            digitalWrite(PIN_RELAY, LOW); 
            relayOpen = false; 
            delay(500);
            relayPulseActive = false;

            currentState = STATE_MAINTENANCE_DONE;
            needsRedraw = true;
            drawScreen();
            delay(1000);
            
            supervisorUID = ""; supervisorName = ""; supervisorRole = "";
            lastScannedUID = "---"; lastScannedSID = "-----";
            activeFuelmanUID = ""; activeFuelmanName = "";
            safetyQueue.topIndex = -1; targetMekanikCount = 0; isAddingFromMenu = false; workerListFromMenu = false;
            clearSessionFromSD();
            
            isSessionActive = false;
            sessionStartTime = 0;
            
            logAuditAsync("SESSION_CLOSED_NORMAL", "SYSTEM");
            currentState = STATE_WELCOME;
        }
    }
    
    if (currentState != lastRenderedState) {
        forceFullRedraw = true;
    }
    needsRedraw = true;
}

// Jalankan aksi tombol singkat atau tekan lama.
void executeSystemAction(uint8_t activeKey, bool isHoldAction) {
    if (activeKey == KEY_NONE) return;
    if (currentState == STATE_GEOFENCE) {
        if (!isHoldAction && (activeKey == KEY_4 || activeKey == KEY_5)) {
            currentState = STATE_MENU; forceFullRedraw = true; needsRedraw = true;
        }
        return;
    }
    
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
                safetyQueue.topIndex = -1; targetMekanikCount = 0; workerListFromMenu = false; currentState = STATE_BOOT_IP;
                isSessionActive = false; sessionStartTime = 0; 
                logAuditAsync("HARDWARE_HARD_RESET", "ADMIN");
            }
        }
        else if (currentState == STATE_REGISTER_RFID && activeKey == KEY_5) {
            buzzSuccess(); currentState = STATE_WELCOME;
            regHasCard = false;  
            logAuditAsync("EXIT_REGISTER_MODE", "ADMIN");
        }
        forceFullRedraw = true;
        needsRedraw = true; clearRfidBuffer(); return;
    }

    // Pada STATE_WELCOME, navigasi tombol kiri/kanan diproses di hasFooterChoice():
    // Tombol Kiri (KEY_4) memindahkan sorot merah ke 'DAFTAR KARTU'
    // Tombol Kanan (KEY_1) memindahkan sorot merah ke 'LANJUT'
    // Tombol OK (KEY_5) mengeksekusi pilihan yang disorot merah tersebut

    if (currentState == STATE_REGISTER_RFID) {
        if (activeKey == KEY_5 || activeKey == KEY_4) {
            buzzTick();
            currentState = STATE_WELCOME;
            regHasCard = false;  
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
                currentState = workerListFromMenu ? STATE_MENU : STATE_ALL_WORKERS_REGISTERED;
            } else if (selectedFooterAction == 1) {
                currentState = STATE_WORKER_DETAIL;
            } else if (selectedFooterAction == 2) {
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
                forceFullRedraw = true;  
            } else {
                if (selectedWorkerIndex < safetyQueue.topIndex) {
                    selectedWorkerIndex++;
                } else {
                    currentState = STATE_WORKER_LIST;
                    forceFullRedraw = true;  
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
            if (selectedMenuIndex < 3) {
                selectedMenuIndex++; buzzTick(); needsRedraw = true;
            }
            return;
        } else if (activeKey == KEY_4) { 
            buzzTick(); workerListFromMenu = true; currentState = STATE_WORKER_LIST; 
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
                targetMekanikCount = countQueueMechanics();
                currentState = STATE_SET_MEKANIK_COUNT;
            } else if (selectedMenuIndex == 2) { 
                isAddingFromMenu = true;
                currentState = STATE_WAIT_SPV_IN;
            } else if (selectedMenuIndex == 3) {
                currentState = STATE_GEOFENCE;
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
                if (targetMekanikCount < MAX_WORKERS - countQueueSupervisors()) targetMekanikCount++;
                needsRedraw = true;
                return;
            } else if (activeKey == KEY_2) { 
                buzzTick();
                int minCount = isAddingFromMenu ? countQueueMechanics() : 0;
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

// Gambar ulang layar sesuai state sistem.
void drawScreen() {
    bool stateChanged = (currentState != lastRenderedState);
    bool workerIndexChanged = (currentState == STATE_WORKER_DETAIL && selectedWorkerIndex != lastRenderedWorkerIndex);
    
    if (stateChanged || workerIndexChanged || forceFullRedraw) {
        forceFullRedraw = false;
        photoAlreadyDrawn = false;
        
        if (stateChanged) {
            if (currentState == STATE_WELCOME) {
                selectedFooterAction = 1; // Default: LANJUT aktif (Siap ditekan langsung)!
            } else if (currentState == STATE_BOOT_IP || currentState == STATE_SERVER_OFFLINE ||
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
        String normalizedSsid = wifi_ssid; normalizedSsid.toUpperCase();
        bool wifiConfigured = wifi_ssid.length() > 0 && !normalizedSsid.startsWith("ISI_") &&
            !normalizedSsid.startsWith("YOUR-") && !normalizedSsid.startsWith("YOUR_");
        String offlineTitle = wifiConfigured ? "JARINGAN TIDAK DITEMUKAN" : "WIFI BELUM DIATUR";
        String offlineDetail = wifiConfigured ? "WIFI GAGAL TERHUBUNG" : "ISI SSID DI FIRMWARE";
        String offlineHint = wifiConfigured ? "COBA LAGI ATAU DARURAT OFFLINE" : "MODE DARURAT HANYA TANPA JARINGAN";
        drawCornerAccents(15, 55, 450, 208, ELOTO_DARK_RED);
        tft.setTextDatum(MC_DATUM);
        setStoryFont(12);
        tft.setTextColor(ELOTO_HEADER, TFT_BLACK);
        tft.drawString(offlineTitle, 240, 75);
        drawDecorativeLine(95, ELOTO_DARK_RED);
        drawWifiIcon(240, 130, TFT_LIGHTGREY);
        setStoryFont(9);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.drawString(offlineDetail, 240, 175);
        tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        tft.drawString(offlineHint, 240, 210);
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
        String spvNameDisp = (safetyQueue.topIndex >= 0) ? safetyQueue.workers[safetyQueue.topIndex].name : (supervisorName.length() > 0 ? supervisorName : "PENGAWAS");
        String spvSidDisp  = (safetyQueue.topIndex >= 0) ? safetyQueue.workers[safetyQueue.topIndex].sid : lastScannedSID;
        String spvUidDisp  = (safetyQueue.topIndex >= 0) ? safetyQueue.workers[safetyQueue.topIndex].uid : supervisorUID;
        drawTextFit(spvNameDisp, 190, 112, 260, ELOTO_HEADER, ELOTO_BG, 9);
        tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
        drawTextFit("SID      : " + formatSid(spvSidDisp), 190, 148, 260, ELOTO_TEXT, ELOTO_BG, 9);
        drawTextFit("JABATAN  : PENGAWAS", 190, 180, 260, ELOTO_TEXT, ELOTO_BG, 9);
        drawTftFooter("KEMBALI", "LANJUT");
        if (!photoAlreadyDrawn) {
            if (!drawPhotoFromAPI(spvUidDisp, 20, 92, 160, 160)) {
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
        int mekanikMasuk = countQueueMechanics();
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
        int totalMekanik = countQueueMechanics();
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
        const int MAX_VISIBLE = 5;
        int startIdx = 0;
        if (selectedWorkerIndex >= MAX_VISIBLE) {
            startIdx = selectedWorkerIndex - MAX_VISIBLE + 1;
        }
        int endIdx = min(startIdx + MAX_VISIBLE - 1, (int)safetyQueue.topIndex);
        for (int i = startIdx; i <= endIdx; i++) {
            bool selected = (i == selectedWorkerIndex);
            int displayRow = i - startIdx;  
            int rowY = 96 + displayRow * 27;
            String role = safetyQueue.workers[i].role;
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
        bool isFirstDraw = (lastRenderedState != STATE_WORKER_DETAIL) || forceFullRedraw;
        if (isFirstDraw) {
            tft.fillRoundRect(14, 54, 452, 204, 6, ELOTO_BG);
            tft.drawRoundRect(14, 54, 452, 204, 6, ELOTO_DARK_RED);
        }
        tft.setTextDatum(MC_DATUM);
        setStoryFont(12);
        tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
        String titleWithPos = "DETAIL PERSONEL (" + String(safeIndex + 1) + " / " + String(totalWorkers) + ")";
        tft.drawString(titleWithPos, 240, 70);
        tft.fillRect(20, 88, 270, 150, ELOTO_BG);
        tft.setTextDatum(TL_DATUM);
        setStoryFont(9);
        tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
        drawTextFit(worker.name, 26, 110, 260, ELOTO_HEADER, ELOTO_BG, 9);
        tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
        drawTextFit("SID      : " + formatSid(worker.sid), 26, 150, 260, ELOTO_TEXT, ELOTO_BG, 9);
        drawTextFit("JABATAN  : " + worker.role, 26, 186, 260, ELOTO_TEXT, ELOTO_BG, 9);
        drawTftFooter("KEMBALI", "LANJUT");
        if (!photoAlreadyDrawn) {
            tft.fillRect(296, 88, 160, 160, ELOTO_BG);
            tft.drawRect(296, 88, 160, 160, ELOTO_TEXT);
            if (!drawPhotoFromAPI(worker.uid, 296, 88, 160, 160)) {
                tft.setTextDatum(MC_DATUM);
                setStoryFont(9);
                tft.setTextColor(ELOTO_TEXT, ELOTO_BG);
                tft.drawString("NO FOTO", 373, 165);
            }
            photoAlreadyDrawn = true;
        }
        lastRenderedWorkerIndex = safeIndex;
    } 
    else if (currentState == STATE_GEOFENCE) {
        drawGeofencePage();
    }
    else if (currentState == STATE_MENU) {
        tft.setTextDatum(MC_DATUM);
        setStoryFont(12);
        tft.setTextColor(ELOTO_HEADER, ELOTO_BG);
        tft.drawString("PILIHAN MENU LOTO", 240, 68);
        const char *menuItems[] = {
            "1. KELUAR / SELESAI MAINTENANCE",
            "2. TAMBAH MEKANIK",
            "3. TAMBAH PENGAWAS",
            "4. KONFIRMASI GEOFENCE / BLE"
        };
        tft.setTextDatum(TL_DATUM);
        for (uint8_t i = 0; i < 4; i++) {
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
        int remainingPersonnel = (safetyQueue.topIndex >= 0) ? safetyQueue.topIndex : 0;
        String countText = "SISA: " + String(remainingPersonnel) + " PERSONEL";
        tft.fillRect(40, 180, 400, 30, TFT_BLACK);
        setStoryFont(12);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.drawString(countText, 240, 195);
        setStoryFont(9);
        tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        bool isSpvLast = (safetyQueue.topIndex >= 0) && isQueueSupervisor(safetyQueue.topIndex);
        tft.drawString(isSpvLast ? "TAP PENGAWAS TERAKHIR" : "TAP MEKANIK TERAKHIR", 240, 225);
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
        tft.drawString("PERSONEL LAIN SUDAH KELUAR", 240, 195);
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
            if (!drawPhotoFromAPI(supervisorUID, 20, 92, 160, 160)) {
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

        tft.fillRect(15, 100, 450, 160, TFT_BLACK); 

        if (regHasCard) {
            // Tampilan kartu berhasil / terdaftar: TANPA FOTO (Sesuai instruksi)
            tft.drawRoundRect(40, 105, 400, 115, 6, regLastSuccess ? TFT_GREEN : TFT_RED);

            // 1. Status Registrasi
            tft.setTextDatum(MC_DATUM);
            setStoryFont(12);
            tft.setTextColor(regLastSuccess ? TFT_GREEN : TFT_RED, TFT_BLACK);
            tft.drawString(regLastStatus, 240, 130);

            // 2. UID Kartu
            setStoryFont(12);
            tft.setTextColor(TFT_WHITE, TFT_BLACK);
            tft.drawString("UID : " + regLastUID, 240, 165);

            // 3. Petunjuk Lanjutan
            setStoryFont(9);
            tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
            tft.drawString(regLastSuccess ? "TAP KARTU BERIKUTNYA ATAU KEMBALI" : "KARTU SUDAH TERDAFTAR - TAP KARTU LAIN", 240, 200);
        } else {
            // Tampilan Standby saat menunggu kartu di-tap
            drawRfidIcon(240, 140, TFT_WHITE);
            setStoryFont(12);
            tft.setTextColor(TFT_WHITE, TFT_BLACK);
            tft.drawString("SILAHKAN TAP KARTUNYA", 240, 200);
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

// Sajikan snapshot status perangkat melalui HTTP.
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
    doc["session_active"] = isSessionActive;
    doc["session_elapsed_ms"] = isSessionActive ? uint32_t(millis() - sessionStartTime) : 0;
    doc["sd_card_ok"] = sdCardStatusOk;
    doc["sd_sync_ok"] = sdSyncOk;
    doc["sd_user_count"] = sdUserCount;
    
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
    doc["ble_count"] = geoCount;
    doc["mechanics_tapped"] = geoTapCount;
    doc["ble_healthy"] = geoHealthy;
    doc["ble_scan_ok"] = geoHealthy;
    doc["ble_tag_count"] = geoCount;
    doc["ble_report_http"] = blePresenceHttpStatus;
    doc["ble_report_tags"] = blePresenceReportedCount;
    doc["ble_report_at_ms"] = blePresenceLastReportAt;
    doc["ble_count_warning"] = geoWarning;
    doc["ble_is_connection_count"] = false;
    doc["uptime_ms"] = millis(); doc["is_online"] = (WiFi.status() == WL_CONNECTED) ? 1 : 0;
    doc["reset_reason"] = (int)bootResetReason;
    doc["reset_reason_name"] = resetReasonName(bootResetReason);
    doc["free_heap"] = ESP.getFreeHeap();
    doc["min_free_heap"] = ESP.getMinFreeHeap();
    
    JsonArray q = doc.createNestedArray("queue");
    for (int i = 0; i <= safetyQueue.topIndex; i++) {
        JsonObject o = q.createNestedObject();
        o["uid"]  = safetyQueue.workers[i].uid; o["name"] = safetyQueue.workers[i].name; o["role"] = safetyQueue.workers[i].role;
    }
    String json; serializeJson(doc, json); server.send(200, "application/json", json);
}

// Jawab permintaan preflight browser untuk status.
void handleOptions() { 
    server.sendHeader("Access-Control-Allow-Origin", "*"); 
    server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS"); 
    server.send(204); 
}

// Balas endpoint perangkat yang tidak dikenal.
void handleNotFound() { 
    server.sendHeader("Access-Control-Allow-Origin", "*"); 
    server.send(404, "text/plain", "Not found"); 
}

// Siapkan perangkat keras, jaringan, dan task firmware.
void setup() {
    Serial.begin(115200);
    delay(50);
    bootResetReason = esp_reset_reason();
    Serial.printf("\r\n[BOOT] reset_reason=%d (%s) free_heap=%u min_free_heap=%u\n",
        (int)bootResetReason, resetReasonName(bootResetReason), ESP.getFreeHeap(), ESP.getMinFreeHeap());
    Serial.println("[BUILD] ELOTO_FIXED AUTH=GPS_EARLY_ACQUISITION_V27");
    pinMode(TFT_CS_PIN, OUTPUT);
    digitalWrite(TFT_CS_PIN, HIGH);
    pinMode(SD_CS_PIN, OUTPUT);
    digitalWrite(SD_CS_PIN, HIGH);
    pinMode(TOUCH_CS_PIN, OUTPUT);
    digitalWrite(TOUCH_CS_PIN, HIGH);

    pinMode(SPI_MISO_PIN, INPUT_PULLUP);
    delay(300);

    spiBusMutex = xSemaphoreCreateRecursiveMutex();
    sdMutex = xSemaphoreCreateMutex();
    gpsMutex = xSemaphoreCreateMutex();
    networkQueue = xQueueCreate(20, sizeof(NetworkJob));
    if (!spiBusMutex || !sdMutex || !gpsMutex || !networkQueue) {
        while (true) delay(1000);
    }

    gpsSerial.setRxBufferSize(1024);
    gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
    gpsInitStarted = true;
    if (xTaskCreatePinnedToCore(gpsInitTask, "GPSInit", 4096,
            NULL, 1, NULL, 0) != pdPASS) {
        gpsInitStarted = false;
        Serial.printf("[GPS] Early init task creation failed; loop will retry free_heap=%u\n",
            ESP.getFreeHeap());
    } else {
        Serial.println("[GPS] Receiver startup started before SD mount");
    }

    if (initializeSDCard()) {
        sdCardMounted = true;
        sdCardStatusOk = true;
        sdProbeLockMisses = 0;
        loadUsersToRAM();
    } else {
        sdCardMounted = false;
        sdCardStatusOk = false;
    }

    tft.init();
    tft.setRotation(1);
    tft.setSwapBytes(true);
    tft.fillScreen(TFT_BLACK);

    digitalWrite(TFT_CS_PIN, HIGH);
    digitalWrite(TOUCH_CS_PIN, HIGH);
    digitalWrite(SD_CS_PIN, HIGH);
    delay(50);

    TJpgDec.setJpgScale(1);
    TJpgDec.setCallback(tft_output);
    
    rd6300Serial.end();
    delay(100);
    rd6300Serial.begin(9600, SERIAL_8N1, RD6300_RX_PIN, RD6300_TX_PIN);
    delay(500);
    while (rd6300Serial.available()) {
        rd6300Serial.read();
    }
    
    pinMode(PIN_RELAY, OUTPUT);
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_RELAY, LOW);
    digitalWrite(PIN_BUZZER, LOW);
    relayOpen = false;

    digitalWrite(PIN_BUZZER, HIGH); delay(80);
    digitalWrite(PIN_BUZZER, LOW);  delay(60);
    digitalWrite(PIN_BUZZER, HIGH); delay(80);
    digitalWrite(PIN_BUZZER, LOW);
    pinMode(PIN_AD_KEY, INPUT);
    
    WiFi.mode(WIFI_STA); 
    WiFi.setSleep(false);        // Mode tidur dimatikan agar negosiasi koneksi & IP 2x lebih cepat
    WiFi.setAutoReconnect(true); // Otomatis menyambung ulang jika terputus
    server.on("/status", HTTP_GET, handleStatus);
    server.on("/status", HTTP_OPTIONS, handleOptions);
    server.onNotFound(handleNotFound); 
    server.begin();
    
    if (xTaskCreatePinnedToCore(sdStorageWorkerTask, "SDStorage", 12288,
            NULL, 1, &sdStorageWorkerHandle, 1) != pdPASS) {
        sdStorageWorkerHandle = NULL;
        Serial.printf("[BOOT] SDStorage task creation failed; SD cache jobs disabled free_heap=%u\n",
            ESP.getFreeHeap());
    }
    if (xTaskCreatePinnedToCore(networkTaskCore1, "NetworkTask", 16384, NULL, 1, NULL, 1) != pdPASS) {
        Serial.printf("[BOOT] NetworkTask creation failed free_heap=%u\n", ESP.getFreeHeap());
    }
    logAuditAsync("SYS_INIT", "SYSTEM");
    clearMainScreenArea();
    
    if (sdCardMounted && loadSessionFromSD()) {
        buzzSuccess();
        tryConnectBestWifi();
    } else {
        // Otomatis langsung mencari dan menghubungkan jaringan di latar belakang saat dinyalakan (Non-Blocking)
        WiFi.setAutoReconnect(true);
        tryConnectBestWifi();
        currentState = STATE_WELCOME;
        selectedFooterAction = 1; // Default sorot tombol LANJUT
    }
    
    if (xTaskCreatePinnedToCore(geoScanTask, "BLEConfirm", 8192,
            NULL, 1, &geoTaskHandle, 1) != pdPASS) {
        geoTaskHandle = NULL;
        Serial.printf("[BOOT] BLEConfirm task creation failed free_heap=%u\n", ESP.getFreeHeap());
    } else {
        Serial.println("[BOOT] NetworkTask and BLEConfirm pinned to core 1; core 0 reserved for Wi-Fi");
    }
    forceFullRedraw = true;
    lastRenderedState = STATE_SYSTEM_ERROR;
    needsRedraw = true;
    drawScreen();
    Serial.printf("[DISPLAY] Startup screen rendered state=%s heap=%u\n",
        stateToString(currentState).c_str(), ESP.getFreeHeap());
}

// Jalankan layanan input, tampilan, GPS, dan status.
void loop() {
    static unsigned long lastLoopHealthLog = 0;
    if (millis() - lastLoopHealthLog >= 60000) {
        lastLoopHealthLog = millis();
        Serial.printf("[HEALTH] task=loop stack_high_water=%u free_heap=%u min_free_heap=%u\n",
            (unsigned int)uxTaskGetStackHighWaterMark(NULL), ESP.getFreeHeap(), ESP.getMinFreeHeap());
    }
    if (!gpsInitStarted && !gpsInitDone) {
        gpsInitStarted = true;
        if (xTaskCreatePinnedToCore(gpsInitTask, "GPSInit", 4096,
                NULL, 1, NULL, 0) != pdPASS) {
            gpsInitStarted = false;
        }
    }
    server.handleClient();
    feedGPS();
    serviceGeofence();

    // Auto-Online Recovery: Jika di layar offline tapi jaringan WiFi sudah siap/terhubung, otomatis beralih ke Mode Online
    if (currentState == STATE_SERVER_OFFLINE && WiFi.status() == WL_CONNECTED &&
        WiFi.localIP().toString() != "0.0.0.0") {
        buzzSuccess();
        Serial.printf("[WIFI] Wi-Fi sudah terhubung, pulihkan tampilan IP=%s\n", WiFi.localIP().toString().c_str());
        selectedFooterAction = 1;
        currentState = STATE_SHOW_IP;
        logAuditAsync("WIFI_CONNECTED", WiFi.localIP().toString());
        startupSyncPending = true;
        forceFullRedraw = true;
        needsRedraw = true;
    }

    static unsigned long lastSdProbe = 0;
    if (sdCardMounted && millis() - lastSdProbe >= 2000) {
        lastSdProbe = millis();
        probeMountedSDCard();
    }

    static unsigned long lastSdRecheck = 0;
    if (!sdCardMounted && millis() - lastSdRecheck >= SD_RECHECK_INTERVAL_MS) {
        lastSdRecheck = millis();
        bool mounted = false;
        if (sdMutex != NULL && takeSd(pdMS_TO_TICKS(500), "sd-remount") == pdTRUE) {
            mounted = initializeSDCard();
            if (mounted) {
                sdCardMounted = true;
                sdCardStatusOk = true;
                sdProbeLockMisses = 0;
            }
            digitalWrite(SD_CS_PIN, HIGH);
            giveSd();
        }
        if (mounted) {
            loadUsersToRAM();
            startupSyncPending = true;
            Serial.println("[SD_SYNC] SD mounted; requesting personnel cache sync");
            buzzSuccess();
        }
    }
    
    // Timer 1 detik: update jam sesi dan refresh status badge BLE/GPS/SD/WiFi
    if (millis() - lastClockUpdateMillis >= 1000) {
        lastClockUpdateMillis = millis();
        updateHeaderClock();
        bool wifiNow = WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0";
        bool gpsNow = hasValidGpsFix();
        bool gpsHasHistory = (!gpsNow && currentLatitude != 0.0 && currentLongitude != 0.0);
        bool sdNow = sdCardStatusOk;
        bool bleNow = geoHealthy && (geoCount > 0);

        static bool lastGpsState = false;
        static bool lastSdState = false;
        static bool lastWifiState = false;
        static bool lastGpsHistory = false;
        static bool lastBleState = false;
        static int lastGeoCount = -1;
        
        if (gpsNow != lastGpsState || sdNow != lastSdState || wifiNow != lastWifiState || gpsHasHistory != lastGpsHistory || bleNow != lastBleState || geoCount != lastGeoCount) {
            lastGpsState = gpsNow; lastSdState = sdNow; lastWifiState = wifiNow; lastGpsHistory = gpsHasHistory; lastBleState = bleNow; lastGeoCount = geoCount;

            // 1. Badge BLE
            drawBleBadge(bleNow);

            // 2. Badge GPS
            uint16_t gpsColor = gpsNow ? TFT_GREEN : (gpsHasHistory ? TFT_YELLOW : TFT_RED);
            tft.fillRoundRect(312, 8, 60, 25, 4, gpsColor);
            tft.setTextDatum(MC_DATUM);
            tft.setTextColor(TFT_BLACK, gpsColor);
            setStoryFont(9);
            String gpsText = gpsNow ? "GPS OK" : (gpsHasHistory ? "GPS LAST" : "GPS --");
            tft.drawString(gpsText, 342, 21);

            // 3. Badge SD
            tft.fillRoundRect(378, 8, 60, 25, 4, sdNow ? TFT_GREEN : TFT_RED);
            tft.setTextColor(TFT_BLACK, sdNow ? TFT_GREEN : TFT_RED);
            tft.drawString(sdNow ? "SD OK" : "SD --", 408, 21);

            // 4. Badge WiFi
            tft.fillRoundRect(444, 8, 28, 25, 4, wifiNow ? TFT_GREEN : TFT_RED);
            tft.setTextDatum(MC_DATUM);
            tft.setTextColor(TFT_BLACK, wifiNow ? TFT_GREEN : TFT_RED);
            tft.drawString(wifiNow ? "ON" : "--", 458, 21);
        }
    }
    
    if (needsRedraw) {
        drawScreen();
        drawGeofenceWarning();
        geoLastPaint = millis();
    } else if (uint32_t(millis() - geoLastPaint) >= 500) {
        drawGeofenceWarning();
        geoLastPaint = millis();
    }

    // Pembacaan tombol responsif langsung tanpa delay
    static uint8_t activeKeyRegistered = KEY_NONE;
    static unsigned long pressStartTimestamp = 0;
    static bool holdActionExecuted = false;
    uint8_t currentDebouncedKey = getDebouncedKey();
    
    bool hasLongPress = (
        (currentState == STATE_BOOT_IP || currentState == STATE_IDLE) && 
        (currentDebouncedKey == KEY_4 || currentDebouncedKey == KEY_5)
    ) || (currentState == STATE_REGISTER_RFID && currentDebouncedKey == KEY_5);

    if (currentDebouncedKey != KEY_NONE) {
        if (activeKeyRegistered == KEY_NONE) {
            activeKeyRegistered = currentDebouncedKey;
            pressStartTimestamp = millis();
            holdActionExecuted = false;

            digitalWrite(PIN_BUZZER, HIGH); delay(15); digitalWrite(PIN_BUZZER, LOW);

            if (!hasLongPress) {
                executeSystemAction(activeKeyRegistered, false);
                holdActionExecuted = true; 
            }
        } else if (activeKeyRegistered == currentDebouncedKey) {
            if (!holdActionExecuted && (millis() - pressStartTimestamp >= 3000)) {
                executeSystemAction(activeKeyRegistered, true);
                holdActionExecuted = true;
            }
        }
    } else {
        if (activeKeyRegistered != KEY_NONE) {
            if (!holdActionExecuted && (millis() - pressStartTimestamp >= 35)) {
                executeSystemAction(activeKeyRegistered, false);
            }
            activeKeyRegistered = KEY_NONE;
            holdActionExecuted = false;
        }
    }
    
    // Read RFID in every screen; role/session authorization stays in processRfidLogic().
    String authUID = checkRfidSensor();
    if (authUID != "") {
        lastRfidFrameMillis = millis();
        if (!rfidTapArmed) return;
        rfidTapArmed = false;
        unsigned long now = millis();
        bool sameCard = authUID.equalsIgnoreCase(lastScannedRfidUID);

        if (sameCard && (now - lastScannedRfidTime < 2500)) return;
        if (!sameCard && (now - lastScanTime < 50)) return;

        lastScannedRfidUID = authUID;
        lastScannedRfidTime = now;
        lastScanTime = now;

        processRfidLogic(authUID);
        clearRfidBuffer();
    } else if (!rfidTapArmed && millis() - lastRfidFrameMillis >= 150) {
        rfidTapArmed = true;
    }
}

// Susun dua baris status untuk LCD atau telemetri.
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
        lcd1 = isQueueSupervisor(safetyQueue.topIndex) ? "TAP PENGAWAS TERAKHIR" : "TAP MEKANIK TERAKHIR";
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
 