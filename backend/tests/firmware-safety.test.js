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

test('firmware keeps device ID available and reloads SD config after a delayed mount', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');

  assert.match(source, /#include "device_secrets\.h"/);
  assert.match(source, /String device_id\s*=\s*ELOTO_DEVICE_ID;/);
  assert.match(source, /request\.addHeader\("X-Device-IP", WiFi\.localIP\(\)\.toString\(\)\);/);
  assert.doesNotMatch(source, /ELOTO_DEVICE_TOKEN|device_token|X-Device-Token/);
  assert.match(source, /if \(mounted\) \{[\s\S]{0,800}sdCardMounted = true;\s*loadConfigFromSD\(\);/);
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
  assert.match(source, /backendStableSince > 0 && millis\(\) - backendStableSince >= OFFLINE_REPLAY_STABLE_MS[\s\S]{0,400}sdSyncOk[\s\S]{0,250}uploadOfflineLogsSDCard\(\)/);
  assert.match(source, /HEARTBEAT_INTERVAL_MS = 10000/);
  assert.match(source, /BLE_MIN_FREE_HEAP = 100000/);
});

test('firmware obtains a profile photo from the backend when the SD cache is unavailable', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');

  assert.match(source, /getApiUrl\("users\/photo\/"\)/);
  assert.match(source, /request\.addHeader\("X-Device-IP", WiFi\.localIP\(\)\.toString\(\)\);/);
  assert.match(source, /jpegData == NULL && allowNetwork && fetchPhotoFromAPI\(uid, jpegData, jpegSize\)/);
});

test('firmware rejects unframed RFID noise, loads tap photos when needed, and discovers the backend before a queued event', () => {
  const firmware = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
  const source = readFileSync(firmware, 'utf8');

  assert.match(source, /if \(stxPos < 0 \|\| etxPos <= stxPos\) return "";/);
  assert.doesNotMatch(source, /String byteHex = "";/);
  assert.match(source, /RDM6300 biasa mengirim CR\/LF sebelum ETX[\s\S]{0,250}rd6300ByteBuffer\[0\] != 0x02/);
  assert.match(source, /drawPhotoFromAPI\(uid, 25, 91, 150, 150, true\)/);
  assert.match(source, /server_host\.length\(\) == 0\) \{\s*Serial\.println\("\[NET\] Mencari backend sebelum mengirim event"\);\s*discoverServer\(\);/);
  assert.match(source, /DynamicJsonDocument doc\(12288\)/);
  assert.match(source, /startupSyncPending \|\| !sdSyncOk \|\| millis\(\) - lastDbSyncTask > 120000/);
});
