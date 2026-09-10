#!/usr/bin/env node
/**
 * 带「条件代理」的 git 包装器。
 *
 * 背景：git 的 http.proxy 是静态配置，没法表达"代理端口在就走代理、直连可行就直连"。
 * 本脚本在每次调用前做一次网络判定，再把结果以 -c 参数传给 git：
 *
 *   1. 直连探测：对 https://github.com 发一个 HEAD（2.5s 超时）
 *        可达 → 直连（并显式清空可能存在的 http.proxy，避免被全局配置带偏）
 *        不可达 → 进入第 2 步
 *   2. 本地代理探测：按顺序 TCP 连 7890/7891/10809/10808/7892/8080/8888
 *        找到监听中的端口 → 用它作代理
 *        都没有 → 报错并给出可操作提示
 *   3. 容错：选定路径后若 git 仍失败，且另一条路径可用，则自动换路重试一次
 *        （--no-fallback 关闭；直连成功但传输中被重置的场景尤其有用）
 *
 * 用法：
 *   node scripts/git-net.mjs <git 子命令及参数…>
 *   node scripts/git-net.mjs push fork merge-upstream-ai-town
 *   node scripts/git-net.mjs fetch origin main
 *
 * 选项：
 *   --direct            强制直连（不探测、不回退）
 *   --proxy[=URL]       强制走代理（URL 省略时自动探测本地端口）
 *   --ssl-openssl       改用随包的 OpenSSL 后端（规避 Windows schannel 吊销检查/凭据异常，
 *                       与 launcher/launcher/git_manager.py 的兜底同一思路）
 *   --no-fallback       选定路径失败后不再换路重试
 *   --quiet             只输出 git 自身输出
 * 环境变量：
 *   GIT_NET_MODE=auto|direct|proxy   等价于上面的开关
 *   GIT_NET_PROXY=http://127.0.0.1:7890   指定代理
 *   GIT_NET_PORTS=7890,7891,…         自定义本地代理端口探测顺序
 *   GIT_NET_DIRECT_PROBE=0            跳过直连探测，直接找代理（省 2.5s）
 *   GIT_NET_SSL_OPENSSL=1             等价于 --ssl-openssl
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROBE_TIMEOUT_MS = 2500;
const PORT_TIMEOUT_MS = 400;
const DEFAULT_PORTS = '7890,7891,10809,10808,7892,8080,8888';
// 随包 Git 的 CA 包（改用 OpenSSL 后端时必须显式指定，兼容便携版 Git）
const BUNDLED_CA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'runtime', 'git', 'mingw64', 'etc', 'ssl', 'certs', 'ca-bundle.crt',
);

function parseArgs(argv) {
  const args = [];
  let mode = (process.env.GIT_NET_MODE || 'auto').toLowerCase();
  let proxyUrl = process.env.GIT_NET_PROXY || '';
  let fallback = true;
  let quiet = false;
  let sslOpenssl = process.env.GIT_NET_SSL_OPENSSL === '1';
  for (const arg of argv) {
    if (arg === '--direct') { mode = 'direct'; continue; }
    if (arg === '--proxy') { mode = 'proxy'; continue; }
    if (arg.startsWith('--proxy=')) { mode = 'proxy'; proxyUrl = arg.slice('--proxy='.length); continue; }
    if (arg === '--ssl-openssl') { sslOpenssl = true; continue; }
    if (arg === '--no-fallback') { fallback = false; continue; }
    if (arg === '--quiet') { quiet = true; continue; }
    args.push(arg);
  }
  return { args, mode, proxyUrl, fallback, quiet, sslOpenssl };
}

function log(quiet, text) { if (!quiet) console.log(`[git-net] ${text}`); }

/** 直连是否真的可用（TCP 通不代表 HTTPS 通：GFW 常在握手/传输中重置，所以实际发一次请求） */
async function directReachable() {
  if (process.env.GIT_NET_DIRECT_PROBE === '0') return false;
  try {
    await fetch('https://github.com/', { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    const done = ok => { socket.destroy(); resolve(ok); };
    socket.setTimeout(PORT_TIMEOUT_MS);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function findLocalProxy() {
  const ports = (process.env.GIT_NET_PORTS || DEFAULT_PORTS).split(',').map(s => Number.parseInt(s.trim(), 10)).filter(Boolean);
  for (const port of ports) {
    if (await portOpen(port)) return `http://127.0.0.1:${port}`;
  }
  return '';
}

/** 直连时要显式清掉可能存在的全局/URL 级代理，否则"直连"其实还是走代理 */
function directArgs() {
  return [
    '-c', 'http.proxy=', '-c', 'https.proxy=',
    '-c', 'http.https://github.com/.proxy=', '-c', 'https.https://github.com/.proxy=',
  ];
}

function proxyArgs(proxyUrl) {
  return ['-c', `http.proxy=${proxyUrl}`, '-c', `https.proxy=${proxyUrl}`];
}

/** schannel 异常时改用随包 OpenSSL 后端（CA 包缺失则只切后端） */
function sslArgs(enabled) {
  if (!enabled) return [];
  const args = ['-c', 'http.sslBackend=openssl'];
  if (existsSync(BUNDLED_CA)) args.push('-c', `http.sslCAInfo=${BUNDLED_CA}`);
  return args;
}

function runGit(args, extra) {
  return new Promise(resolve => {
    const child = spawn('git', [...extra, ...args], { stdio: 'inherit', shell: false });
    child.on('error', err => { console.error(`[git-net] 无法启动 git: ${err.message}`); resolve(127); });
    child.on('close', code => resolve(code ?? 1));
  });
}

async function main() {
  const { args, mode, proxyUrl: forcedProxy, fallback, quiet, sslOpenssl } = parseArgs(process.argv.slice(2));
  if (args.length === 0) {
    console.error('用法: node scripts/git-net.mjs <git 子命令及参数…>  例: node scripts/git-net.mjs push fork main');
    process.exit(2);
  }
  const netArgs = sslArgs(sslOpenssl);
  if (sslOpenssl) log(quiet, '使用随包 OpenSSL 后端（--ssl-openssl）');

  // 强制直连
  if (mode === 'direct') {
    log(quiet, '按 --direct/GIT_NET_MODE=direct 直连');
    process.exit(await runGit(args, [...netArgs, ...directArgs()]));
  }

  // 代理优先模式：找不到代理端口、或代理失败，都退化为直连（用 --no-fallback 关掉退化）
  if (mode === 'proxy') {
    const url = forcedProxy || await findLocalProxy();
    if (!url) {
      log(quiet, '未发现可用的本地代理端口 → 退化为直连');
      process.exit(await runGit(args, [...netArgs, ...directArgs()]));
    }
    log(quiet, `按指定代理 ${url}`);
    const code = await runGit(args, [...netArgs, ...proxyArgs(url)]);
    if (code === 0 || !fallback) process.exit(code);
    log(quiet, `代理失败（exit ${code}），自动改直连重试一次`);
    process.exit(await runGit(args, [...netArgs, ...directArgs()]));
  }

  // 自动：先直连，再代理，失败可换路
  const proxy = forcedProxy || await findLocalProxy();
  if (await directReachable()) {
    log(quiet, '直连可用 → 直连');
    const code = await runGit(args, [...netArgs, ...directArgs()]);
    if (code === 0 || !fallback || !proxy) process.exit(code);
    log(quiet, `直连失败（exit ${code}），自动改用代理 ${proxy} 重试一次`);
    process.exit(await runGit(args, [...netArgs, ...proxyArgs(proxy)]));
  }

  if (proxy) {
    log(quiet, `直连不可用 → 使用本地代理 ${proxy}`);
    const code = await runGit(args, [...netArgs, ...proxyArgs(proxy)]);
    if (code === 0 || !fallback) process.exit(code);
    log(quiet, `代理失败（exit ${code}），自动改直连重试一次`);
    process.exit(await runGit(args, [...netArgs, ...directArgs()]));
  }

  console.error('[git-net] 直连不可用，也没找到本地代理端口。');
  console.error('          请先启动代理客户端（Clash/Verge 等），或用 GIT_NET_PROXY=http://127.0.0.1:<端口> 指定。');
  process.exit(2);
}

main();
