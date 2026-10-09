import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const firmware = readFileSync(fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url)), 'utf8');
const telemetry = readFileSync(fileURLToPath(new URL('../models/telemetryModel.js', import.meta.url)), 'utf8');
const dashboard = readFileSync(fileURLToPath(new URL('../../frontend/src/context/AppContext.jsx', import.meta.url)), 'utf8');
const dashboardPage = readFileSync(fileURLToPath(new URL('../../frontend/src/pages/Dashboard.jsx', import.meta.url)), 'utf8');

test('accepted card taps are posted with the box ID and stored as tapping history', () => {
  const tapLogic = firmware.split('void processRfidLogic(String uid) {', 2)[1].split('\nbool tryConnectBestWifi()', 1)[0];
  const networkTask = firmware.split('void networkTaskCore1(void * pvParameters) {', 2)[1].split('\nvoid logAuditAsync', 1)[0];
  assert.match(tapLogic, /logAuditAsync\(firstSupervisor \? "SUPERVISOR_LOCK_IN" : "SUPERVISOR_EXTRA_LOCK_IN", uid\)/);
  assert.match(tapLogic, /logAuditAsync\("MECHANIC_LOG_IN", uid\)/);
  assert.match(networkTask, /doc\["id_box"\]\s*=\s*getDeviceId\(\)/);
  assert.match(networkTask, /doc\["uid"\]\s*=\s*String\(job\.uid\)/);
  assert.match(networkTask, /addHeader\("X-Device-Id", getDeviceId\(\)\)/);
  assert.match(firmware, /MIN_HEAP_TO_POST_TELEMETRY\s*=\s*14000/);
  assert.match(networkTask, /ESP\.getFreeHeap\(\) >= MIN_HEAP_TO_POST_TELEMETRY/);
  assert.match(networkTask, /doc\.createNestedArray\("queue"\)/);
  assert.match(networkTask, /Deferred event=%s wifi=%d backend=%d free_heap=%u required=%u/);
  assert.match(networkTask, /http\.POST\(jsonPayload\)/);
  assert.match(telemetry, /if \(isTap\(event\)\)[\s\S]{0,300}INSERT INTO tapping_history/);
  assert.match(dashboard, /getTappingHistory\(200\)/);
  assert.match(dashboard, /setInterval\(muatDataLaporanDanBuffer, 4000\)/);
});

test('dashboard refreshes refueling history while it remains open', () => {
  assert.match(dashboardPage, /fetchRefuelingLogs\(\);\s*const interval = setInterval\(fetchRefuelingLogs, 4000\)/);
  assert.match(dashboardPage, /return \(\) => \{ active = false; clearInterval\(interval\); \};/);
});

test('second tap by the active fuelman ends refueling and reports REFUEL_END', () => {
  const fuelman = firmware.split('bool handleFuelmanTap(const String &uid, WorkerInfo &card) {', 2)[1]
    .split('\n// Pulihkan antrean', 1)[0];
  assert.match(fuelman, /bool refuelingEnded = activeFuelmanUID\.equalsIgnoreCase\(uid\)/);
  assert.match(fuelman, /if \(refuelingEnded\) \{\s*logAuditAsync\("REFUEL_END", uid\);\s*activeFuelmanUID = "";\s*activeFuelmanName = "";/);
  assert.match(fuelman, /else \{\s*activeFuelmanUID = uid;\s*activeFuelmanName = card\.name;\s*logAuditAsync\("REFUEL_START", uid\);/);
  assert.match(fuelman, /refuelingEnded \? "PENGISIAN SELESAI" : "PENGISIAN BBM"/);
  assert.match(fuelman, /refuelingEnded \? "STATUS   : SELESAI" : "STATUS   : PENGISIAN BBM"/);

  const endHandler = telemetry.split('if (!body.replay && event === \'REFUEL_END\')', 2)[1]
    .split('\n    if (!body.replay &&', 1)[0];
  assert.match(endHandler, /UPDATE refueling_logs SET end_time = NOW\(\)/);
  assert.match(endHandler, /UPDATE boxes SET active_fuelman =/);
});

test('TFT tap photos load from backend when not cached on SD', () => {
  const photoStart = firmware.lastIndexOf('bool drawPhotoFromAPI(String uid,');
  const photo = firmware.slice(photoStart).split('\nbool isTapEventName', 1)[0];
  assert.doesNotMatch(photo, /uid == "" \|\| !sdCardMounted/);
  assert.match(photo, /getApiUrl\("users\/photo\/"\)/);
  assert.match(photo, /addHeader\("X-Device-Id", getDeviceId\(\)\)/);
  assert.match(photo, /getSize\(\)/);
  assert.match(photo, /readBytes\(jpegData/);
  assert.match(photo, /TJpgDec\.drawJpg/);
  assert.match(photo, /\?size=320&quality=78/);
  assert.match(photo, /if \(jpegData == NULL && WiFi\.status\(\) == WL_CONNECTED && ESP\.getFreeHeap\(\) > 30000\)/);
  assert.match(photo, /const String &sidHint/);
  assert.match(photo, /if \(jpegData == NULL\)\s*loadPhotoFromSDCache/);
  assert.doesNotMatch(photo, /backendPhotoMissing/);
  assert.match(firmware, /PHOTO_SD_DISPLAY_HEAP_RESERVE/);
  assert.match(photo, /JPEG render failed/);
  assert.ok(photo.indexOf('getApiUrl("users/photo/")') <
    photo.indexOf('if (jpegData == NULL)\n        loadPhotoFromSDCache'));
  assert.match(photo, /content=%d bytes=%u free_heap=%u/);
  assert.match(firmware, /if \(!drawPhotoFromAPI\(uid, 25, 86, 160, 160, sid, true\)\)/);
});

test('card tap notifications read cached SD photos before attempting a network request', () => {
  const notificationStart = firmware.lastIndexOf('void displayCardNotification(String uid,');
  const notification = firmware.slice(notificationStart)
    .split('\nvoid displayErrorCardPopup', 1)[0];
  const photo = firmware.lastIndexOf('bool drawPhotoFromAPI(String uid,');
  const photoFunction = firmware.slice(photo).split('\nbool isTapEventName', 1)[0];

  assert.match(notification, /drawPhotoFromAPI\(uid, 25, 86, 160, 160, sid, true\)/);
  assert.match(photoFunction, /const String &sidHint, bool preferSdCache/);
  assert.ok(photoFunction.indexOf('if (preferSdCache) loadPhotoFromSDCache') <
    photoFunction.indexOf('if (jpegData == NULL && WiFi.status()'));
  assert.ok(photoFunction.indexOf('if (jpegData == NULL && WiFi.status()') <
    photoFunction.indexOf('if (jpegData == NULL)\n        loadPhotoFromSDCache'));
});

test('personnel SD cache ignores repeated backend UIDs before writing its CSV', () => {
  assert.match(firmware, /Duplicate backend UID ignored uid=%s/);
  assert.match(firmware, /csvPayload\.substring\(rowStart, uidEnd\)\.equalsIgnoreCase\(uid\)/);
});

test('successfully downloaded personnel photos are saved to the SD cache', () => {
  const cache = firmware.split('bool cachePhotoToSD(String uid,', 2)[1].split('\n// Pasang SD', 1)[0];
  const photoStart = firmware.lastIndexOf('bool drawPhotoFromAPI(String uid,');
  const photo = firmware.slice(photoStart).split('\n// Kenali nama event', 1)[0];
  assert.match(cache, /SD\.open\(temporary, FILE_WRITE\)/);
  assert.match(cache, /commitSdFile\(active\.c_str\(\), temporary\.c_str\(\), backup\.c_str\(\)\)/);
  assert.match(photo, /if \(jpegData != NULL && sdCardMounted\) cachePhotoToSD\(hexUid, cacheSid, jpegData, jpegSize\)/);
});

test('online card verification distinguishes network outage from backend 404', () => {
  const lookup = firmware.split('WorkerInfo fetchCardDataAPI(String uid) {', 2)[1]
    .split('\nvoid networkTaskCore1', 1)[0];
  assert.match(firmware, /bool deviceHasNetwork\(\)[\s\S]{0,150}WiFi\.status\(\) == WL_CONNECTED[\s\S]{0,100}localIP\(\)\.toString\(\) != "0\.0\.0\.0"/);
  assert.match(lookup, /bool wifiConnected = deviceHasNetwork\(\)/);
  assert.match(firmware, /MIN_HEAP_TO_VERIFY_CARD\s*=\s*12000/);
  assert.match(lookup, /ESP\.getFreeHeap\(\) > MIN_HEAP_TO_VERIFY_CARD/);
  assert.doesNotMatch(lookup, /ESP\.getFreeHeap\(\) > 25000/);
  assert.match(lookup, /offlineFallbackAllowed = !deviceHasNetwork\(\)/);
  assert.match(lookup, /HTTP_CODE_NOT_FOUND[\s\S]{0,450}missingResponse\["success"\] == false[\s\S]{0,100}missingResponse\["is_valid"\] == false/);
  assert.match(lookup, /Backend endpoint returned non-contract HTTP 404/);
});

test('only registered fuelmen may tap globally; LOTO roles require an active LOTO screen', () => {
  const processor = firmware.split('void processRfidLogic(String uid) {', 2)[1]
    .split('\nbool tryConnectBestWifi()', 1)[0];
  const registration = processor.split('if (operationalState == STATE_REGISTER_RFID)', 2)[1]
    .split('\n    int workerIdx', 1)[0];
  const activeSessionPath = processor.split('\n    int workerIdx = findWorkerIndex(uid);', 2)[1];
  const registeredCheckIndex = activeSessionPath.indexOf('if (!card.isRegistered ||');
  const fuelmanIndex = activeSessionPath.indexOf('if (card.isRegistered && handleFuelmanTap(uid, card)) return;');
  const sessionGateIndex = activeSessionPath.indexOf('if (!isSessionActive || !isLotoSessionTapState(operationalState)) return;');
  const loop = firmware.split('void loop() {', 2)[1].split('\n// Susun dua baris status', 1)[0];
  const sessionStates = firmware.split('bool isLotoSessionTapState(SystemState state) {', 2)[1]
    .split('\n}', 1)[0];

  assert.match(registration, /WorkerInfo existingCard = fetchCardDataAPI\(uid\)/);
  assert.match(registration, /existingCard\.isRegistered && isFuelmanRole\(existingCard\.role\)[\s\S]*handleFuelmanTap\(uid, existingCard\)/);
  assert.ok(registration.indexOf('existingCard.lookupUnavailable') < registration.indexOf('logAuditAsync("REGISTER_NEW_CARD", uid)'));
  assert.ok(fuelmanIndex >= 0 && fuelmanIndex < sessionGateIndex);
  assert.ok(sessionGateIndex >= 0 && sessionGateIndex < registeredCheckIndex);
  assert.match(activeSessionPath.slice(sessionGateIndex), /^if \(!isSessionActive \|\| !isLotoSessionTapState\(operationalState\)\) return;/);
  assert.match(sessionStates, /STATE_WAIT_SPV_IN/);
  assert.match(sessionStates, /STATE_MEKANIK_IN/);
  assert.match(sessionStates, /STATE_MEKANIK_OUT/);
  assert.match(sessionStates, /return state == STATE_WAIT_SPV_IN \|\| state == STATE_MEKANIK_IN/);
  assert.doesNotMatch(sessionStates, /STATE_SUPERVISOR_VALID|STATE_SET_MEKANIK_COUNT/);
  assert.match(processor, /if \(!isTapRoleAllowedAtState\(card, operationalState\)\) return;/);
  const roleGuard = processor.indexOf('if (!isTapRoleAllowedAtState(card, operationalState)) return;');
  const tapSwitch = processor.indexOf('switch (operationalState)', roleGuard);
  assert.ok(roleGuard >= 0 && tapSwitch > roleGuard);
  assert.match(firmware, /STATE_WAIT_SPV_IN \|\| state == STATE_WAIT_SPV_OUT\) return isSupervisor/);
  assert.match(firmware, /state == STATE_MEKANIK_IN\) return !isSupervisor/);
  assert.match(firmware, /isSupervisor == isQueueSupervisor\(safetyQueue\.topIndex\)/);
  assert.doesNotMatch(processor, /case STATE_WELCOME:/);
  assert.match(loop, /processRfidLogic\(authUID\)/);
  assert.doesNotMatch(loop, /rfidInputEnabled/);
  assert.match(processor, /UNREGISTERED_SCAN_DENIED/);
  assert.doesNotMatch(processor, /SCAN_REJECTED_UNREGISTERED/);
});

test('firmware persists safe display states and active sessions after screen transitions', () => {
  assert.match(firmware, /bool isPersistentDisplayState\(SystemState state\)/);
  assert.match(firmware, /case STATE_MENU:[\s\S]*case STATE_WAIT_SPV_IN:[\s\S]*case STATE_MEKANIK_IN:[\s\S]*case STATE_WAIT_SPV_OUT:/);
  assert.match(firmware, /if \(savedSessionActive\) \{\s*isSessionActive = true/);
  assert.match(firmware, /if \(isActiveLotoState\(currentState\)\) currentState = STATE_WELCOME/);
  const loop = firmware.split('void loop() {', 2)[1].split('\n// Susun dua baris status', 1)[0];
  assert.match(firmware, /bool saveSessionToSD\(\)/);
  assert.match(loop, /currentState != lastSessionPersistedState[\s\S]*isPersistentDisplayState\(currentState\)[\s\S]*saveSessionToSD\(\)\) lastSessionPersistedState = currentState/);
});

test('unavailable card verification is not mislabeled as an unregistered card', () => {
  assert.match(firmware, /card\.lookupUnavailable = lookupUnavailable/);
  assert.match(firmware, /if \(!card\.isRegistered && card\.lookupUnavailable\)[\s\S]{0,180}SERVER TIDAK SIAP/);
  assert.match(firmware, /frame\.length\(\) == 12 && validateRDM6300Checksum\(frame\)/);
  assert.doesNotMatch(firmware.split('String extractRfidCardID() {', 2)[1].split('\nString checkRfidSensor()', 1)[0], /Fallback/);
  assert.match(firmware, /millis\(\) - lastRfidFrameMillis >= 150/);
});
