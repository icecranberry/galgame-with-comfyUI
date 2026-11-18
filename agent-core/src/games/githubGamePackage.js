import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { githubTransport } from '../services/githubTransport.js';
import { ROOT_DIR, GAME_ENTRY_LIMIT, GAME_FILE_LIMIT, GAME_CONTENT_LIMIT, bad, inside, removeManaged } from './gamePaths.js';

const execute = promisify(execFile);
const GIT_TIMEOUT = 60_000;
const GIT_STORE_LIMIT = 2 * GAME_CONTENT_LIMIT;
const GIT_CONNECTION_ERROR = /failed to connect|could not connect|could not resolve (?:host|proxy)|connection timed out|connection was reset|connect tunnel failed|proxy connect aborted|empty reply from server|operation too slow/i;
const githubError = message => Object.assign(bad(message, 502), { gameMessage: message });
const portableRoot = path.join(ROOT_DIR, 'runtime', 'git');

async function runGit(args, { cwd, input, signal, maxBuffer = 4 * 1024 * 1024 } = {}) {
  const executable = ['cmd', 'bin'].map(dir => path.join(portableRoot, dir, 'git.exe'))
    .find(file => fs.existsSync(file)) || 'git';
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(?:git_|(?:http|https|all|no)_proxy$)/i.test(key)));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    // Git for Windows rejects the native NUL path as a config file name.
    GIT_CONFIG_GLOBAL: path.join(cwd, '.github-import-global'),
    GIT_TERMINAL_PROMPT: '0',
  });
  const command = execute(executable, args, { cwd, env, signal, maxBuffer, timeout: GIT_TIMEOUT, encoding: 'buffer', windowsHide: true });
  command.child.stdin?.on('error', () => {});
  command.child.stdin?.end(input);
  return (await command).stdout;
}

async function shallowClone(run, url, repository, proxyUrl) {
  const controller = new AbortController();
  const ca = path.join(portableRoot, 'mingw64', 'etc', 'ssl', 'certs', 'ca-bundle.crt');
  const args = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', `http.proxy=${proxyUrl}`,
    '-c', 'fetch.unpackLimit=1', ...(fs.existsSync(ca) ? ['-c', `http.sslCAInfo=${ca}`] : []),
    'clone', '--bare', '--depth', '1', '--single-branch', '--no-tags', '--template=', '--', url, repository];
  const checkStore = () => {
    const packs = path.join(repository, 'objects', 'pack');
    try {
      const bytes = fs.readdirSync(packs).reduce((total, pack) => total + (fs.statSync(path.join(packs, pack), { throwIfNoEntry: false })?.size || 0), 0);
      if (bytes > GIT_STORE_LIMIT) controller.abort();
    } catch (error) {
      // Git creates and renames its temporary pack files while downloading.
      if (error.code !== 'ENOENT') controller.abort();
    }
  };
  const interval = setInterval(checkStore, 250);
  try {
    await run(args, { cwd: path.dirname(repository), signal: controller.signal });
    checkStore();
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearInterval(interval);
  }
  if (controller.signal.aborted) throw bad('GitHub 仓库拉取数据超过大小限制或无法写入');
}

function readEntries(buffer) {
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer).split('\0');
  if (raw.pop() !== '' || !raw.length || raw.length > GAME_ENTRY_LIMIT) throw bad('GitHub 游戏仓库为空、条目过多或目录损坏');
  const seen = new Set();
  let total = 0;
  return raw.map(record => {
    const match = /^100(?:644|755) blob ([a-f0-9]{40,64}) +([0-9]+)\t([\s\S]+)$/.exec(record);
    if (!match) throw bad('GitHub 游戏仓库只能包含普通文件，符号链接和子模块须改为随包文件');
    const [, oid, bytes, name] = match;
    const size = Number(bytes);
    inside('/game', name);
    const key = name.toLowerCase();
    if (/(?:^|\/)\.git(?:\/|$)/.test(key) || seen.has(key)) throw bad('GitHub 游戏仓库包含重名文件或无效路径');
    if (size > GAME_FILE_LIMIT || (total += size) > GAME_CONTENT_LIMIT) throw bad('GitHub 游戏仓库文件大小超过限制');
    seen.add(key);
    return { oid, size, name };
  });
}

export async function loadGitHubGameFiles(repoUrl, stage, { run = runGit, resolveProxy = githubTransport.resolveSettings } = {}) {
  const repository = inside(stage, 'repository');
  fs.mkdirSync(stage, { recursive: true });
  try {
    const { proxyUrl, proxyMode } = await resolveProxy();
    try {
      await shallowClone(run, `${repoUrl}.git`, repository, proxyUrl);
    } catch (error) {
      if (proxyMode !== 'auto' || !proxyUrl || !(error.killed || GIT_CONNECTION_ERROR.test(String(error.stderr)))) throw error;
      removeManaged(stage, 'repository');
      await shallowClone(run, `${repoUrl}.git`, repository, '');
    }

    // Read tracked blobs verbatim. The bare repository stays in staging and the
    // install does not run checkout filters or populate submodules.
    const entries = readEntries(await run(['ls-tree', '-r', '-l', '-z', 'HEAD'], { cwd: repository }));
    if (!entries.some(entry => entry.name === 'game.json')) throw bad('GitHub 游戏仓库根目录必须包含 game.json');
    const output = await run(['cat-file', '--batch'], {
      cwd: repository,
      input: entries.map(entry => entry.oid).join('\n') + '\n',
      maxBuffer: GAME_CONTENT_LIMIT + 128 * entries.length,
    });
    const files = Object.create(null);
    let offset = 0;
    for (const { oid, name, size } of entries) {
      const headerEnd = output.indexOf(10, offset);
      const contentEnd = headerEnd + 1 + size;
      if (headerEnd < 0 || output.toString('ascii', offset, headerEnd) !== `${oid} blob ${size}` || output[contentEnd] !== 10) {
        throw bad('GitHub 游戏仓库中的对象与目录不一致');
      }
      files[name] = output.subarray(headerEnd + 1, contentEnd);
      offset = contentEnd + 1;
    }
    return files;
  } catch (error) {
    if (error.status) throw error;
    if (error.code === 'ENOENT') throw githubError('未找到 Git，请使用邻舍整合包或安装 Git 后重试');
    if (error.killed) throw githubError('GitHub 仓库拉取超时，请检查工坊连接设置后重试');
    throw githubError('GitHub 仓库拉取失败，请确认仓库公开且默认分支可访问，并检查工坊连接设置');
  } finally {
    removeManaged(stage, 'repository');
  }
}
