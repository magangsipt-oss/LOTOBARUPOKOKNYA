// Compatibility entry point. All assertions live in the isolated regression suite.
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['--test', 'tests/*.test.js'], { cwd: new URL('.', import.meta.url), stdio: 'inherit', shell: false });
process.exitCode = result.status ?? 1;
