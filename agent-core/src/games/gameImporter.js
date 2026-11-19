import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import {
  ZipReader, Uint8ArrayReader, ERR_INVALID_PASSWORD,
  ERR_INVALID_CRC32, ERR_INVALID_COMPRESSED_DATA, ERR_INVALID_UNCOMPRESSED_SIZE,
} from '@zip.js/zip.js';
import { GAME_ENTRY_LIMIT, GAME_FILE_LIMIT, GAME_CONTENT_LIMIT, bad, inside, validateManifest, removeManaged } from './gamePaths.js';
import { loadGitHubGameFiles } from './githubGamePackage.js';

const ZIP_LIMIT = 50 * 1024 * 1024;
const zipPasswordError = message => Object.assign(bad(message), { gameCode: 'ZIP_PASSWORD' });
const zipCryptoDataErrors = new Set([ERR_INVALID_CRC32, ERR_INVALID_COMPRESSED_DATA, ERR_INVALID_UNCOMPRESSED_SIZE]);
const githubRequestError = message => Object.assign(bad(message, 502), { gameMessage: message });
const identityConflict = () => Object.assign(bad('游戏 ID 冲突：这个 ID 已用于另一来源的游戏，或保留数据的来源无法确认', 409), { gameCode: 'GAME_ID_CONFLICT' });

function fingerprintGameFiles(files) {
  const hash = createHash('sha256');
  for (const name of Object.keys(files).sort()) {
    const data = files[name];
    hash.update(JSON.stringify([name, data.length])).update(data);
  }
  return hash.digest('hex');
}

async function unzipProtected(buffer, directory, password) {
  if (!password) throw zipPasswordError('请输入 ZIP 密码');
  const zip = new ZipReader(new Uint8ArrayReader(buffer), { useWebWorkers: false, checkSignature: true });
  try {
    const entries = await zip.getEntries({ filenameEncoding: 'utf-8' });
    if (entries.length !== directory.length) throw bad('ZIP 目录损坏');
    const files = Object.create(null);
    for (const [index, entry] of entries.entries()) {
      const { name, size, encrypted } = directory[index];
      if (entry.filename !== name || entry.uncompressedSize !== size || entry.encrypted !== encrypted) throw bad('ZIP 目录不一致');
      if (entry.directory) continue;
      const data = new Uint8Array(size);
      let written = 0;
      try {
        await entry.getData(new WritableStream({
          write(chunk) {
            if (chunk.length > size - written) throw bad('ZIP 解压体积超限');
            data.set(chunk, written);
            written += chunk.length;
          },
        }), { password });
      } catch (error) {
        if (error.message === ERR_INVALID_PASSWORD) throw zipPasswordError('ZIP 密码不正确，请重试');
        if (entry.zipCrypto && zipCryptoDataErrors.has(error.message)) throw zipPasswordError('ZIP 密码不正确或文件已损坏');
        throw error;
      }
      if (written !== size) throw bad('ZIP 文件大小与目录不一致');
      files[name] = data;
    }
    return files;
  } catch (error) {
    if (error.status) throw error;
    throw bad('ZIP 文件损坏或使用了不支持的压缩或加密格式');
  } finally {
    await zip.close();
  }
}

export function parseGitHubRepo(input) {
  const text = String(input || '').trim().replace(/\.git\/?$/, '').replace(/\/$/, '');
  const match = /^(?:https:\/\/github\.com\/)?([\w-]+)\/([\w.-]+)$/.exec(text);
  if (!match || match[2] === '.' || match[2] === '..') throw bad('请输入 owner/repo 或 GitHub 仓库主页链接');
  return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}` };
}

function inspectPackageFiles(files) {
  const manifestBytes = files['game.json'];
  if (!manifestBytes) throw bad('游戏包根目录必须包含 game.json');
  if (manifestBytes.length > 128 * 1024) throw bad('game.json 过大');
  let value;
  try { value = JSON.parse(new TextDecoder().decode(manifestBytes)); }
  catch { throw bad('game.json 不是有效的 JSON'); }
  const manifest = validateManifest(value);
  if (!files[manifest.entry] || (manifest.serverEntry && !files[manifest.serverEntry])) throw bad('游戏入口文件缺失');
  return { manifest, files };
}

export async function inspectZip(buffer, password) {
  if (!Buffer.isBuffer(buffer) || buffer.length > ZIP_LIMIT || buffer.length < 22) throw bad('ZIP 无效或超过 50MB');
  // Inspect central directory before allocating uncompressed content, including
  // Unix symlinks and Windows case-insensitive filename collisions.
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw bad('不支持分卷或损坏的 ZIP');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), total = 0;
  if (!count || count > GAME_ENTRY_LIMIT || offset >= end) throw bad('ZIP 条目过多或目录损坏');
  const names = new Set(), directory = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw bad('ZIP 目录损坏');
    const flags = buffer.readUInt16LE(offset + 8), size = buffer.readUInt32LE(offset + 24), length = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 46, offset + 46 + length).toString('utf8');
    const mode = (buffer.readUInt32LE(offset + 38) >>> 16) & 0xf000;
    if (mode === 0xa000 || size > GAME_FILE_LIMIT || (total += size) > GAME_CONTENT_LIMIT) throw bad('ZIP 含符号链接或解压体积超限');
    inside('/game', name.replace(/\/$/, ''));
    const key = name.replace(/\/$/, '').toLowerCase();
    if (names.has(key)) throw bad('ZIP 含重名文件');
    names.add(key);
    directory.push({ name, size, encrypted: Boolean(flags & 1) });
    offset += 46 + length + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  let expanded = 0;
  const files = directory.some(entry => entry.encrypted) ? await unzipProtected(buffer, directory, password) : unzipSync(buffer, { filter: file => {
    if (file.originalSize > GAME_FILE_LIMIT || (expanded += file.originalSize) > GAME_CONTENT_LIMIT) throw bad('ZIP 解压体积超限');
    inside('/game', file.name.replace(/\/$/, '')); return !file.name.endsWith('/');
  } });
  const keys = Object.keys(files);
  if (keys.length > GAME_ENTRY_LIMIT) throw bad('ZIP 条目过多');
  const roots = keys.filter(n => n === 'game.json' || /^[^/]+\/game\.json$/.test(n));
  if (roots.length !== 1) throw bad('ZIP 根目录或唯一外层目录中必须有一份 game.json');
  const prefix = roots[0].slice(0, -'game.json'.length);
  if (keys.some(n => !n.startsWith(prefix))) throw bad('ZIP 包含游戏目录以外的文件');
  const normalized = Object.fromEntries(keys.map(n => [n.slice(prefix.length), files[n]]));
  const seen = new Set(); let bytes = 0;
  for (const [name, file] of Object.entries(normalized)) {
    inside('/game', name);
    if (seen.has(name.toLowerCase()) || (bytes += file.length) > GAME_CONTENT_LIMIT) throw bad('ZIP 文件重复或体积超限');
    seen.add(name.toLowerCase());
  }
  return inspectPackageFiles(normalized);
}
export function createGameImporter(manager, {
  fetchImpl = fetch, loadGitHub = loadGitHubGameFiles, settings = { get: () => ({}), set: () => {} }, now = Date.now,
} = {}) {
  let cached = null, pending = null, installing = false;
  const getSettings = () => settings.get() || {};
  const publicSettings = () => { const s = getSettings(); return { hasToken: !!s.token, mirrorPrefix: s.mirrorPrefix || '' }; };
  const mirror = url => {
    const prefix = getSettings().mirrorPrefix;
    return prefix ? `${prefix.replace(/\/$/, '')}/${url}` : url;
  };
  async function request(url, limit, api = false) {
    const headers = { 'User-Agent': 'Linshe-Games', Accept: 'application/vnd.github+json' };
    // The optional token is for API requests. Public Git pulls use the shared proxy.
    if (api && new URL(url).hostname === 'api.github.com' && getSettings().token) headers.Authorization = `Bearer ${getSettings().token}`;
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(60000), redirect: api ? 'error' : 'follow' })
      .catch(() => { throw githubRequestError('连不上 GitHub，请检查网络或工坊连接设置'); });
    if (!response.ok) {
      await response.body?.cancel();
      throw githubRequestError(response.status === 403 || response.status === 429
        ? 'GitHub 请求受限，请稍后重试或配置 Token' : `GitHub 请求失败（${response.status}）`);
    }
    if (Number(response.headers.get('content-length')) > limit) throw bad('远端文件超过大小限制');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > limit) throw bad('远端文件超过大小限制'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async function discoverCatalog(refresh) {
    if (!refresh && cached && now() - cached.fetchedAt < 20 * 60 * 1000) return { ...cached, cached: true };
    if (pending) return pending;
    const previous = cached;
    const load = (async () => {
      try {
        const search = JSON.parse(await request('https://api.github.com/search/repositories?q=topic%3Alinshe-game&sort=updated&order=desc&per_page=30', 2 * 1024 * 1024, true));
        const source = search.items || [], items = [];
        let index = 0;
        await Promise.all(Array.from({ length: Math.min(4, source.length) }, async () => {
          while (index < source.length) {
            const item = source[index++];
            try {
              const repo = parseGitHubRepo(item.full_name);
              const manifest = validateManifest(JSON.parse(await request(mirror(`https://raw.githubusercontent.com/${repo.fullName}/${encodeURIComponent(item.default_branch)}/game.json`), 128 * 1024)));
              items.push({ ...manifest, source: 'github', repoUrl: `https://github.com/${repo.fullName}`, fullName: repo.fullName, branch: item.default_branch, stars: item.stargazers_count, updatedAt: item.updated_at });
            } catch { /* Repositories without a valid root manifest are not games. */ }
          }
        }));
        items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const catalog = { items, fetchedAt: now(), incomplete: !!search.incomplete_results };
        if (pending === load) cached = catalog;
        return { ...catalog, cached: false };
      } catch (error) { if (previous) return { ...previous, cached: true, stale: true, warning: error.message }; throw error; }
    })().finally(() => { if (pending === load) pending = null; });
    pending = load;
    return load;
  }
  async function discover(refresh = false) {
    const catalog = await discoverCatalog(refresh);
    const items = catalog.items.map(item => {
      const status = manager.communityInstallStatus(item.id, { source: 'github', repoUrl: item.repoUrl });
      return { ...item, installStatus: status === 'official' ? 'conflict' : status };
    });
    return { ...catalog, items };
  }
  async function installPackage(loadPackage, { source, repoUrl = null, replace = false, updateId }) {
    if (installing) throw bad('已有游戏正在安装，请稍后重试', 409);
    installing = true;
    const stagingId = `staging-${randomUUID()}`, backupId = `backup-${randomUUID()}`;
    const root = manager.communityDir, stage = inside(root, stagingId), backup = inside(root, backupId);
    let destination, movedOld = false, movedNew = false, markedId;
    try {
      const { manifest, files } = await loadPackage(stage);
      if (updateId && manifest.id !== updateId) throw bad('仓库中的游戏 ID 已变更，无法保留数据更新', 409);
      const zipFingerprint = source === 'zip' ? fingerprintGameFiles(files) : null;
      const status = manager.communityInstallStatus(manifest.id, { source, repoUrl, zipFingerprint });
      if (status === 'official') throw bad('不能覆盖官方游戏');
      if (status === 'conflict') throw identityConflict();
      if (updateId && status !== 'installed') throw bad('游戏已卸载，请重新安装', 409);
      if (status === 'installed' && !replace) throw bad('游戏已安装，请使用更新操作', 409);
      if (manager.changing.has(manifest.id)) throw bad('游戏正在进行其他操作，请稍后重试', 409);
      if (!manager.compatible(manifest)) throw bad(`此游戏需要邻舍 ${manifest.minAppVersion} 或更高版本`);
      destination = inside(root, manifest.id);
      fs.mkdirSync(stage, { recursive: true });
      for (const [name, data] of Object.entries(files)) { const file = inside(stage, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
      manager.readManifest(stage);
      markedId = manifest.id; manager.changing.add(markedId);
      await manager.unload(manifest.id);
      if (fs.existsSync(destination)) { fs.renameSync(destination, backup); movedOld = true; }
      fs.renameSync(stage, destination); movedNew = true;
      manager.repo.register(manifest, source, destination, repoUrl, zipFingerprint);
      return manager.publicGame(manager.repo.game(manifest.id));
    } catch (error) {
      if (movedNew) removeManaged(root, path.basename(destination));
      if (movedOld) { fs.renameSync(backup, destination); movedOld = false; }
      throw error;
    } finally {
      installing = false;
      if (markedId) manager.changing.delete(markedId);
      removeManaged(root, stagingId);
      if (movedOld) removeManaged(root, backupId);
    }
  }
  async function installGitHub(input, replace = false, updateId) {
    const repo = parseGitHubRepo(input);
    const repoUrl = `https://github.com/${repo.fullName}`;
    return installPackage(async stage => inspectPackageFiles(await loadGitHub(repoUrl, stage)), { source: 'github', repoUrl, replace, updateId });
  }
  return { discover, publicSettings, installGitHub,
    installZip(buffer, { replace = false, password } = {}) {
      return installPackage(() => inspectZip(buffer, password), { source: 'zip', replace });
    },
    saveSettings(input) {
      const s = getSettings();
      if (input.token !== undefined) s.token = String(input.token).trim().slice(0, 500);
      if (input.mirrorPrefix !== undefined) {
        const prefix = String(input.mirrorPrefix).trim();
        if (prefix) { const url = new URL(prefix); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw bad('镜像前缀必须是无凭据的 HTTPS 地址'); }
        s.mirrorPrefix = prefix;
      }
      settings.set(s);
      cached = pending = null;
      return publicSettings();
    },
    updateGitHub(id) {
      const game = manager.get(id, { disabled: true });
      if (game.source !== 'github' || !game.repo_url) throw bad('仅支持从原仓库更新通过 GitHub 安装的游戏');
      return installGitHub(game.repo_url, true, game.id);
    },
  };
}
