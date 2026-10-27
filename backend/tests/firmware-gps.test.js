import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('SIM808 protocol and actual firmware handle late responses, fix loss and recovery', t => {
  try { execFileSync('g++', ['--version'], { stdio: 'ignore' }); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    t.skip('g++ unavailable; ESP32 build and receiver validation remain separate');
    return;
  }
  const firmware = readFileSync(new URL('../../esp32/ELOTO_FIXED/ELOTO_FIXED.ino', import.meta.url), 'utf8');
  const between = (start, end) => {
    const first = firmware.indexOf(start);
    const last = firmware.indexOf(end, first);
    if (first < 0 || last < first) throw new Error(`Missing GPS section: ${start}`);
    return firmware.slice(first, last);
  };
  // Compile the production functions with a fake UART and clock, so the regressions
  // exercise their behavior rather than a second implementation of the algorithm.
  const implementation = [
    between('enum GpsPollState', 'HardwareSerial rd6300Serial'),
    between('unsigned long gpsLastByteMillis', 'String lastScannedRfidUID'),
    between('bool kirimPerintahAT(', '// Cadangan bila NTP diblokir jaringan'),
    between('void invalidateGpsFix()', '// Bersihkan byte tertunda dari pembaca RFID.')
  ].join('\n');
  const directory = mkdtempSync(join(tmpdir(), 'eloto-gps-test-'));
  try {
    writeFileSync(join(directory, 'gps-under-test.inc'), implementation);
    const source = fileURLToPath(new URL('../../esp32/tests/gps-navigation.test.cpp', import.meta.url));
    const binary = join(directory, 'gps-test');
    execFileSync('g++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
      '-I', directory, source, '-o', binary], { stdio: 'inherit' });
    execFileSync(binary, { stdio: 'inherit' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
