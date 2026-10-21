import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const firmware = readFileSync(fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url)), 'utf8');
const telemetry = readFileSync(fileURLToPath(new URL('../models/telemetryModel.js', import.meta.url)), 'utf8');
const dashboard = readFileSync(fileURLToPath(new URL('../../frontend/src/context/AppContext.jsx', import.meta.url)), 'utf8');
const dashboardPage = readFileSync(fileURLToPath(new URL('../../frontend/src/pages/Dashboard.jsx', import.meta.url)), 'utf8');
const commandService = readFileSync(fileURLToPath(new URL('../../frontend/src/services/commandService.js', import.meta.url)), 'utf8');

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
  assert.match(dashboardPage, /fetchRefuelingLogs\(\);\s*const stopPoll = livePoll\(fetchRefuelingLogs, 4000\)/);
  assert.match(dashboardPage, /return \(\) => \{ active = false; stopPoll\(\); \};/);
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
  assert.match(photo, /String\(PHOTO_DISPLAY_SIZE\) \+ "&quality=78&fit=cover"/);
  assert.match(firmware, /PHOTO_DISPLAY_SIZE\s*=\s*160/);
  assert.match(firmware, /MIN_HEAP_TO_REQUEST_PHOTO\s*=\s*MIN_HEAP_TO_VERIFY_CARD\s*\+\s*PHOTO_DOWNLOAD_HEAP_RESERVE/);
  assert.match(photo, /if \(!offlinePhotoSource && ESP\.getFreeHeap\(\) > MIN_HEAP_TO_REQUEST_PHOTO\)/);
  assert.match(photo, /const String &sidHint/);
  assert.match(photo, /String photoLookupIds\[2\] = \{ hexUid, cacheSid \}/);
  assert.match(photo, /getApiUrl\("users\/photo\/"\) \+ lookupId/);
  assert.match(photo, /attempt < 2 && jpegData == NULL/);
  assert.match(photo, /if \(jpegData == NULL && sdCardMounted\)/);
  assert.match(photo, /code < 0[\s\S]*offlinePhotoSource = true/);
  assert.match(photo, /required=%u; trying SD cache/);
  assert.match(photo, /freeHeap > \(uint32_t\)length \+ PHOTO_DOWNLOAD_HEAP_RESERVE/);
  assert.match(photo, /ESP\.getMaxAllocHeap\(\)/);
  assert.match(photo, /if \(code != HTTP_CODE_NOT_FOUND\) break/);
  assert.doesNotMatch(photo, /backendPhotoMissing/);
  assert.match(firmware, /PHOTO_SD_DISPLAY_HEAP_RESERVE/);
  assert.match(photo, /JPEG render failed/);
  assert.ok(photo.indexOf('getApiUrl("users/photo/")') <
    photo.indexOf('if (jpegData == NULL && sdCardMounted)'));
  assert.match(photo, /content=%d bytes=%u free_heap=%u/);
  assert.match(firmware, /drawPhotoFromAPI\(uid, 25, 86, 160, 160, photoSid\)/);
  assert.match(firmware, /lastMechanic\.uid, 20, 94, 160, 160, lastMechanic\.sid/);
  assert.match(firmware, /sid \+ "_2\.jpg"/);
  assert.match(firmware, /cacheSid \+ "_2\.jpg"/);
  assert.match(photo, /largestBlock >= cachedPhotoSize/);
  assert.match(photo, /SD fallback skipped path=%s bytes=%u heap=%u largest_block=%u/);
  assert.match(firmware, /sdSyncOk = synced && photosSynced/);
  assert.doesNotMatch(firmware, /sdSyncOk = synced;\s*return sdSyncOk/);
});

test('offline LCD photo fallback checks every cache name and works after online fetch is skipped', () => {
  const photoStart = firmware.lastIndexOf('bool drawPhotoFromAPI(String uid,');
  const photo = firmware.slice(photoStart).split('\nbool isTapEventName', 1)[0];

  assert.match(photo, /String paths\[6\]/);
  assert.match(photo, /for \(int p = 0; p < 6; p\+\+\)/);
  assert.match(photo, /if \(jpegData == NULL && sdCardMounted\)/);
});

test('photo screens retry after a failed backend or SD read instead of staying blank', () => {
  const screenRenderer = firmware.split('void drawScreen() {', 2)[1].split('\nvoid getLcdText', 1)[0];
  const mainLoop = firmware.split('void loop() {', 2)[1];
  assert.match(screenRenderer, /drawSupervisorIdentityScreen\(spvNameDisp, spvSidDisp, spvUidDisp, false\)/);
  assert.match(screenRenderer, /photoAlreadyDrawn = drawPhotoWithNoPhotoFallback\(\s*worker\.uid/);
  assert.match(screenRenderer, /photoAlreadyDrawn = drawPhotoWithNoPhotoFallback\(\s*lastMechanic\.uid/);
  assert.match(screenRenderer, /drawSupervisorIdentityScreen\(supervisorName, lastScannedSID, supervisorUID, true\)/);
  assert.match(mainLoop, /STATE_ALL_WORKERS_REGISTERED/);
  assert.match(mainLoop, /photoRetryScreen && !photoAlreadyDrawn/);
  assert.match(mainLoop, /uint32_t\(millis\(\) - lastPhotoRetryAt\) >= 10000/);
});

test('mechanic notification photo request logs the card UID, SID, role, and result', () => {
  const notification = firmware.slice(firmware.lastIndexOf('void displayCardNotification('))
    .split('\n}', 1)[0];
  assert.match(notification, /\[PHOTO\] Card notification role=%s uid=%s sid=%s/);
  assert.match(notification, /drawPhotoFromAPI\(uid, 25, 86, 160, 160, photoSid\)/);
  assert.match(notification, /\[PHOTO\] Card notification result role=%s uid=%s drawn=%d/);
});

test('repeated LCD photo placeholder behavior is shared without changing tap notifications', () => {
  const fallback = firmware.slice(firmware.lastIndexOf('bool drawPhotoWithNoPhotoFallback('))
    .split('\n}', 1)[0];
  assert.match(fallback, /drawPhotoFromAPI\(uid, boxX, boxY, boxW, boxH, sidHint\)/);
  assert.match(fallback, /drawString\("NO FOTO", fallbackX, fallbackY\)/);
  assert.equal((firmware.match(/drawPhotoWithNoPhotoFallback\(/g) || []).length, 5);
  assert.match(firmware, /drawSinglePersonIcon\(105, 166, 2\.5, ELOTO_HEADER, false\)/);
});

test('supervisor identity screens share the same layout and keep confirmation status optional', () => {
  const supervisorScreen = firmware.slice(firmware.lastIndexOf('void drawSupervisorIdentityScreen('))
    .split('\n}', 1)[0];
  assert.match(supervisorScreen, /drawString\("SUPERVISOR VALID", 240, 70\)/);
  assert.match(supervisorScreen, /drawPhotoWithNoPhotoFallback\(\s*uid, 20, 92, 160, 160, sid, 95, 166\)/);
  assert.match(supervisorScreen, /if \(showCompletionStatus\)[\s\S]*KONFIRMASI SELESAI/);
  assert.equal((firmware.match(/drawSupervisorIdentityScreen\(/g) || []).length, 4);
});

test('firmware preserves valid short SIDs such as numeric IDs for photo lookup', () => {
  const sidFormatter = firmware.slice(firmware.lastIndexOf('String formatSid(String sid) {'))
    .split('\n}', 1)[0];
  const lookup = firmware.split('WorkerInfo fetchCardDataAPI(String uid) {', 2)[1]
    .split('\nvoid pollSyncUsersCommand', 1)[0];
  const photo = firmware.slice(firmware.lastIndexOf('bool drawPhotoFromAPI(String uid,'))
    .split('\nbool isTapEventName', 1)[0];

  assert.match(sidFormatter, /sid\.length\(\) > 0 && sid\.length\(\) <= 8/);
  assert.match(sidFormatter, /c == '_' \|\| c == '-'/);
  assert.match(lookup, /card\.sid = formatSid\(userData\["sid"\] \| ""\)/);
  assert.match(photo, /String photoLookupIds\[2\] = \{ hexUid, cacheSid \}/);
});

test('card tap notifications pass personnel SID into the SD photo cache', () => {
  const notificationStart = firmware.lastIndexOf('void displayCardNotification(String uid,');
  const notification = firmware.slice(notificationStart)
    .split('\nvoid displayErrorCardPopup', 1)[0];
  assert.match(notification, /const String &sid\)/);
  assert.match(notification, /String photoSid = formatSid\(sid.length\(\) > 0 \? sid : lastScannedSID\)/);
  assert.match(notification, /drawPhotoFromAPI\(uid, 25, 86, 160, 160, photoSid\)/);
});

test('wrong-role cards are silently ignored in supervisor and mechanic tap states', () => {
  const tapLogic = firmware.split('void processRfidLogic(String uid) {', 2)[1]
    .split('\nbool tryConnectBestWifi()', 1)[0];
  const mismatch = tapLogic.indexOf('Ignored role mismatch');
  assert.ok(mismatch >= 0);
  assert.ok(mismatch < tapLogic.indexOf('buzzFailed();', mismatch));
  assert.match(tapLogic, /bool supervisorTapState = operationalState == STATE_WAIT_SPV_IN[\s\S]*STATE_WAIT_SPV_OUT;/);
  assert.match(tapLogic, /bool mechanicTapState = operationalState == STATE_MEKANIK_IN[\s\S]*STATE_MEKANIK_OUT;/);
  assert.match(tapLogic, /supervisorTapState && !supervisorCard/);
  assert.match(tapLogic, /mechanicTapState && \(supervisorCard \|\| isFuelmanRole\(card\.role\)\)/);
  assert.doesNotMatch(firmware, /bool isSupervisorTapState|bool isMechanicTapState/);
  assert.match(tapLogic, /!isLotoSessionTapState\(operationalState\)[\s\S]*handleFuelmanTap/);
});

test('newly registered cards and photos sync from backend without firmware-specific card data', () => {
  const tapLogic = firmware.split('void processRfidLogic(String uid) {', 2)[1]
    .split('\nbool tryConnectBestWifi()', 1)[0];
  const lookup = firmware.split('WorkerInfo fetchCardDataAPI(String uid) {', 2)[1]
    .split('\nvoid networkTaskCore1', 1)[0];
  const sync = firmware.split('bool syncDatabaseToSDCard() {', 2)[1]
    .split('\n// Cache foto backend', 1)[0];

  assert.match(tapLogic, /WorkerInfo card = fetchCardDataAPI\(uid\)/);
  assert.match(lookup, /getApiUrl\("users\/check-card"\)/);
  assert.match(lookup, /addHeader\("X-Device-Id", getDeviceId\(\)\)/);
  assert.match(firmware, /PERSONNEL_SYNC_INTERVAL_MS = 10000UL/);
  assert.match(sync, /syncPersonnelPhotosToSDCard\(photoUidPayload\)/);
  assert.match(sync, /photoUidPayload \+= uid \+ "\\|" \+ sid/);
  const photoSync = firmware.split('bool syncPersonnelPhotosToSDCard(const String &uids) {', 2)[1]
    .split('\nbool sdWriteReadbackTest', 1)[0];
  assert.match(photoSync, /hasCachedPhotoOnSD\(uid, sid\)/);
  assert.ok(photoSync.indexOf('hasCachedPhotoOnSD(uid, sid)') <
    photoSync.indexOf('String photoUrl = getApiUrl("users/photo/")'));
  assert.match(photoSync, /ESP\.getMaxAllocHeap\(\) >= \(uint32_t\)length/);
  assert.match(firmware, /cachePhotoToSD\(hexUid, cacheSid, jpegData, jpegSize\)/);
});

test('personnel creation, edits, and imports queue an immediate SD sync for each box', () => {
  assert.match(commandService, /api\.post\('\/commands', \{ idBox, command: 'SYNC_USERS' \}\)/);
  assert.match(dashboard, /const queuePersonnelSync = async/);
  assert.match(dashboard, /Promise\.allSettled\(boxIds\.map\(idBox => commandService\.syncUsers\(idBox\)\)\)/);
  assert.match(dashboard, /await queuePersonnelSync\(`✓ \$\{hasil\.message/);
  assert.match(dashboard, /if \(suksesCount > 0\) await queuePersonnelSync\(importMessage\)/);
  assert.match(dashboard, /await queuePersonnelSync\(`✓ Data \$\{cleanNama\}/);
  assert.match(firmware, /getApiUrl\("commands\/"\) \+ getDeviceIdPath\(\) \+ "\/pending"/);
  assert.match(firmware, /command != "SYNC_USERS"/);
  assert.match(firmware, /requestSdStorageJob\(SD_JOB_PERSONNEL_SYNC\)/);
  assert.match(firmware, /getApiUrl\("commands\/"\) \+ getDeviceIdPath\(\) \+ "\/clear"/);
  assert.match(firmware, /pollSyncUsersCommand\(queuedSyncUsersCommandId\)/);
});

test('personnel SD cache ignores repeated backend UIDs before writing its CSV', () => {
  assert.match(firmware, /Duplicate backend UID ignored uid=%s/);
  assert.match(firmware, /csvPayload\.substring\(rowStart, uidEnd\)\.equalsIgnoreCase\(uid\)/);
});

test('successfully downloaded personnel photos are saved to the SD cache', () => {
  const cache = firmware.split('bool cachePhotoToSD(String uid,', 2)[1].split('\n// Pasang SD', 1)[0];
  const cacheLookup = firmware.split('bool hasCachedPhotoOnSD(String uid,', 2)[1]
    .split('\n// Sinkronkan personel backend', 1)[0];
  const photoStart = firmware.lastIndexOf('bool drawPhotoFromAPI(String uid,');
  const photo = firmware.slice(photoStart).split('\n// Kenali nama event', 1)[0];
  assert.match(cache, /SD\.open\(temporary, FILE_WRITE\)/);
  assert.match(cache, /String cacheName = photoCacheBaseName\(uid, sid\)/);
  assert.match(cache, /Cached path=%s uid=%s sid=%s bytes=%u/);
  assert.match(cache, /commitSdFile\(active\.c_str\(\), temporary\.c_str\(\), backup\.c_str\(\)\)/);
  assert.match(cacheLookup, /String paths\[6\]/);
  assert.match(cacheLookup, /photoCacheBaseName\(uid, sid\)/);
  assert.match(cacheLookup, /"\/foto\/" \+ uid \+ "\.jpg"/);
  assert.match(photo, /if \(jpegData != NULL && sdCardMounted\) cachePhotoToSD\(hexUid, cacheSid, jpegData, jpegSize\)/);
});

test('offline photo sync uses FAT 8.3 paths and replaces invalid cached JPEGs', () => {
  const photoSync = firmware.split('bool syncPersonnelPhotosToSDCard(const String &uids) {', 2)[1]
    .split('\nbool sdWriteReadbackTest', 1)[0];
  const cacheCheck = firmware.split('bool hasCachedPhotoOnSD(String uid,', 2)[1]
    .split('\n// Sinkronkan personel backend', 1)[0];
  const photoStart = firmware.lastIndexOf('bool drawPhotoFromAPI(String uid,');
  const photo = firmware.slice(photoStart).split('\nbool drawPhotoWithNoPhotoFallback', 1)[0];
  assert.match(firmware, /String photoCacheBaseName\(const String &uid, const String &sid\)/);
  assert.match(firmware, /char name\[9\] = "U0000000"/);
  assert.match(cacheCheck, /photo\.size\(\)/);
  assert.match(cacheCheck, /photo\.read\(signature, sizeof\(signature\)\)/);
  assert.match(cacheCheck, /signature\[0\] == 0xFF && signature\[1\] == 0xD8/);
  assert.doesNotMatch(photoSync, /sid == "-----"\) continue/);
  assert.match(photoSync, /hasCachedPhotoOnSD\(uid, sid\)/);
  assert.match(photoSync, /cachePhotoToSD\(uid, sid, jpegData, received\)/);
  assert.match(photo, /photoCacheUid = normalizeRfidUid\(ramUserCache\[i\]\.uid\)/);
});

test('online card verification distinguishes network outage from backend 404', () => {
  const lookup = firmware.split('WorkerInfo fetchCardDataAPI(String uid) {', 2)[1]
    .split('\nvoid networkTaskCore1', 1)[0];
  assert.match(firmware, /bool deviceHasNetwork\(\)[\s\S]{0,150}WiFi\.status\(\) == WL_CONNECTED[\s\S]{0,100}localIP\(\)\.toString\(\) != "0\.0\.0\.0"/);
  assert.match(lookup, /bool wifiConnected = deviceHasNetwork\(\)/);
  assert.match(firmware, /MIN_HEAP_TO_VERIFY_CARD\s*=\s*12000/);
  assert.match(lookup, /ESP\.getFreeHeap\(\) > MIN_HEAP_TO_VERIFY_CARD/);
  assert.doesNotMatch(lookup, /ESP\.getFreeHeap\(\) > 25000/);
  assert.match(lookup, /offlineFallbackAllowed = true/);
  assert.match(lookup, /offlineFallbackAllowed = !wifiConnected \|\| !backendConfigured/);
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
