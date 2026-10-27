import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const firmwarePath = fileURLToPath(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url));
const firmware = readFileSync(firmwarePath, 'utf8');
const section = (start, end) => firmware.split(start, 2)[1].split(end, 1)[0];

test('the job list state is appended so saved session state numbers stay valid', () => {
  const states = section('enum SystemState {', '};');
  assert.match(states, /STATE_WELCOME, STATE_GEOFENCE,[\s\S]*STATE_JOB_LIST\s*$/);
});

test('menu adds a job instead of an extra supervisor and KEMBALI returns to the pre-menu screen', () => {
  const menu = section('const char *menuItems[MENU_ITEM_COUNT] = {', '};');
  assert.match(menu, /"2\. TAMBAH PEKERJAAN"/);
  assert.match(menu, /"3\. TAMBAH MEKANIK"/);
  assert.match(menu, /"5\. KEMBALI"/);
  assert.doesNotMatch(menu, /TAMBAH PENGAWAS/);
  // Layar sebelum menu: daftar personel, atau DAFTAR PEKERJAAN bila ada lebih dari satu pekerjaan.
  const home = section('void openSessionHome() {', '\n}\n');
  assert.match(home, /if \(activeTeamCount\(\) > 1\) openJobList\(\);\s*else openWorkerList\(\);/);
  const menuKeys = section('} else if (selectedMenuIndex == 3) {', 'forceFullRedraw = true;');
  assert.match(menuKeys, /selectedMenuIndex == 4\) \{\s*openSessionHome\(\);/);
});

test('every supervisor tap opens a new job and only the first opens the backend session', () => {
  const tapIn = section('switch (operationalState) {', 'case STATE_MEKANIK_IN:');
  assert.match(tapIn, /bool firstSupervisor = safetyQueue\.topIndex < 0;/);
  assert.match(tapIn, /int team = findFreeTeam\(\);/);
  assert.match(tapIn, /firstSupervisor \? "SUPERVISOR_LOCK_IN" : "SUPERVISOR_EXTRA_LOCK_IN"/);
});

test('mechanics leave in any order but only from the selected job, and its supervisor leaves last', () => {
  const tapOut = section('case STATE_MEKANIK_OUT: {', 'case STATE_WAIT_SPV_OUT: {');
  assert.match(tapOut, /if \(team != activeTeam\)/);
  assert.match(tapOut, /workerIdx == teamLeadIndex\(team\)/);
  // Tidak ada lagi urutan keluar LIFO berbasis posisi antrean.
  assert.doesNotMatch(tapOut, /safetyQueue\.topIndex/);
  const spvOut = section('case STATE_WAIT_SPV_OUT: {', 'default:');
  assert.match(spvOut, /countTeamMembers\(activeTeam\) > 1/);
});

test('only the last job supervisor sends SUPERVISOR_LOG_OUT; others return to the job list', () => {
  const spvOut = section('case STATE_WAIT_SPV_OUT: {', 'default:');
  const [lastJob, otherJobs] = spvOut.split('// Pekerjaan lain masih di dalam');
  assert.match(lastJob, /if \(safetyQueue\.topIndex == 0\)[\s\S]*"SUPERVISOR_LOG_OUT"[\s\S]*STATE_SPV_OUT_CONFIRM/);
  assert.doesNotMatch(otherJobs, /"SUPERVISOR_LOG_OUT"/);
  assert.match(otherJobs, /"SUPERVISOR_EXTRA_LOG_OUT"/);
  assert.match(otherJobs, /openSessionHome\(\);/);
});

test('keypad navigation cannot remove tapped-in personnel or open the relay while anyone is inside', () => {
  const footer = section('void executeFooterChoice() {', '\n// Jalankan aksi tombol');
  const registered = footer.split('currentState == STATE_ALL_WORKERS_REGISTERED) {', 2)[1].split('} else if', 1)[0];
  assert.doesNotMatch(registered, /removeQueueAt/);
  assert.equal((footer.match(/if \(refuseRelayWhilePersonnelInside\(\)\) return;/g) || []).length, 2);
  assert.match(firmware, /int minCount = countTeamMechanics\(activeTeam\);/);
});

test('sessions keep jobs across reboot and resume the menu when personnel are still recorded', () => {
  assert.match(firmware, /obj\["team"\] = safetyQueue\.workers\[i\]\.team;/);
  assert.match(firmware, /safetyQueue\.workers\[idx\]\.team = constrain\(\(int\)\(obj\["team"\] \| 0\)/);
  assert.match(firmware, /else if \(safetyQueue\.topIndex >= 0\) \{[\s\S]{0,600}currentState = STATE_MENU;/);
});
