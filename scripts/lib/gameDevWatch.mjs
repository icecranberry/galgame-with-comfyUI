import fs from 'node:fs';
import path from 'node:path';
import { COMMUNITY_DIR, OFFICIAL_DIR, inside, validId } from '../../agent-core/src/games/gamePaths.js';

const roots = [[OFFICIAL_DIR, true], [COMMUNITY_DIR, false]];
const installScratch = /^(?:staging|backup)-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

function readPackage(root, gameId) {
  try {
    validId(gameId);
    const dir = inside(root, gameId);
    const file = path.join(dir, 'game.json');
    if (fs.statSync(file).size > 128 * 1024) return null;
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.id !== gameId) return null;
    const entry = inside(dir, manifest.entry);
    const serverEntry = manifest.serverEntry ? inside(dir, manifest.serverEntry) : null;
    const ready = fs.statSync(entry, { throwIfNoEntry: false })?.isFile()
      && (!serverEntry || fs.statSync(serverEntry, { throwIfNoEntry: false })?.isFile());
    return { web: path.dirname(entry), serverEntry, ready: Boolean(ready) };
  } catch { return null; }
}

function isWebFile(web, file) {
  const relative = path.relative(web, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    && !relative.split(path.sep).some(part => part.startsWith('.') || /^(?:server|scenarios|node_modules)$/i.test(part));
}

// Keep these paths off Vite's module watcher: HTML changes there can trigger a page reload.
export function watchGameFiles(onChanges) {
  fs.mkdirSync(COMMUNITY_DIR, { recursive: true });
  const ready = new Set();
  const pending = new Map();
  let timer;

  function flush() {
    const changes = [];
    for (const [dir, { root, gameId, official, files }] of pending) {
      const game = readPackage(root, gameId);
      const becameReady = game?.ready && !ready.has(dir);
      if (game?.ready) ready.add(dir);
      else ready.delete(dir);

      const manifestChanged = files.has(path.join(dir, 'game.json'));
      const pluginChanged = game?.serverEntry && files.has(game.serverEntry);
      if (becameReady || manifestChanged || pluginChanged) changes.push({ gameId, official, backend: true });
      else if (game?.ready && [...files].some(file => isWebFile(game.web, file))) changes.push({ gameId, official, backend: false });
    }
    pending.clear();
    if (changes.length) onChanges(changes);
  }

  const watchers = [];
  for (const [root, official] of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
      if (dir.isDirectory() && !installScratch.test(dir.name) && readPackage(root, dir.name)?.ready) {
        ready.add(path.join(root, dir.name));
      }
    }
    const watcher = fs.watch(root, { recursive: true, persistent: false }, (_event, name) => {
      if (!name) return;
      const [gameId] = name.split(path.sep);
      if (!/^[a-z\d][a-z\d_-]{0,79}$/i.test(gameId) || installScratch.test(gameId)) return;
      const dir = path.join(root, gameId);
      if (!pending.has(dir)) pending.set(dir, { root, gameId, official, files: new Set() });
      pending.get(dir).files.add(path.resolve(root, name));
      clearTimeout(timer);
      timer = setTimeout(flush, 250);
    });
    watcher.on('error', error => console.warn(`[game-dev] ${root}: ${error.message}`));
    watchers.push(watcher);
  }

  return () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}
