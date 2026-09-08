import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const envFile = path.join(root, '.env');
if (existsSync(envFile)) loadEnvFile(envFile);

const missing = [];
if (!process.env.ELOTO_RTSP_URL?.trim()) missing.push('ELOTO_RTSP_URL');
if ((process.env.ELOTO_DEVICE_TOKEN || '').length < 32) missing.push('ELOTO_DEVICE_TOKEN (minimal 32 karakter)');
if (missing.length) {
  console.log(`[counting] Belum diaktifkan: isi ${missing.join(' dan ')} di counting/.env.`);
  console.log('[counting] Web dan backend tetap berjalan. Setelah konfigurasi siap, jalankan pnpm dev:counting.');
  process.exit(0);
}

const virtualPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.ELOTO_PYTHON || (existsSync(virtualPython) ? virtualPython : process.platform === 'win32' ? 'python' : 'python3');
const child = spawn(python, ['-u', path.join(root, 'people_counting.py')], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', error => {
  console.error(`[counting] Python gagal dijalankan (${error.code}). Siapkan Python/dependency counting atau atur ELOTO_PYTHON.`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
});
