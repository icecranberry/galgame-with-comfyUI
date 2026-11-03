import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Native audio tools can have different write access from Node, especially to
// the Windows system temp directory. Keep audio integration fixtures beside the
// tests, on the same volume as the application. Each caller owns and removes its
// unique directory in its existing teardown, including when assertions fail.
export function createAudioTestDirectory(prefix) {
  return fs.mkdtemp(path.join(fileURLToPath(new URL('../', import.meta.url)), `.tmp-${prefix}`));
}
