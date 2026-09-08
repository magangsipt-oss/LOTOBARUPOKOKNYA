import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const envFile = path.join(root, '.env');
if (existsSync(envFile)) loadEnvFile(envFile);

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
