#include "../GpsNavigation.h"
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <algorithm>
#include <deque>
#include <iostream>
#include <map>
#include <vector>

using std::isfinite;

class String : public std::string {
public:
    using std::string::string;
    using std::string::operator=;
    int indexOf(const char *needle, size_t from = 0) const {
        size_t at = find(needle, from);
        return at == npos ? -1 : static_cast<int>(at);
    }
    int indexOf(char needle, size_t from = 0) const {
        size_t at = find(needle, from);
        return at == npos ? -1 : static_cast<int>(at);
    }
    bool startsWith(const char *prefix) const { return find(prefix) == 0; }
    void trim() { std::string::operator=(eloto::trimGpsField(*this)); }
    void replace(const char *before, const char *after) {
        size_t pos = 0;
        while ((pos = find(before, pos)) != npos) {
            std::string::replace(pos, std::string(before).size(), after);
            pos += std::string(after).size();
        }
    }
};

struct FakeUart {
    std::deque<char> rx;
    std::vector<std::string> commands;
    std::map<std::string, std::deque<std::string>> replies;
    unsigned long baud = 9600, expectedBaud = 0;
    void updateBaudRate(unsigned long value) { baud = value; }
    void receive(const std::string &value) { rx.insert(rx.end(), value.begin(), value.end()); }
    int available() const { return rx.size(); }
    int read() { char c = rx.front(); rx.pop_front(); return c; }
    void println(const char *command) {
        commands.push_back(command);
        if (expectedBaud && baud != expectedBaud) return;
        auto &script = replies[command];
        if (!script.empty()) {
            receive(script.front());
            script.pop_front();
        } else if (std::string(command) == "AT+CGNSPWR?") {
            receive("\r\n+CGNSPWR: 1\r\n\r\nOK\r\n");
        } else if (std::string(command) != "AT+CGNSINF") receive("\r\nOK\r\n");
    }
} gpsSerial;

struct FakeLog {
    std::vector<std::string> lines;
    template <typename... Args> void printf(const char *format, Args... args) {
        char buffer[2048];
        std::snprintf(buffer, sizeof(buffer), format, args...);
        lines.push_back(buffer);
    }
    void println(const char *line) { lines.push_back(line); }
} Serial;

unsigned long fakeNow = 0;
unsigned long millis() { return fakeNow; }
void delay(unsigned long ms) { fakeNow += ms; }
void vTaskDelay(unsigned long ms) { fakeNow += ms; }
unsigned long pdMS_TO_TICKS(unsigned long ms) { return ms; }
const int pdTRUE = 1, pdPASS = 1;
int gpsMutex = 1;
int xSemaphoreTake(int, unsigned long) { return pdTRUE; }
void xSemaphoreGive(int) {}
void vTaskDelete(void *) {}
unsigned recoveryTasks = 0;
int xTaskCreatePinnedToCore(void (*)(void *), const char *, int, void *, int, void *, int) {
    ++recoveryTasks;
    return pdPASS;
}
bool gpsHasFix = false, firstGpsFixSent = false;
bool gpsInitDone = true, gpsRecoveryRunning = false;
double currentLatitude = 0, currentLongitude = 0;
bool systemClockReady() { return true; }
void setClockFromGps(const String &) {}
void logAuditAsync(const char *, const char *) {}

#include "gps-under-test.inc"

std::string navigation(std::string fix = "1", std::string latitude = "-1.234567",
        std::string longitude = "116.123456", std::string utc = "20261027010101.000",
        std::string hdop = "1.2", std::string visible = "10", std::string used = "6",
        std::string cn0 = "42") {
    return "+CGNSINF: 1," + fix + "," + utc + "," + latitude + "," + longitude +
        ",32.000,0.00,0.0,1,," + hdop + ",1.5,1.0,," + visible + "," + used +
        ",0,," + cn0 + ",1.0,1.5\r\n\r\nOK\r\n";
}

void parse(const std::string &line) { parseGpsResponse(String(line.c_str())); }

void reset() {
    gpsSerial = FakeUart();
    Serial = FakeLog();
    fakeNow = 1000;
    gpsHasFix = gpsIsLocked = firstGpsFixSent = false;
    gpsRecoveryRunning = gpsPowerOffDetected = gpsRecoveryAttempted = false;
    gpsInitDone = true;
    gpsLastFixMillis = gpsLastValidResponseMillis = gpsSentenceCount = 0;
    gpsLastPollMillis = gpsLastRecoveryMillis = gpsCommunicationStartedAt = 0;
    currentLatitude = currentLongitude = 0;
    gpsLastFixUtc = gpsAtResponse = gpsResponseBuffer = "";
    gpsPollState = GPS_POLL_IDLE;
    gpsConsecutivePollFailures = 0;
    gpsUartBaud = 9600;
    gpsSearchTracking = false;
    gpsSearchStartedAt = gpsDebugPrintMillis = 0;
    recoveryTasks = 0;
}

int main() {
    eloto::GpsNavigationReading reading;
    assert(eloto::parseGpsNavigation(navigation().c_str(), reading));
    assert(reading.running && reading.fix && reading.satellitesUsed == 6);
    assert(reading.satellitesVisible == 10 && std::fabs(reading.hdop - 1.2) < .001);
    assert(reading.hdopValid && reading.satellitesVisibleValid && reading.satellitesUsedValid);
    assert(reading.cn0Valid && reading.cn0Max == 42);
    assert(eloto::parseGpsNavigation(navigation("1", "0", "116").c_str(), reading) && reading.fix);
    for (const auto &bad : {"nan", "inf", "-91", "nonsense", "-1.2garbage"}) {
        assert(eloto::parseGpsNavigation(navigation("1", bad).c_str(), reading));
        assert(!reading.fix);
    }
    assert(eloto::parseGpsNavigation(navigation("1", "0", "0").c_str(), reading) && !reading.fix);
    assert(eloto::parseGpsNavigation(navigation("1", "1", "181").c_str(), reading) && !reading.fix);
    assert(eloto::parseGpsNavigation(navigation("1", "1", "116", "invalid").c_str(), reading) && !reading.fix);
    assert(!eloto::parseGpsNavigation("+CGNSINF: 1,1,20261027010101.000,-1,116,0", reading));
    assert(!eloto::parseGpsNavigation("+CGNSINF: ERROR\r\n", reading));
    assert(eloto::parseGpsNavigation("+CGNSINF: 0,,,,,,,,,,,,,,,,,,,,\r\n", reading));
    assert(!reading.running && !reading.fix);

    // Empty quality fields cannot reuse the last precise reading.
    assert(eloto::parseGpsNavigation(navigation().c_str(), reading));
    assert(eloto::parseGpsNavigation(navigation("1", "1", "116", "20261027010101.000", "", "", "").c_str(), reading));
    assert(reading.fix && reading.hdop == 99.9f && reading.satellitesUsed == 0);
    assert(!reading.hdopValid && !reading.satellitesVisibleValid && !reading.satellitesUsedValid);
    assert(eloto::parseGpsNavigation(navigation("0", "", "", "", "", "0", "0", "0").c_str(), reading));
    assert(reading.cn0Valid && reading.cn0Max == 0 && reading.satellitesVisibleValid);
    assert(eloto::parseGpsNavigation(navigation("0", "", "", "", "", "", "", "").c_str(), reading));
    assert(!reading.cn0Valid && !reading.satellitesVisibleValid);
    assert(eloto::parseGpsNavigation(navigation("0", "", "", "", "", "", "", "56").c_str(), reading));
    assert(!reading.cn0Valid);

    const std::string rateCommand = "AT+CGNSCMD=0,\"$PMTK220,1000*1F\"";

    reset();
    gpsSerial.replies["AT"].push_back("\r\nERROR\r\n");
    assert(!kirimPerintahAT("AT", 100));
    gpsSerial.replies["AT"].push_back("\r\nNOT OK\r\n");
    assert(!kirimPerintahAT("AT", 100));
    assert(kirimPerintahAT("AT", 100));
    reset();
    gpsSerial.replies["AT"] = {"", "", "\r\nOK\r\n"};
    initGpsModule();
    assert(gpsSerial.commands[0] == "AT" && gpsSerial.commands[2] == "AT");
    assert(gpsSerial.commands.back() == rateCommand);
    assert(std::count(gpsSerial.commands.begin(), gpsSerial.commands.end(), "AT+CGNSPWR=1") == 0);

    reset();
    gpsSerial.replies["AT+CGNSPWR?"] = {"\r\n+CGNSPWR: 0\r\nOK\r\n", "\r\n+CGNSPWR: 1\r\nOK\r\n"};
    initGpsModule();
    assert(std::count(gpsSerial.commands.begin(), gpsSerial.commands.end(), "AT+CGNSPWR=1") == 1);
    assert(gpsSerial.commands.back() == rateCommand);
    reset();
    gpsLastPollMillis = 123;
    gpsSerial.replies[rateCommand].push_back("\r\nERROR\r\n");
    initGpsModule();
    assert(gpsLastPollMillis != 123); // Optional MTK setting cannot prevent navigation polling.

    reset();
    gpsSerial.expectedBaud = 115200;
    initGpsModule();
    assert(gpsUartBaud == 115200 && gpsSerial.baud == 115200);
    assert(gpsSerial.commands.back() == rateCommand);
    for (const auto &command : gpsSerial.commands)
        assert(command.find("AT+IPR") == std::string::npos && command != "AT&W");
    reset();
    gpsSerial.expectedBaud = 921600; // No response at any supported baud.
    gpsLastPollMillis = 123;
    initGpsModule();
    assert(gpsUartBaud == 9600 && gpsSerial.baud == 9600);
    assert(gpsLastPollMillis == 123); // Initialization cannot claim success.

    // Missing HDOP/CN0 must be printed as unknown; preserve search time until a fix.
    reset();
    parse(navigation("0", "", "", "", "", "", "", ""));
    assert(gpsSearchTracking && gpsSearchStartedAt == fakeNow);
    assert(std::any_of(Serial.lines.begin(), Serial.lines.end(), [](const std::string &line) {
        return line.find("hdop=NA") != std::string::npos && line.find("cn0_max_dbhz=NA") != std::string::npos;
    }));
    fakeNow += 3000;
    parse(navigation("0"));
    assert(gpsSearchStartedAt == 1000);
    parse(navigation());
    assert(hasValidGpsFix() && !gpsSearchTracking);

    // A full response queued while the UI was busy must be parsed even after timeout.
    reset();
    feedGPS();
    assert(gpsPollState == GPS_POLL_WAITING);
    assert(navigation().size() > 64);
    fakeNow += GPS_POLL_TIMEOUT + 100;
    gpsSerial.receive(navigation());
    feedGPS();
    assert(gpsSentenceCount == 1 && hasValidGpsFix() && gpsIsLocked);
    assert(gpsSerial.available() == 0);

    // Still poll a precise fix; no spurious recovery during normal operation.
    fakeNow += GPS_LOCKED_INTERVAL;
    feedGPS();
    assert(gpsSerial.commands.size() == 2);
    gpsSerial.receive(navigation("1", "-1.234567", "116.123456", "20261027010106.000"));
    feedGPS();
    assert(recoveryTasks == 0 && gpsSentenceCount == 2);

    parse(navigation("0"));
    assert(!gpsHasFix && !gpsIsLocked && !firstGpsFixSent);
    assert(currentLatitude != 0); // History remains available.
    for (int i = 0; i < 70; ++i) {
        fakeNow += 1000;
        parse(navigation("0"));
        feedGPS();
        assert(recoveryTasks == 0); // No fix is not loss of modem communication.
    }

    reset();
    parse(navigation());
    fakeNow += GPS_FIX_MAX_AGE;
    assert(!hasValidGpsFix()); // Readers reject stale fix even before loop resumes.
    parse(navigation());
    assert(!gpsHasFix && !gpsIsLocked); // Frozen UTC cannot renew stale coordinates.

    reset();
    parse(navigation());
    fakeNow += GPS_FIX_MAX_AGE;
    feedGPS();
    assert(!gpsHasFix && !gpsIsLocked);
    fakeNow += GPS_NO_RESPONSE_RECOVERY;
    feedGPS();
    assert(!gpsRecoveryRunning && gpsConsecutivePollFailures == 1);
    feedGPS();
    fakeNow += GPS_POLL_TIMEOUT;
    feedGPS();
    assert(gpsRecoveryRunning && recoveryTasks == 1);
    gpsRecoveryRunning = false; // Emulate a completed recovery with no valid reply yet.
    feedGPS();
    assert(recoveryTasks == 1); // Cooldown prevents repeated initialization.

    reset();
    fakeNow += 60000; // SD startup/UI delay alone must not cause recovery.
    feedGPS();
    assert(gpsPollState == GPS_POLL_WAITING && recoveryTasks == 0);
    gpsSerial.receive(navigation());
    feedGPS();
    assert(hasValidGpsFix() && recoveryTasks == 0);

    reset();
    parse("+CGNSINF: 0,,,,,,,,,,,,,,,,,,,,\r\n");
    feedGPS();
    assert(recoveryTasks == 1 && !gpsHasFix);
    std::cout << "GPS parser, AT handshake, late RX, continuous polling, fix loss and recovery passed\n";
}
