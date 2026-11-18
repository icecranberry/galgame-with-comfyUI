import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = fileURLToPath(new URL('../../../', import.meta.url));
export const OFFICIAL_DIR = path.join(ROOT_DIR, 'games', 'official');
export const DATA_DIR = path.join(ROOT_DIR, 'agent-core', 'data');
export const COMMUNITY_DIR = path.join(DATA_DIR, 'games_community');
export const MEDIA_DIR = path.join(DATA_DIR, 'game');
export const GAME_ENTRY_LIMIT = 5000, GAME_FILE_LIMIT = 20 * 1024 * 1024, GAME_CONTENT_LIMIT = 100 * 1024 * 1024;
export const bad = (message, status = 400) => Object.assign(new Error(message), { status });
export function validId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(value)) throw bad('无效的游戏或存档编号');
  return value;
}
export function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || relative.startsWith('/') || relative.split('/').some(p => p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw bad('文件路径不合法');
  const target = path.resolve(root, relative);
  const rel = path.relative(path.resolve(root), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw bad('文件路径越界');
  return target;
}
export function regularFile(root, relative) {
  const target = inside(root, relative);
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(target);
  const rel = path.relative(realRoot, real);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(real).isFile()) throw bad('游戏文件不存在或路径越界', 404);
  return real;
}
// Recursive removals accept only a validated immediate child of a managed root.
export function removeManaged(root, id) {
  const target = inside(root, validId(id));
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw bad('拒绝清理符号链接目录');
  fs.rmSync(target, { recursive: true, force: true });
}
export const PERMISSIONS = ['bridge:read', 'llm:chat', 'image:generate', 'save:rw'];
export function validateManifest(value, { allowMissingNsfw = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad('game.json 必须是 JSON 对象');
  validId(value.id);
  for (const key of ['name', 'version', 'entry']) if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 300) throw bad(`game.json 缺少有效的 ${key}`);
  if (typeof value.nsfw !== 'boolean' && !(allowMissingNsfw && value.nsfw === undefined)) {
    throw bad('game.json 必须用布尔值 nsfw 声明是否为 NSFW');
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.version)) throw bad('游戏版本必须采用 x.y.z 格式');
  for (const key of ['entry', 'cover', 'serverEntry']) if (value[key]) inside('/game', value[key]);
  if (!value.entry.endsWith('.html')) throw bad('entry 必须指向 HTML 文件');
  if (value.serverEntry && !value.serverEntry.endsWith('.mjs')) throw bad('serverEntry 必须是单文件 .mjs');
  if (value.minAppVersion && !/^\d+\.\d+\.\d+$/.test(value.minAppVersion)) throw bad('minAppVersion 格式不正确');
  if (value.permissions !== undefined && (!Array.isArray(value.permissions) || value.permissions.some(p => !PERMISSIONS.includes(p)))) throw bad('game.json 包含不支持的权限');
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.length > 20 || value.tags.some(t => typeof t !== 'string' || t.length > 40))) throw bad('tags 格式不正确');
  return { ...value, author: String(value.author || '').slice(0, 200), description: String(value.description || '').slice(0, 2000), permissions: [...new Set(value.permissions || [])] };
}
