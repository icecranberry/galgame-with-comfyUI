// Explicit acceptance only; intentionally outside test/*.test.js discovery.
// Run from agent-core: node test/fixtures/runWorkshopWallclockTimeout.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec',
  fileURLToPath(new URL('../townWorkshopLLMRuntime.test.js', import.meta.url))], {
  env: { ...process.env, DB_PATH: ':memory:', TOWN_WORKSHOP_WALLCLOCK_TIMEOUT: '1' },
  stdio: 'inherit', timeout: 40000, windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
