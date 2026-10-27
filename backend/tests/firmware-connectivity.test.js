import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { boxHardwareSnapshot } from '../../frontend/src/utils/boxHardware.js';

const firmwarePath = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
const firmware = readFileSync(firmwarePath, 'utf8');
const bleDashboard = readFileSync(fileURLToPath(new URL('../../frontend/src/pages/BleTagManager.jsx', import.meta.url)), 'utf8');

test('firmware separates Wi-Fi IP display from backend availability and retries synchronization', () => {
  assert.doesNotMatch(firmware, /device_token|X-Device-Token/i);
  assert.ok((firmware.match(/http\.addHeader\("X-Device-Id", getDeviceId\(\)\)/g) || []).length >= 7);
  assert.match(firmware, /device-handshake/);
  assert.match(firmware, /eloto-device-v1/);
  assert.match(firmware, /String\(response\["data"\]\["id_box"\] \| ""\) == getDeviceId\(\)/);
  assert.match(firmware, /#include "\.\.\/ServerDefaults\.h"/);
  assert.match(firmware, /server_host\s*=\s*eloto::DEFAULT_SERVER_BASE/);
  assert.match(firmware, /String device_id\s*=\s*"BOX-CLIENT-001"/);
  assert.doesNotMatch(firmware, /loadConfigFromSD/);
  const setup = firmware.split('void setup() {', 2)[1].split('\n// Jalankan layanan input', 1)[0];
  assert.doesNotMatch(setup, /loadConfigFromSD/);
  assert.match(setup, /xTaskCreatePinnedToCore\(sdMaintenanceTask, "SDMaintenance", 8192,\s*NULL, 1, &sdMaintenanceTaskHandle, 1\)/);
  assert.doesNotMatch(setup, /initializeSDCard\(\)/);
  assert.ok(setup.indexOf('if (initializeSDCardAtStartup())') < setup.indexOf('tft.init();'));
  const wifiConnect = firmware.split('bool tryConnectBestWifi() {', 2)[1].split('\n// Pastikan host merespons', 1)[0];
  assert.match(wifiConnect, /WiFi\.begin\(wifi_ssid\.c_str\(\), wifi_password\.c_str\(\)\)/);
  assert.match(wifiConnect, /WiFi\.status\(\) == WL_CONNECTED && WiFi\.localIP\(\)\.toString\(\) != "0\.0\.0\.0"/);

  const networkTask = firmware.split('void networkTaskCore1(void * pvParameters) {', 2)[1].split('\n// Antrekan event', 1)[0];
  assert.match(networkTask, /if \(WiFi\.status\(\) == WL_CONNECTED && server_host\.length\(\) > 0 && ESP\.getFreeHeap\(\) > 25000\)/);
  assert.doesNotMatch(networkTask, /if \(WiFi\.status\(\) == WL_CONNECTED && server_host\.length\(\) > 0 && ESP\.getFreeHeap\(\) > 25000 && sdCardMounted\)/);
  assert.match(networkTask, /logAuditAsync\("HEARTBEAT_SYNC"/);
  assert.match(networkTask, /if \(WiFi\.status\(\) == WL_CONNECTED && server_host\.length\(\) > 0 && sdCardMounted/);

  const connect = firmware.split('void connectWiFiRoutine() {', 2)[1].split('\nvoid executeFooterChoice', 1)[0];
  assert.match(connect, /if \(ipAssigned\) \{[\s\S]*?currentState = STATE_SHOW_IP/);
  assert.doesNotMatch(connect, /discoverServer\(\)/);
  const welcome = firmware.split('void executeFooterChoice() {', 2)[1].split('\nvoid executeSystemAction', 1)[0];
  assert.doesNotMatch(welcome, /discoverServer\(\)/);
  const offlineAction = welcome.split('currentState == STATE_SERVER_OFFLINE', 2)[1];
  assert.match(offlineAction, /WiFi\.status\(\) == WL_CONNECTED && WiFi\.localIP\(\)\.toString\(\) != "0\.0\.0\.0"[\s\S]{0,250}currentState = STATE_SHOW_IP/);
  assert.match(offlineAction, /if \(selectedFooterAction == 0\)/);
  assert.match(firmware, /lastBackendDiscoveryTask[\s\S]{0,200}discoverServer\(\)/);
  assert.match(firmware, /lastOfflineUploadTask[\s\S]{0,200}uploadOfflineLogsSDCard\(\)/);
  assert.match(firmware, /server_host = "";\s*discoverServer\(\);/);
  assert.match(firmware, /lastDiscoveryAttempt[\s\S]{0,150}millis\(\) - lastDiscoveryAttempt < 15000/);
});

test('GPS receiver starts before SD work and retries only when its AT/GNSS response is missing', () => {
  const setup = firmware.split('void setup() {', 2)[1].split('\n// Jalankan layanan input', 1)[0];
  const serialStart = setup.indexOf('gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX)');
  const taskStart = setup.indexOf('xTaskCreatePinnedToCore(gpsInitTask, "GPSInit"');
  const sdStart = setup.indexOf('if (initializeSDCard())');
  const atCommand = firmware.split('bool kirimPerintahAT(const char* perintah, unsigned long tunggu) {', 2)[1]
    .split('\n// Inisialisasi modem GPS', 1)[0];
  const init = firmware.split('void initGpsModule() {', 2)[1].split('\n// Pulihkan koneksi GPS', 1)[0];
  const poll = firmware.split('void feedGPS() {', 2)[1].split('\n// Bersihkan byte tertunda', 1)[0];

  assert.ok(serialStart >= 0 && taskStart > serialStart && sdStart > taskStart);
  assert.match(atCommand, /if \(line == "OK"\)/);
  assert.match(init, /attempt <= 5/);
  assert.match(init, /AT\+CGNSPWR=1/);
  assert.match(poll, /gpsIsLocked \? GPS_LOCKED_INTERVAL : GPS_POLL_INTERVAL/);
  assert.match(poll, /GPS_NO_RESPONSE_RECOVERY/);
  assert.match(firmware, /GPS_LOCKED_INTERVAL = 1000/);
  assert.match(firmware, /GPS_NO_RESPONSE_RECOVERY = 20000/);
  assert.match(firmware, /\[GPS\] Acquiring fix status=%s sats_used=%u sats_view=%u hdop=%s/);
});

test('firmware reports reset causes and task health for spontaneous reboot diagnosis', () => {
  assert.match(firmware, /#include <esp_system\.h>/);
  assert.match(firmware, /bootResetReason = esp_reset_reason\(\)/);
  assert.match(firmware, /case ESP_RST_BROWNOUT: return "BROWNOUT"/);
  assert.match(firmware, /case ESP_RST_TASK_WDT: return "TASK_WATCHDOG"/);
  assert.match(firmware, /doc\["reset_reason"\] = \(int\)bootResetReason/);
  assert.match(firmware, /doc\["reset_reason_name"\] = resetReasonName\(bootResetReason\)/);
  assert.match(firmware, /task=loop stack_high_water=%u free_heap=%u min_free_heap=%u/);
  assert.match(firmware, /task=NetworkTask core=%d stack_high_water=%u free_heap=%u min_free_heap=%u/);
  assert.match(firmware, /xTaskCreatePinnedToCore\(networkTaskCore1, "NetworkTask", 16384, NULL, 1, NULL, 1\)/);
  assert.match(firmware, /xTaskCreatePinnedToCore\(geoScanTask, "BLEConfirm", 8192,\s*NULL, 1, &geoTaskHandle, 1\)/);
  assert.match(firmware, /NetworkTask and BLEConfirm pinned to core 1; core 0 reserved for Wi-Fi/);
  assert.match(firmware, /task=BLEConfirm stack_high_water=%u free_heap=%u min_free_heap=%u/);
  assert.match(firmware, /"BLEConfirm", 8192/);
});

test('live device status reports the authoritative LOTO session timer', () => {
  const status = firmware.split('void handleStatus() {', 2)[1].split('\nvoid handleOptions()', 1)[0];
  assert.match(status, /doc\["session_active"\] = isSessionActive/);
  assert.match(status, /doc\["session_elapsed_ms"\] = isSessionActive \? uint32_t\(millis\(\) - sessionStartTime\) : 0/);
});

test('online RFID verification uses backend first and only falls back to SD when backend is unavailable', () => {
  const lookup = firmware.split('WorkerInfo fetchCardDataAPI(String uid) {', 2)[1]
    .split('\n// Kirim telemetri dan jalankan sinkronisasi jaringan', 1)[0];
  const backendLookup = lookup.indexOf('http.POST(requestBody)');
  const cacheFallback = lookup.indexOf('if (!card.isRegistered && offlineFallbackAllowed && !backendConfirmedMissing)');

  assert.ok(backendLookup >= 0 && cacheFallback > backendLookup);
  assert.match(lookup, /if \(!card\.isRegistered && offlineFallbackAllowed && !backendConfirmedMissing\) \{[\s\S]*?searchUserFromSDCard/);
  assert.match(lookup, /doc\["success"\] == true && doc\["is_valid"\] == true/);
  assert.match(lookup, /Backend responded HTTP %d; refusing local cache fallback/);
  assert.match(lookup, /offlineFallbackAllowed = !wifiConnected/);
  assert.match(lookup, /offlineFallbackAllowed = WiFi\.status\(\) != WL_CONNECTED/);
  assert.match(lookup, /httpCode == 404[\s\S]*?backendConfirmedMissing = true/);
  assert.match(lookup, /if \(!card\.isRegistered && !backendConfirmedMissing\) card\.lookupUnavailable = lookupUnavailable/);

  const tapLogic = firmware.split('void processRfidLogic(String uid) {', 2)[1]
    .split('\nbool tryConnectBestWifi()', 1)[0];
  assert.match(tapLogic, /WorkerInfo card = lookupCardForTap\(uid\)/);
  assert.match(tapLogic, /if \(!card\.isRegistered && card\.offlineFallbackAllowed\)/);
  assert.ok(tapLogic.indexOf('WorkerInfo card = lookupCardForTap(uid)') <
    tapLogic.indexOf('if (!card.isRegistered && card.offlineFallbackAllowed)'));
});

test('tap uses the VPS-synced personnel cache only while fresh, otherwise asks the backend', () => {
  const fast = firmware.split('WorkerInfo lookupCardForTap(String uid) {', 2)[1]
    .split('\n// Kirim telemetri dan jalankan sinkronisasi jaringan', 1)[0];
  const syncUsers = firmware.split('bool syncDatabaseToSDCard(bool syncPhotos) {', 2)[1]
    .split('\n// Jalankan permintaan sinkronisasi dashboard', 1)[0];
  const registerFlow = firmware.split('if (operationalState == STATE_REGISTER_RFID) {', 2)[1]
    .split('forceFullRedraw = true;', 1)[0];

  assert.match(firmware, /const uint32_t TAP_CACHE_MAX_AGE_MS = 300000;/);
  assert.match(fast, /lastUserSyncOkAt != 0 &&\s*uint32_t\(millis\(\) - lastUserSyncOkAt\) <= TAP_CACHE_MAX_AGE_MS/);
  assert.match(fast, /return fetchCardDataAPI\(uid\);/);
  assert.match(syncUsers, /sdSyncOk = true;\s*lastUserSyncOkAt = millis\(\);/);
  // Card registration must still be checked against the backend.
  assert.match(registerFlow, /WorkerInfo existingCard = fetchCardDataAPI\(uid\)/);
});

test('dashboard refreshes the timer from the live device even while telemetry says online', () => {
  const appContext = readFileSync(new URL('../../frontend/src/context/AppContext.jsx', import.meta.url), 'utf8');
  const boxController = readFileSync(new URL('../../backend/controllers/boxController.js', import.meta.url), 'utf8');
  assert.match(appContext, /if \(probeId && privateIp && probeDue\)/);
  assert.match(appContext, /catch \{ deviceProbeRef\.current\.status = null; \}/);
  assert.match(boxController, /session_active: typeof status\.session_active === 'boolean' \? status\.session_active : undefined/);
  assert.match(boxController, /session_elapsed_ms: Number\.isSafeInteger\(status\.session_elapsed_ms\)/);
});

test('SD mount and health probes run outside the responsive input loop', () => {
  const loop = firmware.split('void loop() {', 2)[1].split('\nvoid getLcdText', 1)[0];
  const setup = firmware.split('void setup() {', 2)[1].split('\nvoid loop()', 1)[0];
  const mountTask = firmware.split('void sdMaintenanceTask(void *unused) {', 2)[1]
    .split('\n// Pilih font TFT', 1)[0];
  const keypad = loop.split('uint8_t currentDebouncedKey = getDebouncedKey();', 2)[1]
    .split('// Auto-Online Recovery', 1)[0];

  assert.match(setup, /xTaskCreatePinnedToCore\(sdMaintenanceTask, "SDMaintenance"/);
  assert.doesNotMatch(setup, /initializeSDCard\(\)/);
  assert.match(mountTask, /mounted = initializeSDCard\(mountSpeeds\[mountSpeedIndex\]\)/);
  assert.match(mountTask, /probeMountedSDCard\(\)/);
  assert.match(mountTask, /loadUsersToRAM\(\)/);
  assert.match(mountTask, /bootRestoreStage == BOOT_RESTORE_WAITING/);
  assert.match(mountTask, /retryDelayMs = min\(retryDelayMs \* 2, 30000UL\)/);
  assert.match(setup, /drawScreen\(\);[\s\S]{0,250}xTaskCreatePinnedToCore\(sdMaintenanceTask/);
  assert.doesNotMatch(loop, /initializeSDCard\(\)|probeMountedSDCard\(\)/);
  assert.doesNotMatch(loop, /initializeSDCard\(\)/);
  assert.match(keypad, /bootSessionUserInput = true/);
  assert.match(keypad, /bootRestoreStage = BOOT_RESTORE_ABANDONED/);
  assert.ok(loop.indexOf('getDebouncedKey()') < loop.indexOf('serviceCountdown();'));
});

test('BLE snapshots report backend delivery and boot diagnostics without allocating under the scan lock', () => {
  const report = firmware.split('void reportBlePresence() {', 2)[1].split('\n// Gambar halaman informasi geofence', 1)[0];
  const criticalSection = report.split('portENTER_CRITICAL(&geoMux);', 2)[1].split('portEXIT_CRITICAL(&geoMux);', 1)[0];
  assert.match(criticalSection, /memcpy\(detectedTags\[i\], geoTags\[i\]\.mac/);
  assert.doesNotMatch(criticalSection, /DynamicJsonDocument|tags\.add/);
  assert.match(report, /blePresenceHttpStatus = httpCode/);
  assert.match(report, /\[BLE\] Presence report HTTP=%d tags=%u heap=%u/);
  assert.match(firmware, /doc\["ble_scan_ok"\] = geoHealthy/);
  assert.match(firmware, /doc\["ble_report_http"\] = blePresenceHttpStatus/);
  assert.match(firmware, /doc\["reset_reason_name"\] = resetReasonName\(bootResetReason\)/);

  const hardware = boxHardwareSnapshot({
    ble_report_http: 200, ble_report_tags: 2, ble_report_at_ms: 5000,
    reset_reason_name: 'BROWNOUT', free_heap: 40000, min_free_heap: 25000
  });
  assert.equal(hardware.ble_report_http, 200);
  assert.equal(hardware.ble_report_tags, 2);
  assert.equal(hardware.reset_reason_name, 'BROWNOUT');
  assert.equal(hardware.min_free_heap, 25000);
});

test('BLE detection, reporting, and dashboard refresh stay responsive without excessive database writes', () => {
  assert.match(firmware, /GEO_TAG_TIMEOUT_MS = 12000/);
  assert.match(firmware, /GEO_SCANNER_STALE_MS = 4000/);
  assert.match(firmware, /scan->setInterval\(100\)/);
  assert.match(firmware, /scan->setWindow\(60\)/);
  assert.match(firmware, /scan->getResults\(1000, false\)/);
  assert.match(firmware, /MIN_HEAP_TO_REPORT_BLE\s*=\s*18000/);
  assert.match(firmware, /millis\(\) - lastBlePresenceTask >= 3000/);
  assert.match(bleDashboard, /setInterval\(loadPresence, 3000\)/);
  assert.match(bleDashboard, /setInterval\(loadHistory, 5000\)/);
});

test('menu shows a selectable fifth Back option and restores its return screen', () => {
  const menuInput = firmware.split('if (currentState == STATE_MENU) {', 2)[1].split('\n    if (hasFooterChoice())', 1)[0];
  const menuScreen = firmware.split('else if (currentState == STATE_MENU) {', 2)[1].split('\n    else if (currentState == STATE_MEKANIK_OUT)', 1)[0];

  assert.match(menuInput, /selectedMenuIndex < 4/);
  assert.match(menuInput, /selectedMenuIndex == 4[\s\S]{0,100}currentState = menuReturnState/);
  assert.match(menuScreen, /"5\. KEMBALI"/);
  assert.match(menuScreen, /for \(uint8_t i = 0; i < 5; i\+\+\)/);
  assert.match(menuScreen, /drawTftFooter\("", ""\)/);
  assert.doesNotMatch(menuScreen, /TEKAN OK UNTUK MEMILIH|drawTftFooterSingle\("KEMBALI"\)/);
  assert.match(firmware, /doc\["menu_return_state"\]\s*=\s*\(int\)menuReturnState/);
  assert.match(firmware, /selectedMenuIndex = constrain\(\(int\)selectedMenuIndex, 0, 4\)/);
  assert.match(firmware, /savedMenuReturnState == STATE_WORKER_LIST \|\|[\s\S]{0,120}savedMenuReturnState == STATE_GEOFENCE/);
  assert.doesNotMatch(firmware, /if \(savedMenuReturnState == STATE_WORKER_LIST\) \{\s*menuReturnState = STATE_ALL_WORKERS_REGISTERED;/);
  assert.match(firmware, /menuReturnState = STATE_GEOFENCE;\s*currentState = STATE_MENU/);
});

test('firmware closes offline log files before replay and commits only successfully delivered records', () => {
  const uploader = firmware.split('void uploadOfflineLogsSDCard() {', 2)[1]
    .split('\n// Pembacaan kartu instan', 1)[0];
  const logClose = uploader.indexOf('logFile.close();');
  const unlock = uploader.indexOf('giveSd();', logClose);
  const post = uploader.indexOf('http.POST(payload)');
  assert.match(uploader, /doc\["replay"\] = true;/);
  assert.ok(logClose >= 0 && unlock > logClose && post > unlock);
  assert.match(uploader, /MAX_OFFLINE_SNAPSHOT_BYTES = 8192/);
  assert.match(uploader, /Snapshot read incomplete[\s\S]*keeping file unchanged/);
  assert.match(uploader, /Processing bounded batch selected=%u total=%u/);
  assert.match(uploader, /snapshot\.lastIndexOf\('\\n'\)/);
  assert.match(uploader, /offline-log-commit/);
  assert.match(uploader, /deliveredIds \+= "\\n" \+ originalId \+ "\\n"/);
  assert.match(uploader, /Uploaded and pruned %d records; unsent records retained/);
  assert.match(uploader, /Uploaded %d records but could not safely prune SD log; records retained/);
  assert.doesNotMatch(uploader, /while \(takeSd\(pdMS_TO_TICKS\(500\)/);
});

test('offline telemetry is confirmed as persisted and SD lock failures are reported', () => {
  const save = firmware.split('void saveOfflineLogToSDCard(String event, String uid, const String &eventId) {', 2)[1]
    .split('\n// Upload offline logs', 1)[0];
  assert.match(save, /takeSd\(pdMS_TO_TICKS\(500\), "offline-log-save"\)/);
  assert.match(save, /written == expected/);
  assert.match(save, /OFFLINE_SAVE.*event was not persisted/);
  assert.match(save, /OFFLINE_SAVE.*Append failed/);
});

test('RFID processing rejects bad checksums and requires a card-removal gap before another tap', () => {
  const parser = firmware.split('String extractRfidCardID() {', 2)[1].split('\nString checkRfidSensor()', 1)[0];
  assert.match(parser, /frame\.length\(\) == 12 && validateRDM6300Checksum\(frame\)/);
  assert.doesNotMatch(parser, /Fallback/);
  assert.match(firmware, /millis\(\) - lastRfidFrameMillis >= 150/);
  assert.match(firmware, /now - lastScanTime < 50/);
  assert.match(firmware, /now - lastScannedRfidTime < 2500/);
});
