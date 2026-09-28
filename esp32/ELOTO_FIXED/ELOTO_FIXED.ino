// E-LOTO integrated BLE confirmation / shared SPI / single-owner GPS
// Target: original dual-core ESP32 shield. See PANDUAN_ELOTO.md before upload.
#include <Arduino.h>
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
String device_id        = "";

// ============================================================================
// KONFIGURASI JARINGAN & SERVER
// ============================================================================
String wifi_ssid        = "vivoV29";
String wifi_password    = "112233445566";
String server_host      = "";  
String device_token     = "";  
const char* SERVER_PROJECT_PATH  = "";

const uint32_t NOTIFICATION_SUCCESS_DURATION = 1200;
const uint32_t NOTIFICATION_ERROR_DURATION   = 1500;
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
bool sdCardMounted        = false;
bool exitCountdownActive  = false;
volatile bool gpsInitStarted = false;
volatile bool gpsInitDone = false;
volatile bool gpsRecoveryRunning = false;

void initGpsModule();
void gpsInitTask(void *pvParameters) {
    initGpsModule();
    gpsInitDone = true;
    vTaskDelete(NULL);
}

bool hasValidGpsFix() {
    return gpsHasFix && currentLatitude >= -90.0 && currentLatitude <= 90.0 &&
            currentLongitude >= -180.0 && currentLongitude <= 180.0 &&
            (currentLatitude != 0.0 || currentLongitude != 0.0);
}

QueueHandle_t networkQueue;
SemaphoreHandle_t sdMutex = NULL;
SemaphoreHandle_t gpsMutex = NULL;
SemaphoreHandle_t spiBusMutex = NULL;

class SpiBusGuard {
public:
    SpiBusGuard() { configASSERT(spiBusMutex); xSemaphoreTakeRecursive(spiBusMutex, portMAX_DELAY); }
    ~SpiBusGuard() { xSemaphoreGiveRecursive(spiBusMutex); }
    SpiBusGuard(const SpiBusGuard&) = delete;
    SpiBusGuard& operator=(const SpiBusGuard&) = delete;
};

class SharedBusTft : public TFT_eSPI {
public:
#define TFT_GUARDED(method) \
    template<typename... A> auto method(A&&... a) \
        -> decltype(std::declval<TFT_eSPI&>().method(std::forward<A>(a)...)) { \
        SpiBusGuard guard; digitalWrite(SD_CS_PIN, HIGH); return TFT_eSPI::method(std::forward<A>(a)...); }
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
    TFT_GUARDED(getSetup)
    TFT_GUARDED(height)
    TFT_GUARDED(init)
    TFT_GUARDED(pushImage)
    TFT_GUARDED(setFreeFont)
    TFT_GUARDED(setRotation)
    TFT_GUARDED(setSwapBytes)
    TFT_GUARDED(setTextColor)
    TFT_GUARDED(setTextDatum)
    TFT_GUARDED(textWidth)
    TFT_GUARDED(width)
#undef TFT_GUARDED
};

BaseType_t takeSd(TickType_t timeout) {
    if (!sdMutex || !spiBusMutex) return pdFALSE;
    if (relayPulseActive) return pdFALSE;
    if (xSemaphoreTake(sdMutex, timeout) != pdTRUE) return pdFALSE;
    if (relayPulseActive) {
        xSemaphoreGive(sdMutex);
        return pdFALSE;
    }
    if (xSemaphoreTakeRecursive(spiBusMutex, timeout) != pdTRUE) {
        xSemaphoreGive(sdMutex); return pdFALSE;
    }
    digitalWrite(TFT_CS_PIN, HIGH);
    digitalWrite(TOUCH_CS_PIN, HIGH);
    return pdTRUE;
}
void giveSd() {
    digitalWrite(SD_CS_PIN, HIGH);
    xSemaphoreGiveRecursive(spiBusMutex);
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
const unsigned long GPS_POLL_TIMEOUT = 900;
const unsigned long GPS_NO_RESPONSE_RECOVERY = 15000;
const unsigned long GPS_RECOVERY_COOLDOWN = 30000;

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

bool startupSyncPending = true;

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
void syncDatabaseToSDCard();
WorkerInfo searchUserFromSDCard(String uid);
void saveOfflineLogToSDCard(String event, String uid, const String &eventId);
void uploadOfflineLogsSDCard();
void saveSessionToSD();
void clearSessionFromSD();
bool loadSessionFromSD();
WorkerInfo fetchCardDataAPI(String uid);
void rebuildCachedQueueString();
void logAuditAsync(String event, String uid);
void loadUsersToRAM();
void drawScreen();
void drawTftHeader();
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
void loadConfigFromSD();
void reportBlePresence();

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

bool initializeSDCard() {
    SpiBusGuard busGuard;
    digitalWrite(TFT_CS_PIN, HIGH);
    digitalWrite(TOUCH_CS_PIN, HIGH);
    digitalWrite(SD_CS_PIN, HIGH);
    pinMode(SPI_MISO_PIN, INPUT_PULLUP);
    static bool spiStarted = false;
    if (!spiStarted) {
        TFT_eSPI::getSPIinstance().begin(SPI_SCK_PIN, SPI_MISO_PIN, SPI_MOSI_PIN, SD_CS_PIN);
        spiStarted = true;
    }
    delay(300);

    SD.end();
    bool terhubung = false;
    const uint32_t sckSpeeds[] = { 1000000, 400000 };
    const uint8_t MAX_SD_RETRIES = sizeof(sckSpeeds) / sizeof(sckSpeeds[0]);

    for (uint8_t attempt = 0; attempt < MAX_SD_RETRIES; attempt++) {
        digitalWrite(TFT_CS_PIN, HIGH);
        digitalWrite(TOUCH_CS_PIN, HIGH);
        digitalWrite(SD_CS_PIN, HIGH);
        delay(50);

        bool mounted = SD.begin(SD_CS_PIN, TFT_eSPI::getSPIinstance(), sckSpeeds[attempt], "/sd", 5, false);
        if (mounted) {
            terhubung = true;
            break;
        }
        SD.end();
        digitalWrite(SD_CS_PIN, HIGH);
        delay(150);
    }

    if (!terhubung) {
        digitalWrite(SD_CS_PIN, HIGH);
        return false;
    }

    uint8_t cardType = SD.cardType();
    if (cardType == CARD_NONE) {
        SD.end();
        return false;
    }

    const char *testPath = "/.sd_health_test";
    if (SD.exists(testPath)) SD.remove(testPath);
    File testFile = SD.open(testPath, FILE_WRITE);
    if (!testFile) {
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
        SD.end();
        digitalWrite(SD_CS_PIN, HIGH);
        return false;
    }

    recoverSdFile("/session.json", "/session.json.tmp", "/session.json.bak");
    recoverSdFile("/users.csv", "/users.csv.tmp", "/users.csv.bak");
    recoverSdFile("/offline_logs.csv", "/offline_logs.csv.tmp", "/offline_logs.csv.bak");

    if (!SD.exists("/foto")) {
        SD.mkdir("/foto");
    }
    
    digitalWrite(SD_CS_PIN, HIGH);
    return terhubung;
}

void loadConfigFromSD() {
    if (!sdCardMounted || !SD.exists("/config.txt")) {
        Serial.println("[CONFIG] /config.txt tidak ditemukan");
        return;
    }
    File configFile = SD.open("/config.txt", FILE_READ);
    if (!configFile) {
        Serial.println("[CONFIG] Gagal membuka /config.txt");
        return;
    }
    while (configFile.available()) {
        String line = configFile.readStringUntil('\n');
        line.trim();
        if (line.length() == 0 || line.startsWith("#")) continue;
        if (line.startsWith("DEVICE_ID=")) {
            String value = line.substring(10); value.trim();
            if (value.length() > 0) device_id = value;
        } else if (line.startsWith("TOKEN=")) {
            String value = line.substring(6); value.trim();
            if (value.length() > 0) device_token = value;
        } else if (line.startsWith("SERVER=")) {
            server_host = line.substring(7); server_host.trim();
        } else if (line.startsWith("SSID=")) {
            wifi_ssid = line.substring(5); wifi_ssid.trim();
        } else if (line.startsWith("PASS=")) {
            wifi_password = line.substring(5); wifi_password.trim();
        }
    }
    configFile.close();
    Serial.println("[CONFIG] Device ID: " + getDeviceId());
    Serial.println("[CONFIG] Server: " + (server_host.length() > 0 ? server_host : "(gateway:5002)"));
    Serial.println("[CONFIG] Token: " + String(device_token.length() > 0 ? "configured" : "MISSING"));
}

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

String twoDigits(unsigned long value) {
    return value < 10 ? String("0") + String(value) : String(value);
}

void updateHeaderClock(bool forceRedraw) {
    static String lastClockText = "";
    if (!isSessionActive) {
        if (!forceRedraw && lastClockText.length() > 0) {
            tft.fillRect(175, 4, 130, 34, TFT_NAVY);
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

    tft.fillRect(175, 4, 130, 34, TFT_NAVY);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(ELOTO_BG, ELOTO_HEADER);
    setStoryFont(9);
    tft.drawString(clockText, 240, 21);
}

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
    
    bool gpsNow = hasValidGpsFix();
    bool gpsHasHistory = (!gpsNow && currentLatitude != 0.0 && currentLongitude != 0.0);
    uint16_t gpsColor = gpsNow ? TFT_GREEN : (gpsHasHistory ? TFT_YELLOW : TFT_RED);
    String gpsText = gpsNow ? "GPS OK" : (gpsHasHistory ? "GPS LAST" : "GPS --");

    tft.fillRoundRect(312, 8, 62, 25, 4, gpsColor);
    tft.fillRoundRect(378, 8, 62, 25, 4, sdCardMounted ? TFT_GREEN : TFT_RED);
    
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_BLACK, gpsColor);
    setStoryFont(9);
    tft.drawString(gpsText, 343, 21);
    
    tft.setTextColor(TFT_BLACK, sdCardMounted ? TFT_GREEN : TFT_RED);
    tft.drawString(sdCardMounted ? "SD OK" : "SD --", 409, 21);
    
    tft.fillRoundRect(444, 8, 28, 25, 4, networkColor);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_BLACK, networkColor);
    tft.drawString(wifiReady ? "ON" : "--", 458, 21);
}

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

bool drawPhotoFromAPI(String uid, int32_t boxX, int32_t boxY, uint16_t boxW, uint16_t boxH) {
    uid.trim(); uid.toUpperCase();
    if (uid == "" || ESP.getFreeHeap() < 40000) return false;

    String photoPath = "/foto/" + uid + ".jpg";
    bool photoExists = false;
    
    if (sdCardMounted) {
        if (takeSd(pdMS_TO_TICKS(100)) == pdTRUE) {
            photoExists = SD.exists(photoPath);
            digitalWrite(SD_CS_PIN, HIGH);
            giveSd();
        }
    }

    uint8_t *jpegData = NULL;
    size_t jpegSize = 0;

    if (!photoExists && WiFi.status() == WL_CONNECTED) {
        WiFiClient client; client.setTimeout(3000);
        HTTPClient http;
        String url = getApiUrl("users/photo/") + uid + "?size=" + String(PHOTO_DISPLAY_SIZE) + "&quality=82";
        http.begin(client, url);
        http.addHeader("Accept", "image/jpeg");
        http.addHeader("X-Device-Token", device_token);
        http.setTimeout(2500);

        int httpCode = http.GET();
        int contentLen = http.getSize();
        if (httpCode == HTTP_CODE_OK && contentLen > 100 && contentLen < 50000) {
            jpegSize = contentLen;
            jpegData = static_cast<uint8_t *>(malloc(jpegSize));
            if (jpegData != NULL) {
                WiFiClient *stream = http.getStreamPtr();
                size_t bytesRead = 0;
                unsigned long streamStart = millis();
                while (bytesRead < jpegSize && (millis() - streamStart) < 3000) {
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
                    if (sdCardMounted && takeSd(pdMS_TO_TICKS(200)) == pdTRUE) {
                        File f = SD.open(photoPath, FILE_WRITE);
                        if (f) {
                            f.write(jpegData, jpegSize);
                            f.close();
                        }
                        digitalWrite(SD_CS_PIN, HIGH);
                        giveSd();
                    }
                } else {
                    free(jpegData);
                    jpegData = NULL;
                    jpegSize = 0;
                }
            }
        }
        http.end();
    } 
    else if (photoExists && sdCardMounted) {
        if (takeSd(pdMS_TO_TICKS(200)) == pdTRUE) {
            File f = SD.open(photoPath, FILE_READ);
            if (f) {
                jpegSize = f.size();
                if (jpegSize > 100 && jpegSize < 50000) {
                    jpegData = static_cast<uint8_t *>(malloc(jpegSize));
                    if (jpegData != NULL) {
                        f.read(jpegData, jpegSize);
                    }
                }
                f.close();
            }
            digitalWrite(SD_CS_PIN, HIGH);
            giveSd();
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
        }
    }
    
    if (jpegData != NULL) free(jpegData);
    return drawn;
}

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

bool checkIsSupervisorRole(String role) {
    String r = role; r.toUpperCase(); r.trim();
    return (r.indexOf("PENGAWAS") != -1 || 
            r.indexOf("SUPERVISOR") != -1 || 
            r.indexOf("SPV") != -1 || 
            r.indexOf("K3") != -1 || 
            r.indexOf("ADMIN") != -1);
}

bool isQueueSupervisor(int index) {
    return index >= 0 && index <= safetyQueue.topIndex &&
            checkIsSupervisorRole(safetyQueue.workers[index].role);
}

int countQueueMechanics() {
    int count = 0;
    for (int i = 0; i <= safetyQueue.topIndex; i++) {
        if (!isQueueSupervisor(i)) count++;
    }
    return count;
}

int countQueueSupervisors() {
    int count = 0;
    for (int i = 0; i <= safetyQueue.topIndex; i++) {
        if (isQueueSupervisor(i)) count++;
    }
    return count;
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
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

int geoMechanicsTapped() {
    int total = 0;
    for (int i = 0; i <= safetyQueue.topIndex; ++i) {
        if (!isQueueSupervisor(i) && !isFuelmanRole(safetyQueue.workers[i].role)) ++total;
    }
    return total;
}

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

void reportBlePresence() {
    if (WiFi.status() != WL_CONNECTED || device_token.length() == 0 || ESP.getFreeHeap() < 30000) return;

    DynamicJsonDocument doc(1536);
    doc["id_box"] = getDeviceId();
    JsonArray tags = doc.createNestedArray("ble_tags");
    portENTER_CRITICAL(&geoMux);
    for (uint8_t i = 0; i < geoTagCount; ++i) tags.add(geoTags[i].mac);
    portEXIT_CRITICAL(&geoMux);

    WiFiClient client;
    client.setTimeout(1500);
    HTTPClient http;
    http.begin(client, getApiUrl("loto/presence"));
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", device_token);
    http.setTimeout(2500);
    String payload;
    serializeJson(doc, payload);
    int httpCode = http.POST(payload);
    if (httpCode < 200 || httpCode >= 300) Serial.printf("[BLE] Presence HTTP %d\n", httpCode);
    http.end();
}

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

void kirimPerintahAT(const char* perintah, unsigned long tunggu) {
    while (gpsSerial.available()) gpsSerial.read();
    gpsSerial.println(perintah);
    unsigned long mulai = millis();
    while (millis() - mulai < tunggu) {
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

void initGpsModule() {
    delay(1000);
    kirimPerintahAT("AT", 500);
    kirimPerintahAT("ATE0", 500);
    kirimPerintahAT("AT+CGNSPWR=1", 800);
    kirimPerintahAT("AT+CGNSPWR?", 500);
    kirimPerintahAT("AT+CGNSSEQ=\"RMC\"", 500);
    kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK101*32\"", 500); 
    kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK313,1*2E\"", 500); 
    kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK301,2*2E\"", 500); 
    kirimPerintahAT("AT+CGNSCMD=0,\"$PMTK220,500*2B\"", 500); 
    gpsLastPollMillis = millis();
    gpsLastValidResponseMillis = millis();
}

void gpsRecoveryTask(void *pvParameters) {
    kirimPerintahAT("AT", 700);
    kirimPerintahAT("AT+CGNSPWR=1", 1000);
    kirimPerintahAT("AT+CGNSPWR?", 700);
    gpsPollState = GPS_POLL_IDLE;
    gpsResponseBuffer = "";
    gpsLastPollMillis = millis();
    gpsLastValidResponseMillis = millis();
    gpsRecoveryRunning = false;
    vTaskDelete(NULL);
}

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
            gpsLastSerialLatitude  = currentLatitude;
            gpsLastSerialLongitude = currentLongitude;
            gpsLastSerialReportMillis = millis();
        }
        if (!firstGpsFixSent) {
            firstGpsFixSent = true;
            logAuditAsync("GPS_FIX_LOCKED", "SYSTEM");
        }
    }
}

void feedGPS() {
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
    } else {
        int bytesRead = 0;
        while (gpsSerial.available() && bytesRead < 64) {
            char c = gpsSerial.read();
            if (gpsResponseBuffer.length() < 512) gpsResponseBuffer += c;
            gpsByteCount++;
            gpsLastByteMillis = now;
            bytesRead++;
        }
        bool sudahDapat = gpsResponseBuffer.indexOf("+CGNSINF:") != -1 &&
                            gpsResponseBuffer.indexOf("OK") != -1;
        bool timeout = now - gpsPollStartMillis >= GPS_POLL_TIMEOUT;
        if (sudahDapat || timeout) {
            if (sudahDapat) parseGpsResponse(gpsResponseBuffer);
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
    if (gpsHasFix && now - gpsLastFixMillis > 30000) gpsHasFix = false;
    if (firstGpsFixSent && gpsLastFixMillis != 0 && now - gpsLastFixMillis > 60000)
        firstGpsFixSent = false;
}

void clearRfidBuffer() {
    unsigned long t = millis();
    while (rd6300Serial.available() > 0 && millis() - t < 60) {
        rd6300Serial.read();
    }
    rd6300ByteCount   = 0;
    rd6300LastByteTime = 0;
    memset(rd6300ByteBuffer, 0, RD6300_BUFFER_SIZE);
}

bool isValidRfidUID(const String &uid) {
    int len = uid.length();
    if (len != 8 && len != 10 && len != 12 && len != 14) return false;
    for (size_t i = 0; i < len; i++) {
        char c = uid.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f')))
            return false;
    }
    if (uid == "00000000" || uid == "0000000000" ||
        uid == "FFFFFFFF" || uid == "FFFFFFFFFF") return false;
    return true;
}

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
        if (frame.length() == 12) { 
            String uid = frame.substring(0, 10);
            if (isValidRfidUID(uid)) return uid;
        }
        if (isValidRfidUID(frame)) return frame;
    }

    String rawHex = "";
    for (uint16_t i = 0; i < rd6300ByteCount; i++) {
        char c = (char)rd6300ByteBuffer[i];
        if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F')) rawHex += c;
        else if (c >= 'a' && c <= 'f') rawHex += (char)(c - 32); 
    }
    if (isValidRfidUID(rawHex)) return rawHex;
    
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
    if (isValidRfidUID(byteHex)) return byteHex;

    return "";
}

String checkRfidSensor() {
    bool frameComplete = false;
    while (rd6300Serial.available() > 0) {
        uint8_t data = rd6300Serial.read();
        rd6300LastByteTime = millis();
        
        if (rd6300ByteCount < RD6300_BUFFER_SIZE) {
            rd6300ByteBuffer[rd6300ByteCount] = data;
            rd6300ByteCount++;
            if (data == 0x02 && rd6300ByteCount > 1) {
                rd6300ByteBuffer[0] = 0x02;
                rd6300ByteCount = 1;
            }
            else if (data == 0x03 || data == '\n' || data == '\r') { 
                frameComplete = true;
                break; 
            }
        } else {
            rd6300ByteCount = 0; 
        }
    }

    if (rd6300ByteCount > 0 && (frameComplete || (millis() - rd6300LastByteTime) > 20)) {
        String uid = extractRfidCardID();
        rd6300ByteCount = 0;
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

void buzzSuccess() {
    digitalWrite(PIN_BUZZER, HIGH); delay(400); // 400ms = Panjang 1 kali
    digitalWrite(PIN_BUZZER, LOW); 
}

void buzzFailed() {
    digitalWrite(PIN_BUZZER, HIGH); delay(150);
    digitalWrite(PIN_BUZZER, LOW);  delay(100);
    digitalWrite(PIN_BUZZER, HIGH); delay(150);
    digitalWrite(PIN_BUZZER, LOW);
}

void buzzTick() {
    digitalWrite(PIN_BUZZER, HIGH); delay(20);
    digitalWrite(PIN_BUZZER, LOW);
}

void countdownBeep(int detik) {
    if (detik <= 3) {
        digitalWrite(PIN_BUZZER, HIGH); delay(500);
        digitalWrite(PIN_BUZZER, LOW);  delay(500);
    } else {
        digitalWrite(PIN_BUZZER, HIGH); delay(60);
        digitalWrite(PIN_BUZZER, LOW);  delay(940);
    }
}

void clearMainScreenArea() {
    tft.fillRect(0, 42, 480, 228, ELOTO_BG);
    tft.drawRoundRect(8, 49, 464, 212, 6, TFT_DARKGREY);
}

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

void drawDecorativeLine(int16_t y, uint16_t color) {
    tft.drawFastHLine(60, y, 360, color);
    tft.fillCircle(240, y, 3, color);
    tft.fillCircle(60, y, 2, color);
    tft.fillCircle(420, y, 2, color);
}

void displayCardNotification(String uid, String name, String role, String statusMsg, bool isSuccess) {
    tft.fillRoundRect(14, 54, 452, 204, 8, ELOTO_BG);
    tft.drawRoundRect(14, 54, 452, 204, 8, ELOTO_HEADER);

    tft.fillRect(180, 70, 280, 160, ELOTO_BG); // Clear Text Area

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
        clearRfidBuffer();  
        if (millis() - startNotify > 200 && readADKeypadRaw() != KEY_NONE) break;
        delay(5);
    }

    clearMainScreenArea();
    clearRfidBuffer();
    lastScannedRfidUID = "";
    lastScannedRfidTime = 0;
    lastRenderedState = STATE_SYSTEM_ERROR;
    needsRedraw = true;
}

void displayErrorCardPopup(String uid, String title, String name, String role, String sid, String bottomHint) {
    tft.fillRoundRect(14, 54, 452, 204, 8, ELOTO_BG);
    tft.drawRoundRect(14, 54, 452, 204, 8, ELOTO_HEADER);

    tft.fillRect(180, 70, 280, 160, ELOTO_BG); // Clear Text Area

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

    clearMainScreenArea();
    clearRfidBuffer();
    lastScannedRfidUID = "";
    lastScannedRfidTime = 0;
    lastRenderedState = STATE_SYSTEM_ERROR;
    needsRedraw = true;
}

bool handleFuelmanTap(const String &uid, WorkerInfo &card) {
    if (!isFuelmanRole(card.role)) return false;

    activeFuelmanUID = uid;
    activeFuelmanName = card.name;

    buzzSuccess();
    logAuditAsync("REFUEL_START", uid);

    tft.fillRoundRect(14, 54, 452, 204, 8, ELOTO_BG);
    tft.drawRoundRect(14, 54, 452, 204, 8, TFT_GREEN);

    tft.fillRect(180, 70, 280, 160, ELOTO_BG); // Clear Text Area

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

void saveSessionToSD() {
    if (!sdCardMounted || sdMutex == NULL) return;
    if (takeSd(pdMS_TO_TICKS(150)) == pdTRUE) {
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

                    File verifyFile = SD.open(temporary, FILE_READ);
                    bool valid = verifyFile && expected > 0 && written == expected &&
                                verifyFile.size() == expected;
                    if (valid) {
                        doc.clear();
                        DeserializationError err = deserializeJson(doc, verifyFile);
                        valid = !err && doc["queue"].is<JsonArray>();
                    }
                    if (verifyFile) verifyFile.close();
                    if (valid) commitSdFile(active, temporary, backup);
                }
            }
        }
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
    }
}

void clearSessionFromSD() {
    if (!sdCardMounted || sdMutex == NULL) return;
    if (takeSd(pdMS_TO_TICKS(150)) == pdTRUE) {
        bool backupCleared = !SD.exists("/session.json.bak") || SD.remove("/session.json.bak");
        bool temporaryCleared = !SD.exists("/session.json.tmp") || SD.remove("/session.json.tmp");
        if (backupCleared && temporaryCleared) {
            SD.remove("/session.json");
        }
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
    }
}

bool loadSessionFromSD() {
    if (!sdCardMounted || sdMutex == NULL) return false;
    bool success = false;

    if (takeSd(pdMS_TO_TICKS(200)) == pdTRUE) {
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
                    if (validQueue && q.size() == 0 &&
                        (stateInt == STATE_SUPERVISOR_VALID || stateInt == STATE_SET_MEKANIK_COUNT ||
                        stateInt == STATE_MEKANIK_IN || stateInt == STATE_ALL_WORKERS_REGISTERED ||
                        stateInt == STATE_WORKER_LIST || stateInt == STATE_WORKER_DETAIL ||
                        stateInt == STATE_MENU || stateInt == STATE_MEKANIK_OUT ||
                        stateInt == STATE_WAIT_SPV_OUT || stateInt == STATE_SPV_OUT_CONFIRM)) {
                        validQueue = false;
                    }
                    
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
                        selectedFooterAction = doc["selected_footer"] | 1;
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

void loadUsersToRAM() {
    if (!sdCardMounted || sdMutex == NULL) {
        return;
    }
    if (takeSd(pdMS_TO_TICKS(200)) == pdTRUE) {
        bool usersReady = recoverSdFile("/users.csv", "/users.csv.tmp", "/users.csv.bak");
        if (usersReady && !SD.exists("/users.csv")) ramUserCount = 0;
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
        giveSd();
    }
}

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
    if (httpCode == HTTP_CODE_OK) {
        DynamicJsonDocument doc(6144);
        DeserializationError err = deserializeJson(doc, http.getStream());
        JsonArray arr = !err && doc["data"].is<JsonArray>() ? doc["data"].as<JsonArray>() : JsonArray();
        
        if (!err && !arr.isNull()) {
            int syncCount = 0;
            bool synced = false;
            if (takeSd(pdMS_TO_TICKS(500)) == pdTRUE) {
                const char *active = "/users.csv";
                const char *temporary = "/users.csv.tmp";
                const char *backup = "/users.csv.bak";
                if (recoverSdFile(active, temporary, backup)) {
                    File userFile = SD.open(temporary, FILE_WRITE);
                    if (userFile) {
                        bool writeOk = true;
                        size_t expectedBytes = 0;
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
                                String line = uid + "," + name + "," + role + "," + String(isSpv ? 1 : 0) + "," + sid;
                                if (userFile.print(line) != line.length() || userFile.write('\n') != 1) {
                                    writeOk = false;
                                    break;
                                }
                                expectedBytes += line.length() + 1;
                                syncCount++;
                            }
                        }
                        userFile.flush();
                        userFile.close();

                        File verifyFile = SD.open(temporary, FILE_READ);
                        bool valid = writeOk && verifyFile && verifyFile.size() == expectedBytes;
                        if (valid) {
                            int verifiedCount = 0;
                            while (verifyFile.available()) {
                                String line = verifyFile.readStringUntil('\n');
                                if (line.length() > 0) verifiedCount++;
                            }
                            valid = verifiedCount == syncCount;
                        }
                        if (verifyFile) verifyFile.close();
                        if (valid) synced = commitSdFile(active, temporary, backup);
                    }
                }
                digitalWrite(SD_CS_PIN, HIGH);
                giveSd();
            }
            if (!synced) {
                http.end();
                return;
            }
            loadUsersToRAM();
            vTaskDelay(pdMS_TO_TICKS(10));

            int usersToCache = ramUserCount;
            for (int i = 0; i < usersToCache; i++) {
                if (WiFi.status() != WL_CONNECTED || ESP.getFreeHeap() < 40000) break;
                String uid = ramUserCache[i].uid;
                uid.trim(); uid.toUpperCase();
                if (uid.length() == 0) continue;
                String photoPath = "/foto/" + uid + ".jpg";
                bool alreadyCached = false;
                if (sdCardMounted && takeSd(pdMS_TO_TICKS(100)) == pdTRUE) {
                    alreadyCached = SD.exists(photoPath);
                    digitalWrite(SD_CS_PIN, HIGH);
                    giveSd();
                }
                if (alreadyCached) continue;
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
                        if (sdCardMounted && takeSd(pdMS_TO_TICKS(200)) == pdTRUE) {
                            File f = SD.open(photoPath, FILE_WRITE);
                            if (f) { f.write((const uint8_t*)jpeg.c_str(), jpeg.length()); f.close(); }
                            digitalWrite(SD_CS_PIN, HIGH);
                            giveSd();
                        }
                    }
                }
                photoHttp.end();
                vTaskDelay(pdMS_TO_TICKS(15));
            }
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
    
    if (takeSd(pdMS_TO_TICKS(200)) == pdTRUE) {
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

void saveOfflineLogToSDCard(String event, String uid, const String &eventId) {
    if (!sdCardMounted || sdMutex == NULL) return;
    if (takeSd(pdMS_TO_TICKS(150)) == pdTRUE) {
        File logFile = SD.open("/offline_logs.csv", FILE_APPEND);
        if (logFile) {
            String latitude = hasValidGpsFix() ? String(currentLatitude, 6) : "";
            String longitude = hasValidGpsFix() ? String(currentLongitude, 6) : "";
            String stableId = eventId.length() > 0 ? eventId :
                                "off-" + String(millis()) + "-" + String(random(0x7fffffff), HEX);
            logFile.println(stableId + "," + event + "," + uid + "," + latitude + "," + longitude);
            logFile.close();
        } 
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
    }
}

void uploadOfflineLogsSDCard() {
    if (!sdCardMounted || WiFi.status() != WL_CONNECTED || sdMutex == NULL) return;
    if (ESP.getFreeHeap() < 30000) return;
    if (takeSd(pdMS_TO_TICKS(300)) != pdTRUE) return;

    const char *active = "/offline_logs.csv";
    const char *temporary = "/offline_logs.csv.tmp";
    const char *backup = "/offline_logs.csv.bak";
    if (recoverSdFile(active, temporary, backup) && SD.exists(active)) {
        File logFile = SD.open(active, FILE_READ);
        if (logFile) {
            File pendingFile = SD.open(temporary, FILE_WRITE);
            if (pendingFile) {
                bool stopped = false;
                bool writeOk = true;
                size_t pendingBytes = 0;
                while (logFile.available()) {
                    String line = logFile.readStringUntil('\n');
                    line.trim();
                    if (line.length() == 0) continue;

                    if (!stopped) {
                        int p1 = line.indexOf(',');
                        int p2 = p1 >= 0 ? line.indexOf(',', p1 + 1) : -1;
                        int p3 = p2 >= 0 ? line.indexOf(',', p2 + 1) : -1;
                        if (p1 > 0 && p2 > p1 + 1) {
                            String eventId = line.substring(0, p1);
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

                            WiFiClient client; client.setTimeout(2000);
                            HTTPClient http;
                            http.begin(client, getApiUrl("boxes/") + getDeviceIdPath() + "/telemetry");
                            http.addHeader("Content-Type", "application/json");
                            http.addHeader("X-Device-Token", device_token);
                            http.setTimeout(3000);
                            DynamicJsonDocument doc(512);
                            doc["event_id"] = eventId;
                            doc["id_box"] = getDeviceId();
                            doc["event"] = event;
                            doc["uid"] = uid;
                            doc["last_uid"] = uid;
                            doc["is_tap"] = isTapEventName(event);
                            doc["is_register_scan"] = event.indexOf("REGISTER_NEW_CARD") != -1;
                            doc["is_online"] = true;
                            if (latitude.length() > 0 && longitude.length() > 0) {
                                doc["lat"] = latitude.toDouble();
                                doc["lon"] = longitude.toDouble();
                                doc["lng"] = longitude.toDouble();
                                doc["gps_fix"] = true;
                            }
                            if (doc.overflowed()) {
                                http.end();
                            } else {
                                String payload; serializeJson(doc, payload);
                                xSemaphoreGiveRecursive(spiBusMutex);
                                int httpCode = http.POST(payload);
                                xSemaphoreTakeRecursive(spiBusMutex, portMAX_DELAY);
                                http.end();
                                if (httpCode >= 200 && httpCode < 300) {
                                    continue;
                                }
                            }
                        }
                        stopped = true;
                    }

                    if (pendingFile.print(line) != line.length() || pendingFile.write('\n') != 1) {
                        writeOk = false;
                        break;
                    }
                    pendingBytes += line.length() + 1;
                }
                pendingFile.flush();
                pendingFile.close();
                logFile.close();

                File verifyFile = SD.open(temporary, FILE_READ);
                bool valid = writeOk && verifyFile && verifyFile.size() == pendingBytes;
                if (verifyFile) verifyFile.close();
                if (valid) {
                    if (pendingBytes == 0) {
                        if (SD.remove(active)) SD.remove(temporary);
                    } else {
                        commitSdFile(active, temporary, backup);
                    }
                }
            } else {
                logFile.close();
            }
        }
    }
    digitalWrite(SD_CS_PIN, HIGH);
    giveSd();
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

    if (sdMutex != NULL && takeSd(pdMS_TO_TICKS(200)) == pdTRUE) {
        for (int i = 0; i < ramUserCount; i++) {
            if (ramUserCache[i].uid.equalsIgnoreCase(cleanUID) ||
                ramUserCache[i].uid.equalsIgnoreCase(decPadded) ||
                ramUserCache[i].uid.equalsIgnoreCase(decUnpadded)) {
                card = ramUserCache[i];
                digitalWrite(SD_CS_PIN, HIGH);
                giveSd();
                card.uid = cleanUID;
                card.isSpv = checkIsSupervisorRole(card.role);
                return card;
            }
        }
        digitalWrite(SD_CS_PIN, HIGH);
        giveSd();
    }

    if (sdCardMounted) {
        card = searchUserFromSDCard(cleanUID);
        if (!card.isRegistered) card = searchUserFromSDCard(decPadded);
        if (!card.isRegistered) card = searchUserFromSDCard(decUnpadded);
        if (card.isRegistered) {
            if (sdMutex != NULL && takeSd(pdMS_TO_TICKS(200)) == pdTRUE) {
                if (ramUserCount < MAX_RAM_USERS) {
                    ramUserCache[ramUserCount] = card;
                    ramUserCount++;
                }
                digitalWrite(SD_CS_PIN, HIGH);
                giveSd();
            }
            return card;
        }
    }

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
                }
            }
        }
        http.end();
    }
    return card;
}

void networkTaskCore0(void * pvParameters) {
    unsigned long lastWifiCheckTask = 0;
    unsigned long lastHeartbeatTask = 0;
    unsigned long lastDbSyncTask    = 0;
    unsigned long lastBlePresenceTask = 0;
    unsigned long lastReconnectAttempt = 0;
    bool wasWifiConnected = (WiFi.status() == WL_CONNECTED);
    uint8_t heartbeatFailCount = 0;         
    bool initialHeartbeatSent = false;      

    for (;;) {
        NetworkJob job;
        if (xQueueReceive(networkQueue, &job, pdMS_TO_TICKS(50)) == pdTRUE) {
            
            while(relayPulseActive) {
                vTaskDelay(pdMS_TO_TICKS(100)); 
            }

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
                    heartbeatFailCount = 0;
                } else {
                    heartbeatFailCount++;
                    saveOfflineLogToSDCard(String(job.event), String(job.uid), eventId);
                    if (heartbeatFailCount >= 3 && String(job.event) == "HEARTBEAT_SYNC") {
                        heartbeatFailCount = 0;
                        if (server_host.length() > 0) {
                            String oldHost = server_host;
                            server_host = "";  
                            if (!discoverServer()) {
                                server_host = oldHost;  
                            }
                        } else {
                            discoverServer();
                        }
                    }
                }
            } else if (WiFi.status() != WL_CONNECTED) {
                saveOfflineLogToSDCard(String(job.event), String(job.uid), String());
                heartbeatFailCount++;
            } else {
                saveOfflineLogToSDCard(String(job.event), String(job.uid), String());
            }
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
            } else if ((!wasWifiConnected || startupSyncPending || millis() - lastDbSyncTask > 120000) && ESP.getFreeHeap() > 30000) {
                bool justReconnected = !wasWifiConnected;
                wasWifiConnected = true;
                lastDbSyncTask = millis();
                if (justReconnected) discoverServer();
                syncDatabaseToSDCard();
                uploadOfflineLogsSDCard();
                startupSyncPending = false;
                logAuditAsync("HEARTBEAT_SYNC", lastScannedUID);
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
        vTaskDelay(pdMS_TO_TICKS(15));
    }
}

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
            regHasCard = true;
            regLastUID = uid;
            regLastSID = card.sid;
            regLastName = card.name;
            regLastRole = card.role;
            regLastStatus = "SUDAH TERDAFTAR!";
            regLastSuccess = false;
        } else {
            buzzSuccess(); logAuditAsync("REGISTER_NEW_CARD", uid);
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
    
    if (handleFuelmanTap(uid, card)) return;

    if (!card.isRegistered || card.name == "UNKNOWN" || card.name == "Tidak Terdaftar") {
        buzzFailed(); logAuditAsync("SCAN_REJECTED_UNREGISTERED", uid);
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
                bool firstSupervisor = supervisorUID.length() == 0;
                if (firstSupervisor) {
                    supervisorUID = uid; supervisorName = card.name; supervisorRole = "PENGAWAS";
                }
                if (!pushQueue(uid, card.sid, card.name, "PENGAWAS")) {
                    if (firstSupervisor) {
                        supervisorUID = ""; supervisorName = ""; supervisorRole = "";
                    }
                    buzzFailed(); logAuditAsync("SCAN_REJECTED_QUEUE_FULL", uid);
                    displayErrorCardPopup(uid, "ANTREAN PENUH", card.name, card.role, card.sid, "BATAS PERSONEL SUDAH TERCAPAI");
                    break;
                }
                buzzSuccess(); logAuditAsync(firstSupervisor ? "SUPERVISOR_LOCK_IN" : "SUPERVISOR_EXTRA_LOCK_IN", uid);
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
                if (!pushQueue(uid, card.sid, card.name, "MEKANIK")) {
                    buzzFailed(); logAuditAsync("SCAN_REJECTED_QUEUE_FULL", uid);
                    displayErrorCardPopup(uid, "ANTREAN PENUH", card.name, card.role, card.sid, "BATAS PERSONEL SUDAH TERCAPAI");
                    break;
                }
                buzzSuccess(); logAuditAsync("MECHANIC_LOG_IN", uid);
                
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
                    displayCardNotification(uid, leavingUser.name,
                        leavingSupervisor ? "PENGAWAS" : "MEKANIK", "TAP PENGAWAS UTAMA", true);
                } else {
                    currentState = STATE_MEKANIK_OUT;
                    displayCardNotification(uid, leavingUser.name,
                        leavingSupervisor ? "PENGAWAS" : "MEKANIK", "KELUAR BERHASIL", true);
                }
            } else if (workerIdx != -1) {
                buzzFailed(); logAuditAsync("PERSONNEL_LOG_OUT_WRONG_STACK_ORDER", uid);
                displayErrorCardPopup(uid, "SALAH URUTAN", card.name, card.role, card.sid, "TAP KARTU PERSONEL TERAKHIR");
            } else {
                buzzFailed(); logAuditAsync("PERSONNEL_LOG_OUT_NOT_FOUND", uid);
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

bool tryConnectBestWifi() {
    if (wifi_ssid.length() == 0 || wifi_ssid.startsWith("ISI_")) return false;
    WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());
    return true;
}

bool discoverServer() {
    if (server_host.length() > 0) return true;
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
            buf[len] = 0;
            String response = String(buf);
            response.trim();
            if (response.startsWith("ELOTO_SERVER|")) {
                server_host = response.substring(13);
                server_host.trim();
                udp.stop();
                return true;
            }
        }
        delay(10);
    }

    udp.stop();
    String gw = WiFi.gatewayIP().toString();
    if (gw.length() > 0 && gw != "0.0.0.0") {
        server_host = gw + ":5002";
        return true;
    }
    return false;
}

void connectWiFiRoutine() {
    currentState = STATE_CONNECTING;
    forceFullRedraw = true;
    drawScreen();

    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    delay(40);

    if (!tryConnectBestWifi()) {
        buzzFailed();
        selectedFooterAction = 1;
        currentState = STATE_SERVER_OFFLINE;
        forceFullRedraw = true;
        needsRedraw = true;
        return;
    }

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
        discoverServer();
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

void executeFooterChoice() {
    if (currentState == STATE_WELCOME) {
        if (selectedFooterAction == 0) {
            buzzSuccess();
            currentState = STATE_REGISTER_RFID;
            regHasCard = false;  
            logAuditAsync("ENTER_REGISTER_MODE", "ADMIN");
        } else {
            connectWiFiRoutine();
            return;
        }
    } else if (currentState == STATE_SERVER_OFFLINE) {
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
        currentState = (selectedFooterAction == 0) ? STATE_WELCOME : STATE_SYSTEM_READY;
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
            }
            exitCountdownActive = false;

            digitalWrite(PIN_RELAY, LOW); 
            relayOpen = false; 
            delay(500);
            relayPulseActive = false;

            currentState = STATE_MAINTENANCE_DONE;
            needsRedraw = true;
            drawScreen();
            delay(2000);
            
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

void drawScreen() {
    bool stateChanged = (currentState != lastRenderedState);
    bool workerIndexChanged = (currentState == STATE_WORKER_DETAIL && selectedWorkerIndex != lastRenderedWorkerIndex);
    
    if (stateChanged || workerIndexChanged || forceFullRedraw) {
        forceFullRedraw = false;
        photoAlreadyDrawn = false;
        
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
        bool wifiConfigured = wifi_ssid.length() > 0 && !wifi_ssid.startsWith("ISI_");
        drawCornerAccents(15, 55, 450, 208, ELOTO_DARK_RED);
        tft.setTextDatum(MC_DATUM);
        setStoryFont(12);
        tft.setTextColor(ELOTO_HEADER, TFT_BLACK);
        tft.drawString(wifiConfigured ? "JARINGAN TIDAK DITEMUKAN" : "WIFI BELUM DIATUR", 240, 75);
        drawDecorativeLine(95, ELOTO_DARK_RED);
        drawWifiIcon(240, 130, TFT_LIGHTGREY);
        setStoryFont(9);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.drawString(wifiConfigured ? "WIFI GAGAL TERHUBUNG" : "ISI SSID DI KODE", 240, 175);
        tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        tft.drawString(wifiConfigured ? "PILIH COBA LAGI ATAU MODE OFFLINE" : "PASANG SD ATAU PILIH MODE OFFLINE", 240, 210);
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
        int remainingPersonnel = safetyQueue.topIndex;
        String countText = "SISA: " + String(remainingPersonnel) + " PERSONEL";
        tft.fillRect(40, 180, 400, 30, TFT_BLACK);
        setStoryFont(12);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        tft.drawString(countText, 240, 195);
        setStoryFont(9);
        tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
        tft.drawString(isQueueSupervisor(safetyQueue.topIndex) ? "TAP PENGAWAS TERAKHIR" : "TAP MEKANIK TERAKHIR", 240, 225);
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

        tft.fillRect(15, 98, 450, 165, TFT_BLACK); 

        if (regHasCard) {
            tft.fillRect(25, 100, 140, 140, TFT_BLACK);
            tft.drawRect(25, 100, 140, 140, TFT_WHITE);
            
            tft.fillRect(175, 100, 290, 130, TFT_BLACK); 
            
            tft.setTextDatum(TL_DATUM);
            setStoryFont(9);
            tft.setTextColor(ELOTO_HEADER, TFT_BLACK);
            drawTextFit("STATUS : " + regLastStatus, 180, 108, 280, regLastSuccess ? TFT_GREEN : TFT_RED, TFT_BLACK, 9);
            tft.setTextColor(TFT_WHITE, TFT_BLACK);
            drawTextFit("NAMA   : " + regLastName, 180, 138, 280, TFT_WHITE, TFT_BLACK, 9);
            drawTextFit("ROLE   : " + regLastRole, 180, 160, 280, TFT_WHITE, TFT_BLACK, 9);

            if (regLastSuccess) {
                drawTextFit("UID    : " + regLastUID, 180, 182, 280, TFT_LIGHTGREY, TFT_BLACK, 9);
            } else {
                drawTextFit("UID    : " + regLastUID, 180, 182, 280, TFT_RED, TFT_BLACK, 9);
            }

            tft.setTextDatum(MC_DATUM);
            setStoryFont(9);
            tft.setTextColor(regLastSuccess ? TFT_GREEN : TFT_RED, TFT_BLACK);
            tft.drawString(regLastSuccess ? "TAP KARTU BERIKUTNYA ATAU KEMBALI" : "KARTU SUDAH ADA - TAP LAINNYA", 240, 240);
            
            if (!drawPhotoFromAPI(regLastUID, 25, 100, 140, 140)) {
                drawSinglePersonIcon(95, 170, 2.0, ELOTO_HEADER, false);
            }
        } else {
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
    doc["ble_count"] = geoCount;
    doc["mechanics_tapped"] = geoTapCount;
    doc["ble_healthy"] = geoHealthy;
    doc["ble_count_warning"] = geoWarning;
    doc["ble_is_connection_count"] = false;
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
    Serial.begin(115200);
    delay(50);
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

    if (initializeSDCard()) {
        sdCardMounted = true;
        loadConfigFromSD();
        loadUsersToRAM();
    } else {
        sdCardMounted = false;
    }

    tft.init();
    tft.setRotation(1);
    setup_t tftConfig;
    tft.getSetup(tftConfig);
    
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

    TJpgDec.setJpgScale(1);
    TJpgDec.setCallback(tft_output);
    gpsSerial.setRxBufferSize(1024);
    gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
    
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
    
    if (xTaskCreatePinnedToCore(networkTaskCore0, "NetworkTask", 16384, NULL, 1, NULL, 0) != pdPASS) {}
    logAuditAsync("SYS_INIT", "SYSTEM");
    clearMainScreenArea();
    
    if (sdCardMounted && loadSessionFromSD()) {
        buzzSuccess();
        tryConnectBestWifi();
    } else {
        currentState = STATE_WELCOME;
    }
    
    if (xTaskCreatePinnedToCore(geoScanTask, "BLEConfirm", 6144,
            NULL, 1, &geoTaskHandle, 0) != pdPASS) {
        geoTaskHandle = NULL;
    }
    forceFullRedraw = true;
    lastRenderedState = STATE_SYSTEM_ERROR;
    needsRedraw = true;
}

void loop() {
    if (!gpsInitStarted) {
        gpsInitStarted = true;
        if (xTaskCreatePinnedToCore(gpsInitTask, "GPSInit", 4096,
                NULL, 1, NULL, 0) != pdPASS) {
            gpsInitStarted = false;
        }
    }
    server.handleClient();
    feedGPS();
    serviceGeofence();

    static unsigned long lastSdRecheck = 0;
    if (!sdCardMounted && millis() - lastSdRecheck > 30000) {
        lastSdRecheck = millis();
        bool mounted = false;
        if (sdMutex != NULL && takeSd(pdMS_TO_TICKS(500)) == pdTRUE) {
            mounted = initializeSDCard();
            if (mounted) {
                sdCardMounted = true;
            }
            digitalWrite(SD_CS_PIN, HIGH);
            giveSd();
        }
        if (mounted) {
            loadUsersToRAM();
            buzzSuccess();
        }
    }
    
    if (millis() - lastClockUpdateMillis >= 1000) {
        lastClockUpdateMillis = millis();
        updateHeaderClock();
        bool wifiNow = WiFi.status() == WL_CONNECTED && WiFi.localIP().toString() != "0.0.0.0";
        bool gpsNow = hasValidGpsFix();
        bool gpsHasHistory = (!gpsNow && currentLatitude != 0.0 && currentLongitude != 0.0);
        bool sdNow = sdCardMounted;
        static bool lastGpsState = false;
        static bool lastSdState = false;
        static bool lastWifiState = false;
        static bool lastGpsHistory = false;
        
        if (gpsNow != lastGpsState || sdNow != lastSdState || wifiNow != lastWifiState || gpsHasHistory != lastGpsHistory) {
            lastGpsState = gpsNow; lastSdState = sdNow; lastWifiState = wifiNow; lastGpsHistory = gpsHasHistory;
            uint16_t gpsColor = gpsNow ? TFT_GREEN : (gpsHasHistory ? TFT_YELLOW : TFT_RED);
            tft.fillRoundRect(312, 8, 62, 25, 4, gpsColor);
            tft.setTextDatum(MC_DATUM);
            tft.setTextColor(TFT_BLACK, gpsColor);
            setStoryFont(9);
            String gpsText = gpsNow ? "GPS OK" : (gpsHasHistory ? "GPS LAST" : "GPS --");
            tft.drawString(gpsText, 343, 21);
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
        drawGeofenceWarning();
        geoLastPaint = millis();
    } else if (uint32_t(millis() - geoLastPaint) >= 500) {
        drawGeofenceWarning();
        geoLastPaint = millis();
    }

    static uint8_t activeKeyRegistered = KEY_NONE;
    static unsigned long pressStartTimestamp = 0;
    static bool holdActionExecuted = false;
    uint8_t currentDebouncedKey = getDebouncedKey();
    
    bool hasLongPress = (
        currentState == STATE_BOOT_IP || currentState == STATE_IDLE || 
        currentState == STATE_REGISTER_RFID || currentState == STATE_WAIT_SPV_IN || 
        currentState == STATE_MEKANIK_IN || currentState == STATE_MEKANIK_OUT || 
        currentState == STATE_WAIT_SPV_OUT
    );

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
            if (!holdActionExecuted && (millis() - pressStartTimestamp >= 45)) {
                executeSystemAction(activeKeyRegistered, false);
            }
            activeKeyRegistered = KEY_NONE;
            holdActionExecuted = false;
        }
    }
    
    bool rfidInputEnabled = (
        currentState == STATE_WAIT_SPV_IN ||
        currentState == STATE_MEKANIK_IN ||
        currentState == STATE_WAIT_SPV_OUT ||
        currentState == STATE_MEKANIK_OUT ||
        currentState == STATE_REGISTER_RFID
    );

    String authUID = checkRfidSensor();
    if (authUID != "") {
        if (!rfidInputEnabled) {
            clearRfidBuffer();
        } else {
            if (authUID == lastScannedRfidUID && (millis() - lastScannedRfidTime < 1500)) {
                clearRfidBuffer();
                return;
            }

            lastScannedRfidUID = authUID;
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