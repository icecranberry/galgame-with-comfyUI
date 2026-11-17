import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { bad, inside, validateManifest, removeManaged } from './gamePaths.js';

const ZIP_LIMIT = 50 * 1024 * 1024, CONTENT_LIMIT = 100 * 1024 * 1024;
export function parseGitHubRepo(input) {
  const text = String(input || '').trim().replace(/\.git\/?$/, '').replace(/\/$/, '');
  const match = /^(?:https:\/\/github\.com\/)?([\w-]+)\/([\w.-]+)$/.exec(text);
  if (!match || match[2] === '.' || match[2] === '..') throw bad('请输入 owner/repo 或 GitHub 仓库主页链接');
  return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}` };
}
export function inspectZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > ZIP_LIMIT || buffer.length < 22) throw bad('ZIP 无效或超过 50MB');
  // Inspect central directory before allocating uncompressed content, including
  // Unix symlinks and Windows case-insensitive filename collisions.
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw bad('不支持分卷或损坏的 ZIP');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), total = 0;
  if (!count || count > 5000 || offset >= end) throw bad('ZIP 条目过多或目录损坏');
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw bad('ZIP 目录损坏');
    const flags = buffer.readUInt16LE(offset + 8), size = buffer.readUInt32LE(offset + 24), length = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 46, offset + 46 + length).toString('utf8');
    const mode = (buffer.readUInt32LE(offset + 38) >>> 16) & 0xf000;
    if (flags & 1 || mode === 0xa000 || size > 20 * 1024 * 1024 || (total += size) > CONTENT_LIMIT) throw bad('ZIP 含加密文件、符号链接或解压体积超限');
    inside('/game', name.replace(/\/$/, ''));
    const key = name.replace(/\/$/, '').toLowerCase();
    if (names.has(key)) throw bad('ZIP 含重名文件');
    names.add(key);
    offset += 46 + length + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
  let expanded = 0;
  const files = unzipSync(buffer, { filter: file => {
    if (file.originalSize > 20 * 1024 * 1024 || (expanded += file.originalSize) > CONTENT_LIMIT) throw bad('ZIP 解压体积超限');
    inside('/game', file.name.replace(/\/$/, '')); return !file.name.endsWith('/');
  } });
  const keys = Object.keys(files);
  if (keys.length > 5000) throw bad('ZIP 条目过多');
  const roots = keys.filter(n => n === 'game.json' || /^[^/]+\/game\.json$/.test(n));
  if (roots.length !== 1) throw bad('ZIP 根目录或唯一外层目录中必须有一份 game.json');
  const prefix = roots[0].slice(0, -'game.json'.length);
  if (keys.some(n => !n.startsWith(prefix))) throw bad('ZIP 包含游戏目录以外的文件');
  const manifest = validateManifest(JSON.parse(new TextDecoder().decode(files[roots[0]])));
  const normalized = Object.fromEntries(keys.map(n => [n.slice(prefix.length), files[n]]));
  const seen = new Set(); let bytes = 0;
  for (const [name, file] of Object.entries(normalized)) {
    inside('/game', name);
    if (seen.has(name.toLowerCase()) || (bytes += file.length) > CONTENT_LIMIT) throw bad('ZIP 文件重复或体积超限');
    seen.add(name.toLowerCase());
  }
  if (!normalized[manifest.entry] || (manifest.serverEntry && !normalized[manifest.serverEntry])) throw bad('游戏入口文件缺失');
  return { manifest, files: normalized };
}
export function createGameImporter(manager, { fetchImpl = fetch, settings = { get: () => ({}), set: () => {} }, now = Date.now } = {}) {
  let cached = null, pending = null, installing = false;
  const getSettings = () => settings.get() || {};
  const publicSettings = () => { const s = getSettings(); return { hasToken: !!s.token, mirrorPrefix: s.mirrorPrefix || '' }; };
  const mirror = url => {
    const prefix = getSettings().mirrorPrefix;
    return prefix ? `${prefix.replace(/\/$/, '')}/${url}` : url;
  };
  async function request(url, limit, api = false) {
    const headers = { 'User-Agent': 'Linshe-Games', Accept: 'application/vnd.github+json' };
    // Credentials go only to api.github.com, never Raw, Archives or mirrors.
    if (api && new URL(url).hostname === 'api.github.com' && getSettings().token) headers.Authorization = `Bearer ${getSettings().token}`;
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(60000), redirect: api ? 'error' : 'follow' });
    if (!response.ok) throw bad(response.status === 403 || response.status === 429 ? 'GitHub 请求受限，请稍后重试或配置 Token' : `GitHub 请求失败（${response.status}）`, 502);
    if (Number(response.headers.get('content-length')) > limit) throw bad('远端文件超过大小限制');
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; if (bytes > limit) throw bad('远端文件超过大小限制'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async function discover(refresh = false) {
    if (!refresh && cached && now() - cached.fetchedAt < 20 * 60 * 1000) return { ...cached, cached: true };
    if (pending) return pending;
    pending = (async () => {
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
              items.push({ ...manifest, repoUrl: `https://github.com/${repo.fullName}`, fullName: repo.fullName, branch: item.default_branch, stars: item.stargazers_count, updatedAt: item.updated_at });
            } catch { /* Repositories without a valid root manifest are not games. */ }
          }
        }));
        items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        cached = { items, fetchedAt: now(), incomplete: !!search.incomplete_results }; return { ...cached, cached: false };
      } catch (error) { if (cached) return { ...cached, cached: true, stale: true, warning: error.message }; throw error; }
    })().finally(() => { pending = null; });
    return pending;
  }
  async function installZip(buffer, { source = 'zip', repoUrl = null, replace = false, expectedId } = {}) {
    if (installing) throw bad('已有游戏正在安装，请稍后重试', 409);
    installing = true;
    const stagingId = `staging-${randomUUID()}`, backupId = `backup-${randomUUID()}`;
    const root = manager.communityDir, stage = inside(root, stagingId), backup = inside(root, backupId);
    let destination, movedOld = false, movedNew = false, markedId;
    try {
      const { manifest, files } = inspectZip(buffer);
      if (expectedId && manifest.id !== expectedId) throw bad('下载包的游戏编号与清单不一致');
      const old = manager.repo.game(manifest.id);
      if (old?.source === 'official' || fs.existsSync(inside(manager.officialDir, manifest.id))) throw bad('不能覆盖官方游戏');
      if (old?.installed && !replace) throw bad('游戏已安装，请使用更新操作', 409);
      if (!manager.compatible(manifest)) throw bad(`此游戏需要邻舍 ${manifest.minAppVersion} 或更高版本`);
      destination = inside(root, manifest.id);
      fs.mkdirSync(stage, { recursive: true });
      for (const [name, data] of Object.entries(files)) { const file = inside(stage, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
      manager.readManifest(stage);
      markedId = manifest.id; manager.changing.add(markedId);
      await manager.unload(manifest.id);
      if (fs.existsSync(destination)) { fs.renameSync(destination, backup); movedOld = true; }
      fs.renameSync(stage, destination); movedNew = true;
      manager.repo.register(manifest, source, destination, repoUrl);
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
  return { discover, installZip, publicSettings,
    saveSettings(input) {
      const s = getSettings();
      if (input.token !== undefined) s.token = String(input.token).trim().slice(0, 500);
      if (input.mirrorPrefix !== undefined) {
        const prefix = String(input.mirrorPrefix).trim();
        if (prefix) { const url = new URL(prefix); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw bad('镜像前缀必须是无凭据的 HTTPS 地址'); }
        s.mirrorPrefix = prefix;
      }
      settings.set(s); cached = null; return publicSettings();
    },
    async installGitHub(input, replace = false) {
      const repo = parseGitHubRepo(input);
      const info = JSON.parse(await request(`https://api.github.com/repos/${repo.fullName}`, 256 * 1024, true));
      const branch = encodeURIComponent(info.default_branch);
      const manifest = validateManifest(JSON.parse(await request(mirror(`https://raw.githubusercontent.com/${repo.fullName}/${branch}/game.json`), 128 * 1024)));
      const zip = await request(mirror(`https://github.com/${repo.fullName}/archive/refs/heads/${branch}.zip`), ZIP_LIMIT);
      return installZip(zip, { source: 'github', repoUrl: `https://github.com/${repo.fullName}`, replace, expectedId: manifest.id });
    },
  };
}
