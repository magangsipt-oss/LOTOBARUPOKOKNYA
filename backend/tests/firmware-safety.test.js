import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('firmware host helpers preserve replay identity and reject corrupt restore/host input', t => {
  try { execFileSync('g++', ['--version'], { stdio: 'ignore' }); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('g++ unavailable; Arduino sketch compilation and hardware validation remain separate');
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), 'eloto-firmware-test-'));
  try {
    const binary = join(directory, 'firmware-safety');
    const source = fileURLToPath(new URL('../../esp32/tests/firmware-safety.test.cpp', import.meta.url));
    execFileSync('g++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', source, '-o', binary], { stdio: 'inherit' });
    assert.doesNotThrow(() => execFileSync(binary, { stdio: 'inherit' }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('firmware keeps its device identity available and reloads SD config after a delayed mount', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');

  assert.match(source, /#include "device_secrets\.h"/);
  assert.match(source, /String device_id\s*=\s*ELOTO_DEVICE_ID;/);
  assert.match(source, /http\.addHeader\("X-Device-Id", getDeviceId\(\)\)/);
  assert.doesNotMatch(source, /DEVICE_TOKEN|X-Device-Token/);
  const setup = source.split('void setup() {', 2)[1].split('\nvoid loop()', 1)[0];
  assert.ok(setup.indexOf('loadCompiledConfigDefaults();') < setup.indexOf('initializeSDCard()'));
  assert.match(source, /sdConfigReloadPending && sdCardMounted[\s\S]{0,500}loadConfigFromSD\(\)/);
});

test('firmware renders the boot UI before starting SD maintenance and session recovery', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const setup = source.split('void setup() {', 2)[1].split('\nvoid loop()', 1)[0];
  const clearIndex = setup.indexOf('clearMainScreenArea();');
  const firstRenderIndex = setup.indexOf('drawScreen();');
  const renderIndex = setup.indexOf('drawScreen();', clearIndex);
  const maintenanceTaskIndex = setup.indexOf('xTaskCreatePinnedToCore(sdMaintenanceTask', renderIndex);
  const displayInitIndex = setup.indexOf('tft.init();');

  assert.ok(clearIndex >= 0);
  assert.ok(renderIndex > clearIndex && maintenanceTaskIndex > renderIndex);
  assert.ok(displayInitIndex >= 0 && displayInitIndex < firstRenderIndex);
  assert.ok(firstRenderIndex >= displayInitIndex && firstRenderIndex < maintenanceTaskIndex);
  assert.match(setup, /currentState = STATE_WELCOME;[\s\S]*drawScreen\(\)/);
  assert.doesNotMatch(setup, /initializeSDCard\(\)|loadSessionFromSD\(/);
  assert.ok(setup.indexOf('if (initializeSDCardAtStartup())') < setup.indexOf('tft.init();'));
  assert.match(source, /bool restored = loadSessionFromSD\(true\)/);
  assert.match(setup, /bootRestoreDeadlineAt = millis\(\) \+ BOOT_SESSION_RESTORE_TIMEOUT_MS/);
  assert.match(setup.slice(clearIndex, renderIndex), /forceFullRedraw = true;[\s\S]*needsRedraw = true;/);
});

test('shared SPI pins and chip selects are initialized before the SD card is mounted', () => {
  const source = readFileSync(fileURLToPath(
    new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url)
  ), 'utf8');
  const setup = source.split('void setup() {', 2)[1].split('\nvoid loop()', 1)[0];
  const init = source.split('bool initializeSDCard(uint32_t clockHz) {', 2)[1]
    .split('\n// Confirm that the mounted filesystem', 1)[0];
  const spiInit = source.split('bool beginSharedSPI() {', 2)[1]
    .split('\n// Pasang SD', 1)[0];

  assert.match(source, /#define SPI_SCK_PIN\s+18/);
  assert.match(source, /#define SPI_MISO_PIN\s+19/);
  assert.match(source, /#define SPI_MOSI_PIN\s+23/);
  assert.match(source, /#define SD_CS_PIN\s+5/);
  assert.match(setup, /releaseSpiChipSelects\(\);/);
  assert.match(source, /void releaseSpiChipSelects\(\) \{[\s\S]*digitalWrite\(TFT_CS_PIN, HIGH\);[\s\S]*digitalWrite\(SD_CS_PIN, HIGH\);[\s\S]*digitalWrite\(TOUCH_CS_PIN, HIGH\);/);
  assert.match(setup, /if \(initializeSDCardAtStartup\(\)\)[\s\S]{0,220}loadUsersToRAM\(\)[\s\S]{0,120}tft\.init\(\)/);
  assert.ok(setup.indexOf('if (initializeSDCardAtStartup())') < setup.indexOf('tft.init();'));
  assert.match(spiInit, /TFT_eSPI::getSPIinstance\(\)\.begin\(\s*SPI_SCK_PIN, SPI_MISO_PIN, SPI_MOSI_PIN, SD_CS_PIN/);
  assert.match(spiInit, /if \(!TFT_eSPI::getSPIinstance\(\)\.begin/);
  assert.match(init, /if \(!beginSharedSPI\(\)\)[\s\S]{0,100}return false/);
  assert.match(init, /diagnoseSdSpiHandshake\(\);[\s\S]*SD\.begin\(/);
  assert.match(source, /CMD0=0x%02X CMD8=0x%02X/);
  assert.match(init, /SD\.begin\(\s*SD_CS_PIN, TFT_eSPI::getSPIinstance\(\), clockHz/);
  assert.match(init, /MAX_MOUNT_ROUNDS = 3/);
  assert.doesNotMatch(init, /for \(uint8_t speed/);
});

test('firmware restores one-time SD startup settling without slowing mount retries', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const init = source.split('bool initializeSDCard(uint32_t clockHz) {', 2)[1]
    .split('\n// Confirm that the mounted filesystem', 1)[0];

  assert.match(init, /static bool startupSettlingDone = false/);
  assert.match(init, /if \(!startupSettlingDone\) \{\s*delay\(600\);\s*startupSettlingDone = true;\s*\}/);
  assert.match(init, /SD\.end\(\);[\s\S]*clockSdBusIdle\(\);[\s\S]*delay\(round == 0 \? 100 : 300\);/);
  assert.match(source, /SD_STARTUP_RETRY_V31/);
});

test('firmware retries all known SD clocks before initializing the display', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const startup = source.split('bool initializeSDCardAtStartup() {', 2)[1]
    .split('\n// Confirm that the mounted filesystem', 1)[0];
  const setup = source.split('void setup() {', 2)[1].split('\nvoid loop()', 1)[0];

  assert.match(startup, /const uint32_t mountSpeeds\[\] = \{ 1000000, 400000, 100000 \}/);
  assert.match(startup, /for \(uint32_t clockHz : mountSpeeds\)[\s\S]*initializeSDCard\(clockHz\)/);
  assert.ok(setup.indexOf('initializeSDCardAtStartup()') < setup.indexOf('tft.init();'));
});

test('mounted SD health checks use raw sector reads instead of heap-allocating root opens', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const probe = source.split('bool probeMountedSDCard() {', 2)[1]
    .split('\nvoid sdMaintenanceTask', 1)[0];

  assert.match(probe, /static uint8_t sectorZero\[512\]/);
  assert.match(probe, /SD\.readRAW\(sectorZero, 0\)/);
  assert.doesNotMatch(probe, /SD\.open\("\/"\)/);
  assert.match(probe, /Presence read failed card_type=%u free_heap=%u largest_block=%u/);
});

test('firmware abandons a stalled boot SD session restore and enters the UI', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const restore = source.split('bool loadSessionFromSD(bool bootRestore) {', 2)[1]
    .split('\nvoid loadUsersToRAM', 1)[0];
  const loop = source.split('void loop() {', 2)[1].split('\n// Susun dua baris status', 1)[0];

  assert.match(source, /BOOT_SESSION_RESTORE_TIMEOUT_MS\s*=\s*5000/);
  assert.match(restore, /mayApply = !bootRestore \|\|[\s\S]{0,100}bootRestoreStage == BOOT_RESTORE_READING/);
  assert.match(loop, /BOOT_RESTORE_READING[\s\S]*BOOT_SESSION_RESTORE_TIMEOUT_MS[\s\S]*BOOT_RESTORE_ABANDONED/);
  assert.match(loop, /currentDebouncedKey != KEY_NONE[\s\S]{0,150}bootSessionUserInput = true/);
  assert.match(loop, /bootRestoreStage = BOOT_RESTORE_ABANDONED/);
  assert.match(restore, /bootRestoreStage = BOOT_RESTORE_APPLYING/);
});

test('unavailable SD retries in the maintenance task with capped backoff', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const maintenanceTask = source.split('void sdMaintenanceTask(void *unused) {', 2)[1]
    .split('\n// Pilih font TFT', 1)[0];
  const loop = source.split('void loop() {', 2)[1].split('\n// Susun dua baris status', 1)[0];
  assert.match(maintenanceTask, /uint32_t retryDelayMs = 250/);
  assert.match(maintenanceTask, /vTaskDelay\(pdMS_TO_TICKS\(50\)\)/);
  assert.match(maintenanceTask, /initializeSDCard\(mountSpeeds\[mountSpeedIndex\]\)/);
  assert.match(maintenanceTask, /mountSpeedIndex = \(mountSpeedIndex \+ 1\)/);
  assert.match(maintenanceTask, /retryDelayMs = min\(retryDelayMs \* 2, 30000UL\)/);
  assert.match(maintenanceTask, /sdMaintenanceBusy = true/);
  assert.match(maintenanceTask, /sdMaintenanceBusy = false/);
  assert.doesNotMatch(loop, /initializeSDCard\(\)|probeMountedSDCard\(\)/);
  assert.doesNotMatch(source, /lastSdRecheck/);
});

test('firmware loads indexed Wi-Fi profiles and rotates after a connection timeout', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');

  assert.match(source, /parseIndexedWifiKey\([\s\S]{0,180}MAX_WIFI_PROFILES/);
  assert.match(source, /activeWifiProfileIndex = \(activeWifiProfileIndex \+ 1\) % MAX_WIFI_PROFILES/);
  assert.match(source, /WiFi\.begin\(wifi_ssid\.c_str\(\), wifi_password\.c_str\(\)\)/);
});

test('firmware declares custom GPS return type before Arduino prototype generation', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');

  assert.match(source, /struct GpsSnapshot \{[^}]+\};\s*GpsSnapshot readGpsSnapshot\(\);/);
});

test('firmware retries SD event records with byte-accurate acknowledgement', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');

  assert.match(source, /\[TELEMETRY\] HTTP %d event=%s try=%u/);
  assert.match(source, /\[TELEMETRY_RETRY\] HTTP %d event=%s/);
  assert.match(source, /source\.seek\(acknowledgedBytes\)/);
  assert.match(source, /copiedBytes == expectedBytes/);
  assert.match(source, /MAX_OFFLINE_BATCH = 1/);
  assert.match(source, /OFFLINE_LOG_SYNC_INTERVAL_MS = 2000/);
  assert.match(source, /!startupSyncPending && millis\(\) - lastOfflineUploadTask >= OFFLINE_LOG_SYNC_INTERVAL_MS[\s\S]{0,250}sdSyncOk[\s\S]{0,250}uploadOfflineLogsSDCard\(\)/);
});

test('firmware fetches profile photos in the background and never blocks card notification rendering', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');

  assert.match(source, /getApiUrl\("users\/photo\/"\)/);
  assert.match(source, /http\.addHeader\("X-Device-Id", getDeviceId\(\)\)/);
  assert.equal((source.match(/(?:http|retryHttp)\.addHeader\("X-Device-Id", getDeviceId\(\)\)/g) || []).length, 8);
  assert.match(source, /if \(allowNetwork && \(WiFi\.status\(\) == WL_CONNECTED \|\| sdCardMounted\)\) \{\s*if \(!requestPhotoFetch\(uid\)\)/);
  assert.match(source, /void backgroundIoTask\(void \*pvParameters\)/);
  assert.match(source, /void photoRenderTask\(void \*pvParameters\)/);
  assert.match(source, /xTaskCreatePinnedToCore\(photoRenderTask, "PhotoRender"/);
  assert.match(source, /generation != photoScreenGeneration/);
  assert.doesNotMatch(source, /MEMUAT FOTO/);
  assert.match(source, /fetchPhotoFromAPI\(uid, jpegData, jpegSize\)/);
  const backgroundIo = source.split('void backgroundIoTask(void *pvParameters) {', 2)[1].split('\n// Only render RAM data here', 1)[0];
  assert.match(backgroundIo, /loadPhotoFromSD\(uid, cachedSize\)/);
  assert.match(backgroundIo, /publishPhotoResult\(cachedResult\)/);
  assert.ok(backgroundIo.indexOf('cachePhotoToSD("/foto/" + uid + ".jpg", jpegData, jpegSize)') <
    backgroundIo.indexOf('publishPhotoResult(downloadedResult)'));
  assert.match(source, /NOTIFICATION_SUCCESS_DURATION = 250/);
  assert.match(source, /void buzzTapSuccess\(\) \{\s*digitalWrite\(PIN_BUZZER, HIGH\);\s*tapSuccessBuzzerActive = true;\s*tapSuccessBuzzerOffAt = millis\(\) \+ 320;/);
  assert.match(source, /void serviceTapSuccessBuzzer\(\)/);
  assert.match(source, /cachePhotoToSD\("\/foto\/" \+ uid \+ "\.jpg", jpegData, jpegSize\)/);
  assert.match(source, /written \+= chunkSize;\s*if \(written < jpegSize\) yieldSpiBusForDisplay\(\)/);
  assert.match(source, /void yieldSpiBusForDisplay\(\)/);
  assert.match(source, /const bool photoQueuesReady = photoRequestQueue && photoResultQueue/);
  assert.match(source, /\(photoQueuesReady \|\| cardLookupQueuesReady\)[\s\S]{0,160}xTaskCreatePinnedToCore\(backgroundIoTask/);
  assert.match(source, /if \(!photoRequestQueue \|\| !photoResultQueue/);
  assert.ok(backgroundIo.indexOf('xQueueSend(photoResultQueue, &result, 0)') <
    backgroundIo.indexOf('cachePhotoToSD("/foto/" + uid + ".jpg", jpegData, jpegSize)'));
  assert.match(source, /void retainPhotoFallback\(PhotoResult &result\)/);
  assert.match(source, /uint8_t \*loadPhotoFromSD\(const String &uid, size_t &jpegSize\)/);
  assert.match(source, /if \(result\.downloaded\) retainPhotoFallback\(result\)/);
  assert.match(source, /\[PHOTO\] HTTP=%d bytes=%d free_heap=%u/);
  const waitStart = source.indexOf('void waitNotification(uint32_t durationMs');
  const notificationStart = source.indexOf('void displayCardNotification(String uid', waitStart);
  const notification = source.slice(notificationStart).split('\nvoid displayErrorCardPopup', 1)[0];
  assert.doesNotMatch(notification, /drawPhotoFromAPI/);
  assert.match(notification, /requestPhotoFetch\(uid\)/);
  assert.doesNotMatch(notification, /drawSinglePersonIcon|TJpgDec\.drawJpg/);
  const waitNotification = source.slice(waitStart, notificationStart);
  assert.match(waitNotification, /if \(result\.downloaded\) retainPhotoFallback\(result\)/);
  assert.doesNotMatch(waitNotification, /drawPhotoFromAPI/);
  const drawScreen = source.split('void drawScreen() {', 2)[1];
  const mechanicScreen = drawScreen
    .split('else if (currentState == STATE_MEKANIK_IN) {', 2)[1]
    .split('\n    else if (currentState == STATE_ALL_WORKERS_REGISTERED)', 1)[0];
  assert.match(mechanicScreen, /drawPhotoFromAPI\(lastWorker\.uid, 20, 92, 150, 150, false\)/);
  assert.match(mechanicScreen, /requestWorkerPhotoFetch\(lastWorker\.uid, lastWorker\.sid\)/);
  assert.match(mechanicScreen, /FOTO TIDAK TERSEDIA/);
  assert.match(source, /waitNotification\(isSuccess \? NOTIFICATION_SUCCESS_DURATION : NOTIFICATION_ERROR_DURATION, uid\)/);
});

test('firmware screen redraw preserves updates that arrive while the TFT is being drawn', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const drawScreen = source.split('void drawScreen() {', 2)[1].split('\n// STATUS PERANGKAT', 1)[0];

  assert.match(drawScreen, /^\s*needsRedraw = false;/);
  assert.match(drawScreen, /const SystemState stateAtStart = currentState/);
  assert.match(drawScreen, /lastRenderedState = stateAtStart/);
  assert.match(drawScreen, /if \(currentState != stateAtStart\) \{\s*forceFullRedraw = true;\s*needsRedraw = true;/);
  assert.doesNotMatch(drawScreen, /needsRedraw = false;\s*\}/);
});

test('firmware countdown is timer-driven and keeps the main loop responsive', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const countdown = source.split('void serviceCountdown() {', 2)[1].split('\n// Jalankan pilihan tombol footer', 1)[0];
  const footerActions = source.split('void executeFooterChoice() {', 2)[1].split('\nvoid executeSystemAction', 1)[0];
  const loop = source.split('void loop() {', 2)[1].split('\n// Susun dua baris status', 1)[0];

  assert.match(source, /void beginCountdown\(bool closingSession, uint32_t initialDelayMs = 0\)/);
  assert.match(source, /void serviceCountdown\(\)/);
  assert.match(countdown, /countdownNextAt/);
  assert.match(countdown, /notificationMessage = "0";\s*needsRedraw = true;/);
  assert.match(countdown, /countdownPhase = COUNTDOWN_ZERO_HOLD;\s*countdownNextAt = millis\(\) \+ 500;/);
  assert.ok(countdown.indexOf('countdownPhase = COUNTDOWN_ZERO_HOLD;') <
    countdown.indexOf('currentState = STATE_WAIT_SPV_IN;'));
  assert.ok(countdown.indexOf('countdownPhase = COUNTDOWN_ZERO_HOLD;') <
    countdown.indexOf('currentState = STATE_MAINTENANCE_DONE;'));
  assert.match(countdown, /COUNTDOWN_EXIT_SCREEN_HOLD/);
  assert.doesNotMatch(countdown, /\b(for|while)\s*\(/);
  assert.doesNotMatch(footerActions, /for \(int detik = 10/);
  assert.doesNotMatch(footerActions, /saveSessionToSDNow\(\)/);
  assert.doesNotMatch(footerActions, /serviceDelay\(/);
  assert.match(loop, /getDebouncedKey\(\)/);
  assert.ok(loop.indexOf('getDebouncedKey()') < loop.indexOf('serviceCountdown();'));
  assert.match(loop, /serviceCountdown\(\);/);
  assert.match(loop, /if \(countdownPhase != COUNTDOWN_IDLE(?: \|\| sdMaintenanceBusy)?\) \{\s*clearRfidBuffer\(\);/);
});

test('tap notices redraw the active screen without first clearing the full LCD', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const functionSignatures = [
    'void displayCardNotification(String uid, String name, String role, String statusMsg, bool isSuccess) {',
    'void displayErrorCardPopup(String uid, String title, String name, String role, String sid, String bottomHint) {',
    'void displayTapGateNotice(const String &instruction) {',
    'bool handleFuelmanTap(const String &uid, WorkerInfo &card) {'
  ];
  for (const signature of functionSignatures) {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `${signature} exists`);
    assert.doesNotMatch(source.slice(start).split('\n}\n', 1)[0], /clearMainScreenArea\(\)/);
  }
});

test('firmware displays and refreshes cached photos during personnel logout', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const drawPhotoStart = source.indexOf('bool drawPhotoFromAPI(', source.indexOf('bool drawPhotoFromAPI(') + 1);
  const notificationStart = source.indexOf('void displayCardNotification(', source.indexOf('void displayCardNotification(') + 1);
  const drawPhoto = source.slice(drawPhotoStart).split('\n// Kenali nama event', 1)[0];
  const notification = source.slice(notificationStart).split('\n// Tampilkan alasan', 1)[0];
  const tapProcessor = source.split('void processRfidLogic(String uid) {', 2)[1]
    .split('\nbool tryConnectBestWifi', 1)[0];

  assert.match(drawPhoto, /const String &sidHint/);
  assert.match(drawPhoto, /String cacheSid = sidHint\.length\(\) > 0 \? formatSid\(sidHint\) : ""/);
  assert.match(drawPhoto, /if \(jpegData == NULL && sdCardMounted\)/);
  assert.doesNotMatch(drawPhoto, /backendPhotoMissing/);
  assert.match(notification, /drawPhotoFromAPI\(uid, 25, 86, 160, 160, sid\)/);
  assert.match(tapProcessor, /displayCardNotification\(leavingUser\.uid,[\s\S]{0,180}leavingUser\.sid\)/);
});

test('firmware only offers card registration on welcome and returns from other screens', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const drawScreen = source.split('void drawScreen() {', 2)[1].split('\nvoid getLcdText', 1)[0];
  const supervisorValid = drawScreen
    .split('else if (currentState == STATE_SUPERVISOR_VALID) {', 2)[1]
    .split('\n    else if (currentState == STATE_SET_MEKANIK_COUNT)', 1)[0];
  const supervisorIdentity = source
    .slice(source.lastIndexOf('void drawSupervisorIdentityScreen('))
    .split('\n}', 1)[0];
  const showIpAction = source
    .split('} else if (currentState == STATE_SHOW_IP) {', 2)[1]
    .split('} else if (currentState == STATE_SYSTEM_READY)', 1)[0];

  assert.equal((drawScreen.match(/drawTftFooter\("DAFTAR KARTU"/g) || []).length, 1);
  assert.match(drawScreen, /if \(currentState == STATE_WELCOME\)[\s\S]*drawTftFooter\("DAFTAR KARTU", "LANJUT"\)/);
  assert.match(supervisorValid, /drawSupervisorIdentityScreen\(spvNameDisp, spvSidDisp, spvUidDisp, false\)/);
  assert.match(supervisorIdentity, /drawTftFooter\("KEMBALI", "LANJUT"\)/);
  const workerDetailScreen = drawScreen
    .split('else if (currentState == STATE_WORKER_DETAIL && safetyQueue.topIndex >= 0) {', 2)[1]
    .split('\n    else if (currentState == STATE_GEOFENCE)', 1)[0];
  assert.match(workerDetailScreen, /drawTftFooter\("KEMBALI", "LANJUT"\)/);
  assert.doesNotMatch(supervisorValid, /DAFTAR KARTU/);
  assert.match(showIpAction, /currentState = STATE_WELCOME/);
});

test('firmware accepts strict line-form RFID frames, loads tap photos, and discovers the backend before a queued event', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const serverDefaults = fileURLToPath(new URL('../../esp32/ServerDefaults.h', import.meta.url));
  const defaults = readFileSync(serverDefaults, 'utf8');

  assert.match(source, /len != 8 && len != 10 && len != 12 && len != 14/);
  assert.match(source, /if \(frame\.length\(\) == 12\) \{\s*String uid = frame\.substring\(0, 10\);/);
  assert.match(source, /if \(stxPos < 0\) \{\s*String line = "";/);
  assert.match(source, /if \(!\(\(c >= '0' && c <= '9'\) \|\| \(c >= 'A' && c <= 'F'\) \|\| \(c >= 'a' && c <= 'f'\)\)\) return "";/);
  assert.match(source, /if \(etxPos <= stxPos\) return "";/);
  assert.doesNotMatch(source, /String byteHex = "";/);
  assert.match(source, /RDM6300 biasa mengirim CR\/LF sebelum ETX[\s\S]{0,250}rd6300ByteBuffer\[0\] != 0x02/);
  assert.match(source, /WorkerInfo existingCard = findCachedCard\(uid\)/);
  assert.match(source, /card = findCachedCard\(uid\)/);
  assert.match(source, /requestCardLookup\(uid\)/);
  assert.match(source, /WorkerInfo cachedCard = searchUserFromSDCard\(uid, decimalPadded, decimalUnpadded\)/);
  assert.match(source, /queuePendingRfidCardToSD\(uid\)/);
  assert.match(source, /uploadPendingRfidCardsToBackend\(\)/);
  assert.match(source, /operationalState == STATE_WELCOME \|\| operationalState == STATE_SHOW_IP \|\|\s*operationalState == STATE_SYSTEM_READY/);
  assert.match(source, /PILIH LANJUT DAN MULAI SESI LOTO DAHULU/);
  assert.match(source, /if \(card\.lookupUnavailable\)/);
  assert.match(source, /SERVER TIDAK SIAP/);
  assert.match(source, /drawTextFit\(title, 240, 108, 420, ELOTO_HEADER, ELOTO_BG, 9\)/);
  assert.doesNotMatch(source, /drawString\("KARTU TIDAK TERDAFTAR", 240, 110\)/);
  assert.match(source, /server_host\.length\(\) == 0\) \{\s*Serial\.println\("\[NET\] Mencari backend sebelum mengirim event"\);\s*discoverServer\(\);/);
  assert.match(source, /DynamicJsonDocument doc\(12288\)/);
  assert.match(source, /const uint32_t USER_SYNC_INTERVAL_MS = 15000;/);
  assert.match(source, /startupSyncPending \|\|[\s\S]{0,120}millis\(\) - lastDbSyncTask >= USER_SYNC_INTERVAL_MS/);
  assert.doesNotMatch(source, /startupSyncPending \|\| !sdSyncOk \|\|/);
  assert.match(source, /xTaskCreatePinnedToCore\(networkTask, "NetworkTask", 16384, NULL, tskIDLE_PRIORITY, NULL, 1\)/);
  assert.match(source, /\[BOOT\] stage=NETWORK_TASK_STARTED core=1 priority=IDLE/);
  assert.match(source, /\[SYNC\] JSON parse elapsed=%lu ms users=%u free_heap=%u/);
  assert.match(source, /\[SYNC\] Registered-card cache updated: %d users elapsed=%lu ms/);
  assert.match(source, /class CooperativeJsonStream : public Stream/);
  assert.match(source, /deserializeJson\(doc, jsonStream\)/);
  const mainLoop = source.split('void loop() {', 2)[1].split('\nvoid getLcdText', 1)[0];
  assert.match(mainLoop, /vTaskDelay\(pdMS_TO_TICKS\(1\)\);\s*}\s*$/);
  assert.match(mainLoop, /deferredKeyAction != KEY_NONE/);
  const waitNotification = source.split('void waitNotification(', 2)[1].split('\nvoid displayCardNotification', 1)[0];
  assert.match(waitNotification, /keyCandidateAt \+?[^;]*|millis\(\) - keyCandidateAt >= 35/);
  assert.match(waitNotification, /deferredKeyAction = stableKey/);
  assert.match(waitNotification, /photoResultHandled = true/);
  assert.doesNotMatch(waitNotification, /drawPhotoFromAPI/);
  assert.match(defaults, /constexpr bool LOCAL_ONLY_MODE = true/);
  assert.match(defaults, /DEFAULT_SERVER_BASE\[\] = "http:\/\/192\.168\.137\.1:5002\/"/);
  assert.match(source, /bool serverSpecified = false/);
  assert.match(source, /server_endpoint_secure = configured_server_base\.startsWith\("https:\/\/"\)/);
  assert.match(source, /if \(eloto::LOCAL_ONLY_MODE\) \{[\s\S]{0,350}SD SERVER ignored; using compiled local-only endpoint/);
  assert.match(source, /configured_server_valid = false;\s*server_host = "";\s*Serial\.println\("\[CONFIG\] SERVER invalid; backend blocked/);
  assert.match(source, /doc\["backend_ready"\] = server_host\.length\(\) > 0/);
  assert.match(source, /doc\["sd_sync_ok"\] = sdSyncOk/);
  assert.match(source, /scan->setInterval\(160\);\s*scan->setWindow\(80\);/);
  assert.match(source, /doc\["reset_reason"\] = \(int\)resetReason/);
  assert.match(source, /ESP_RST_BROWNOUT: return "BROWNOUT"/);
  assert.match(source, /reset_reason_name"\] = resetReasonName\(resetReason\)/);
  assert.match(source, /\\r\\n\[BOOT\] reset_reason=%d \(%s\) free_heap=%u\\n/);
  assert.match(source, /doc\["session_active"\] = isSessionActive/);
  assert.match(source, /doc\["session_elapsed_ms"\] = isSessionActive \? uint32_t\(millis\(\) - sessionStartTime\) : 0/);
  const offlineUpload = source.split('void uploadOfflineLogsSDCard() {', 2)[1].split('\n}', 1)[0];
  assert.doesNotMatch(offlineUpload, /SD\.exists\(/);
  assert.match(offlineUpload, /if \(!offlineLogsPending \|\|/);
});

test('firmware sync keeps the registered-card cache intact when the server response is invalid or empty', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const sync = source.split('void syncDatabaseToSDCard() {', 2)[1].split('\n// Cari kartu di SD', 1)[0];
  const loadUsers = source.split('void loadUsersToRAM() {', 2)[1].split('\nbool pushQueue', 1)[0];

  assert.match(sync, /doc\["success"\] == true/);
  assert.match(sync, /arr\.size\(\) == 0 && hasExistingCache/);
  assert.match(sync, /keeping the existing registered-card cache/);
  assert.match(sync, /else if \(u\.containsKey\("rfid_uid"\)/);
  assert.doesNotMatch(sync, /else if \(u\.containsKey\("sid"\)[\s\S]{0,100}uid\s*=/);
  assert.match(source, /String canonicalRfidUid\(String uid\)[\s\S]{0,650}checksum == suppliedChecksum\) uid\.remove\(10\)/);
  assert.match(sync, /uid = canonicalRfidUid\(uid\)/);
  assert.doesNotMatch(sync, /for \(JsonObject u : arr\) \{\s*vTaskDelay/);
  assert.doesNotMatch(loadUsers, /vTaskDelay/);
});

test('personnel and photo SD sync remains pending until both caches are written', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const sync = source.split('bool syncDatabaseToSDCard() {', 2)[1]
    .split('\nbool syncPersonnelPhotosToSDCard', 1)[0];
  const photoSync = source.slice(source.lastIndexOf('bool syncPersonnelPhotosToSDCard('))
    .split('\n// Cari personel berdasarkan UID di berkas SD', 1)[0];
  const worker = source.split('void sdStorageWorkerTask(void *unused) {', 2)[1]
    .split('\n// Pembacaan kartu instan', 1)[0];

  assert.match(sync, /sdSyncOk = synced && photosSynced/);
  assert.doesNotMatch(sync, /sdSyncOk = synced;\s*return sdSyncOk/);
  assert.match(worker, /if \(!synced\) startupSyncPending = true/);
  assert.match(source, /MIN_HEAP_TO_QUEUE_PERSONNEL_SYNC = 14000/);
  assert.match(photoSync, /MIN_PHOTO_SYNC_HEAP = 12000/);
});

test('relay pulses block SD traffic while preserving countdown display and delaying recovery', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const beginPulse = source.split('bool beginRelayPulse() {', 2)[1]
    .split('\nvoid endRelayPulse()', 1)[0];
  const endPulse = source.split('void endRelayPulse() {', 2)[1]
    .split('\nvoid clockSdBusIdle()', 1)[0];
  const maintenance = source.split('void sdMaintenanceTask(void *unused) {', 2)[1]
    .split('\n// Pilih font TFT', 1)[0];

  assert.match(beginPulse, /xSemaphoreTake\(sdMutex, pdMS_TO_TICKS\(1000\)\)/);
  assert.match(beginPulse, /xSemaphoreTakeRecursive\(spiBusMutex, pdMS_TO_TICKS\(1000\)\)/);
  assert.ok(beginPulse.indexOf('relayPulseActive = true') < beginPulse.indexOf('digitalWrite(PIN_RELAY, HIGH)'));
  assert.ok(beginPulse.indexOf('Pulse cancelled; SD lock timeout') < beginPulse.indexOf('digitalWrite(PIN_RELAY, HIGH)'));
  assert.match(source, /if \(sdMaintenanceBusy\).*SpiBusGuard guard; if \(sdMaintenanceBusy\)/);
  assert.doesNotMatch(source, /if \(sdMaintenanceBusy \|\| (?:relayPulseActive|sdRecoveryRequested)/);
  const drawScreen = source.split('void drawScreen() {', 2)[1];
  assert.match(drawScreen, /else if \(currentState == STATE_COUNTDOWN\)[\s\S]{0,1200}tft\.drawString\(notificationMessage/);
  assert.match(source, /relayPulseActive \|\| \(sdRecoveryRequested && !isPresenceProbe\)/);
  assert.match(endPulse, /digitalWrite\(PIN_RELAY, LOW\);[\s\S]*relayPulseActive = false;[\s\S]*sdRecoveryNotBefore = millis\(\) \+ 750;[\s\S]*sdRecoveryRequested = true/);
  assert.match(maintenance, /requestedRecovery && int32_t\(now - sdRecoveryNotBefore\) < 0/);
  assert.match(maintenance, /sdCardMounted && !relayPulseActive &&\s*\(requestedRecovery \|\| int32_t\(now - nextProbeAt\) >= 0\)/);
  assert.match(maintenance, /!relayPulseActive && !sdCardMounted &&\s*int32_t\(now - nextMountAt\) >= 0/);
  assert.match(maintenance, /requestedRecovery \|\| int32_t\(now - nextProbeAt\) >= 0/);
  assert.match(source, /if \(!beginRelayPulse\(\)\) \{[\s\S]{0,180}buzzFailed\(\);/);
});

test('supervisor confirmation keeps the continue prompt without mentioning mechanic count', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const disabledTapGate = source
    .split('if (!rfidInputEnabled) {')
    .pop()
    .split('\n        } else {', 1)[0];
  const drawScreen = source.split('void drawScreen() {', 2)[1];
  const supervisorScreen = drawScreen
    .split('else if (currentState == STATE_SUPERVISOR_VALID) {', 2)[1]
    .split('\n    else if', 1)[0];
  const supervisorIdentity = source
    .slice(source.lastIndexOf('void drawSupervisorIdentityScreen('))
    .split('\n}', 1)[0];
  const mechanicCompletionScreen = drawScreen
    .split('else if (currentState == STATE_ALL_WORKERS_REGISTERED) {', 2)[1]
    .split('\n    else if', 1)[0];

  assert.match(supervisorScreen, /drawSupervisorIdentityScreen\(spvNameDisp, spvSidDisp, spvUidDisp, false\)/);
  assert.match(supervisorIdentity, /drawTftFooter\("KEMBALI", "LANJUT"\)/);
  assert.doesNotMatch(supervisorScreen, /LALU PILIH JUMLAH MEKANIK/);
  assert.match(disabledTapGate, /buzzFailed\(\);/);
  assert.doesNotMatch(disabledTapGate, /displayTapGateNotice/);
  assert.match(mechanicCompletionScreen, /lastMechanicIndex = i/);
  assert.match(mechanicCompletionScreen, /drawPhotoWithNoPhotoFallback\(\s*lastMechanic\.uid, 20, 94, 160, 160, lastMechanic\.sid/);
  assert.match(mechanicCompletionScreen, /drawTextFit\("TOTAL: " \+ String\(totalMekanik\) \+ " MEKANIK", 190, 204, 260/);
  assert.doesNotMatch(mechanicCompletionScreen, /drawString\("TOTAL:/);
  assert.match(mechanicCompletionScreen, /JABATAN  : MEKANIK/);
});

test('firmware backend RFID fallback filters large user profiles and requires an affirmative valid-card response', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const decimalHelpers = source
    .split('String hexToDecStringPadded(String hexStr) {', 2)[1]
    .split('\nuint8_t readADKeypadRaw()', 1)[0];
  assert.equal((decimalHelpers.match(/hexStr\.length\(\) == 0 \|\| hexStr\.length\(\) > 8\) return "";/g) || []).length, 2);
  assert.doesNotMatch(decimalHelpers, /substring\(hexStr\.length\(\) - 8\)/);

  const lookupStart = source.indexOf('CardLookupStatus fetchCardFromBackend(const String &uid, CardLookupResult &result) {');
  const lookup = source.slice(lookupStart).split('\nbool requestCardLookup', 1)[0];

  assert.match(lookup, /Backend check-card HTTP=%d/);
  assert.match(lookup, /Backend lookup skipped: wifi=%d free_heap=%u/);
  assert.match(lookup, /filter\["success"\] = true/);
  assert.match(lookup, /filter\["is_valid"\] = true/);
  assert.match(lookup, /filter\["data"\]\["sid"\] = true/);
  assert.match(lookup, /deserializeJson\(\s*response,\s*http\.client\(\)\.getStream\(\),\s*DeserializationOption::Filter\(filter\)\)/);
  assert.match(lookup, /response\["success"\] == true && response\["is_valid"\] == true/);
  assert.doesNotMatch(lookup, /deserializeJson\(response, http\.getString\(\)\)/);
  const cachedLookup = source.split('WorkerInfo findCachedCard(String uid) {', 2)[1].split('\nvoid networkTask(', 1)[0];
  assert.doesNotMatch(cachedLookup, /HTTPClient|http\.POST|http\.GET|setTimeout/);
  assert.doesNotMatch(cachedLookup, /searchUserFromSDCard/);
  assert.match(source, /WorkerInfo cachedCard = searchUserFromSDCard\(uid, decimalPadded, decimalUnpadded\)/);
  const tapProcessor = source.split('void processRfidLogic(String uid) {', 2)[1].split('\nbool tryConnectBestWifi', 1)[0];
  assert.doesNotMatch(tapProcessor, /http\.POST|http\.GET|setTimeout/);
  assert.match(source, /xTaskCreatePinnedToCore\(backgroundIoTask, "BackgroundIO", 6144, NULL, tskIDLE_PRIORITY, NULL, 0\)/);
  assert.match(source, /cardLookupResultQueue,\s*&result,\s*0\) == pdTRUE/);
  assert.match(source, /resolvedCardLookupReady = true;/);
  assert.match(source, /pendingRfidUid = result\.uid/);
  const notificationLoop = source.split('void waitNotification(uint32_t durationMs', 2)[1].split('\nvoid displayCardNotification', 1)[0];
  assert.match(notificationLoop, /PhotoResult deferredResults\[5\]/);
  assert.match(notificationLoop, /while \(takePhotoResult\(result\)\)/);
  assert.match(notificationLoop, /photoResultQueue && xQueueSend\(photoResultQueue, &deferredResults\[i\], 0\)/);
});

test('online RFID lookup stays asynchronous and cached photos render before background refresh', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const backgroundIo = source.split('void backgroundIoTask(void *pvParameters) {', 2)[1].split('\nvoid retainPhotoFallback', 1)[0];
  const serverLookup = backgroundIo.indexOf('CardLookupStatus status = fetchCardFromBackend(uid, result);');
  const sdFallback = backgroundIo.indexOf('searchUserFromSDCard(uid, decimalPadded, decimalUnpadded)');
  assert.ok(serverLookup >= 0 && sdFallback > serverLookup);
  assert.match(backgroundIo, /if \(status == CARD_LOOKUP_UNAVAILABLE\) \{[\s\S]*?searchUserFromSDCard/);

  const tapProcessor = source.split('void processRfidLogic(String uid) {', 2)[1].split('\nbool tryConnectBestWifi', 1)[0];
  const registration = tapProcessor.split('// KHUSUS MODE REGISTRASI:', 2)[1].split('\n    if (operationalState == STATE_WELCOME', 1)[0];
  assert.match(registration, /backendOnline = WiFi\.status\(\) == WL_CONNECTED && server_host\.length\(\) > 0/);
  assert.match(registration, /if \(backendOnline\) \{\s*existingCard\.isRegistered = false;/);
  assert.match(registration, /backendOnline \|\| queuePendingRfidCardToSD\(uid\)/);

  const photoDrawStart = source.lastIndexOf('bool drawPhotoFromAPI(');
  const photoDraw = source.slice(photoDrawStart).split('\nbool queuePhotoRender', 1)[0];
  const photoHelpers = source.slice(source.indexOf('bool photoFetchFailedFor(')).split('\nbool isTapEventName', 1)[0];
  assert.doesNotMatch(photoDraw, /takeSd\(/);
  assert.match(photoDraw, /if \(allowNetwork && \(WiFi\.status\(\) == WL_CONNECTED \|\| sdCardMounted\)\) \{\s*if \(!requestPhotoFetch\(uid\)\)/);
  assert.match(photoDraw, /queuePhotoRender\(jpegData, jpegSize, boxX, boxY, boxW, boxH\)/);
  assert.doesNotMatch(photoDraw, /TJpgDec\.drawJpg/);
  assert.match(photoHelpers, /photoFetchFailedFor\(const String &uid, const String &sid\)/);
  assert.match(photoHelpers, /void requestWorkerPhotoFetch\(const String &uid, const String &sid\)/);
  assert.match(source, /publishPhotoResult\(PhotoResult &result\)/);
});

test('offline event records are retried promptly after the startup user sync', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const networkTask = source.split('void networkTask(void * pvParameters) {', 2)[1].split('\nvoid logAuditAsync', 1)[0];
  assert.match(source, /const uint32_t OFFLINE_LOG_SYNC_INTERVAL_MS = 2000;/);
  assert.match(networkTask, /!startupSyncPending && millis\(\) - lastOfflineUploadTask >= OFFLINE_LOG_SYNC_INTERVAL_MS/);
  assert.match(networkTask, /uploadOfflineLogsSDCard\(\);/);
});

test('firmware keypad ADC classification covers the noisy gaps between key voltage bands', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const classifier = source.split('uint8_t readADKeypadRaw() {', 2)[1].split('\nuint8_t getDebouncedKey', 1)[0];

  assert.match(classifier, /if \(val < 325\) key = KEY_1/);
  assert.match(classifier, /else if \(val < 1000\) key = KEY_2/);
  assert.match(classifier, /else if \(val < 1725\) key = KEY_3/);
  assert.match(classifier, /else if \(val < 2425\) key = KEY_4/);
  assert.match(classifier, /else if \(val < 3300\) key = KEY_5/);
  assert.match(source, /millis\(\) - candidateTime\) >= 35/);
  assert.match(source, /analogReadResolution\(12\)/);
  assert.match(source, /analogSetPinAttenuation\(PIN_AD_KEY, ADC_11db\)/);
  assert.match(classifier, /\[KEYPAD\] adc=%d key=%u/);
});

test('firmware services keypad input before potentially blocking loop work and logs loop gaps', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');
  const setup = source.split('void setup() {', 2)[1].split('\nvoid loop()', 1)[0];
  const loop = source.split('void loop() {', 2)[1].split('\nvoid getLcdText', 1)[0];

  assert.match(setup, /analogReadResolution\(12\)/);
  assert.match(setup, /analogSetPinAttenuation\(PIN_AD_KEY, ADC_11db\)/);
  assert.ok(loop.indexOf('uint8_t currentDebouncedKey = getDebouncedKey();') <
    loop.indexOf('server.handleClient();'));
  assert.match(loop, /\[INPUT\] loop_gap_ms=%u state=%s/);
});
