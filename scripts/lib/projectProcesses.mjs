/**
 * projectProcesses.mjs — 本项目开发进程的识别与清理
 *
 * 被 dev.mjs / restart-core.mjs / stop.mjs 共用，避免三份口径漂移。
 *
 * 背景（血泪史）：
 *   1. 判定 node 进程**不能**用 `ProcessName !== 'node.exe'`。PowerShell 的
 *      `(Get-Process).ProcessName` 返回的是 `node`（不带扩展名），只有 CIM 的
 *      `Win32_Process.Name` 才带 `.exe`。历史实现两处混用，导致 `isProjectProcess()`
 *      恒为 false、`killPort()` 静默失效。
 *   2. 只按端口清理是不够的：绑不上端口的「幽灵」agent-core（EADDRINUSE 被 app.js
 *      的全局 uncaughtException 吞掉，进程照活）不占端口，扫不到；遗留的 nodemon
 *      监督进程也不占端口，但它会在下次保存源码时再拉起一份新实例。
 *      → 必须按「进程名 + 命令行关键字」全量清扫，且**先杀监督进程再杀服务进程**。
 *   3. 清扫**绝不能杀掉自己或自己的祖先**。`npm run dev` 的树是
 *      `node npm-cli.js run dev` → `cmd.exe` → `node scripts/dev.mjs`，`process.ppid`
 *      只能拿到中间的 cmd.exe，于是 npm-cli.js 漏网；而 taskkill /T 杀整棵树，
 *      结果 dev.mjs 把自己和启动它的 npm 一起干掉（表现为清完直接退回提示符）。
 *      → 见 getAncestorPids()：读全量进程表建立 pid→ppid 映射，往上走整条链。
 *
 * 为什么这些幽灵要命：所有 scheduler（含 momentScheduler）都在 app.listen 之前启动，
 * 幽灵照样跑全套定时任务；多个实例共享同一个 SQLite 库时，朋友圈会重复发帖
 * （「选候选 + 改 next_moment_at」不是原子操作，跨进程会重复认领同一角色）。
 */

import { execSync } from 'child_process';
import os from 'os';

export const isWindows = os.platform() === 'win32';

/** 全量关键字：涵盖本项目全部服务（dev / stop 用） */
export const ALL_KEYWORDS = [
  'generate-image-agent', 'agent-core', 'vector-service', 'web-ui',
  'app.js', 'server:app', 'vite', 'uvicorn',
  'nodemon', 'run dev', 'restart-core',
];

/**
 * 只针对 agent-core 的关键字（restart-core 用）。
 * 注意：不含 'generate-image-agent' / 'web-ui' / 'vite' / 'uvicorn'，
 * 否则会把同项目下 vite、vector-service 的绝对路径一起命中并误杀。
 */
export const AGENT_CORE_KEYWORDS = ['agent-core', 'app.js', 'nodemon'];

export const DEV_PORTS = [3099, 5173, 8765];

function exec(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/**
 * 当前进程的**整条祖先链**（含中间的 shell），清扫时全部排除 —— 绝不自杀。
 *
 * 为什么不能用 process.ppid：
 *   `npm run dev` 的进程树是
 *     node npm-cli.js run dev  →  cmd.exe /d /s /c  →  node scripts/dev.mjs
 *   中间的 cmd.exe 不是 node/python，`process.ppid` 只拿到它，于是 npm-cli.js
 *   这个「真正该保留的父进程」不在排除名单里；而 `taskkill /T` 是杀整棵树，
 *   结果 dev.mjs 把自己连同启动它的 npm 一起干掉，表现为「清完直接退回提示符」。
 *
 * 所以这里读**全量**进程表（不按名字过滤，才能穿过 cmd.exe 这类中间层）建立
 * pid → ppid 映射，再从自己往上走，收集所有祖先 PID。
 */
let _ancestorPids = null;
export function getAncestorPids() {
  if (_ancestorPids) return _ancestorPids;
  const set = new Set([process.pid]);

  if (isWindows) {
    try {
      const ps = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; '
        + '@(Get-CimInstance Win32_Process '
        + '| Select-Object ProcessId,ParentProcessId '
        + '| ConvertTo-Json -Compress -Depth 2)';
      const raw = exec(`powershell -NoProfile -Command "${ps}"`).trim();
      let parsed = JSON.parse(raw || '[]');
      if (!Array.isArray(parsed)) parsed = [parsed]; // 单条结果会退化成对象
      const parentOf = new Map();
      for (const p of parsed) {
        if (p && p.ProcessId != null) parentOf.set(Number(p.ProcessId), Number(p.ParentProcessId));
      }
      let cur = Number(process.pid);
      for (let i = 0; i < 64; i++) {
        const par = parentOf.get(cur);
        if (!par || par === 0 || set.has(par)) break;
        set.add(par);
        cur = par;
      }
    } catch { /* 读不到就只保护自身与直接父进程 */ }
  }

  // 非 Windows 或上面的读取失败：至少把直接父进程补进来
  if (process.ppid && !set.has(Number(process.ppid))) set.add(Number(process.ppid));

  _ancestorPids = set;
  return set;
}

/** 该 PID 是否属于「自己或自己的祖先」——命中即必须跳过 */
export function isSelfOrAncestor(pid) {
  return getAncestorPids().has(Number(pid));
}

export function toLc(v) {
  return String(v || '').toLowerCase();
}

/** node / python 判定：PowerShell 的 ProcessName 不带 .exe，CIM 的 Name 带，两边都要吃 */
export function isNodeOrPython(name) {
  const n = toLc(name).replace(/\.exe$/, '');
  return n === 'node' || n === 'python';
}

/** 「监督进程」（npm / nodemon 包装层）——必须先杀，否则杀了子进程它又会拉起来 */
export function isSupervisor(cmd) {
  const c = toLc(cmd);
  return c.includes('nodemon') || c.includes('npm-cli.js') || c.includes('npx-cli.js')
    || c.includes('run dev') || c.includes('restart-core');
}

export function label(pid, cmd) {
  return `PID ${pid}  ${String(cmd || '').replace(/\s+/g, ' ').trim().slice(0, 110)}`;
}

export function getProcessName(pid) {
  try {
    return toLc(exec(`powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName"`).trim());
  } catch {
    return '';
  }
}

export function killPid(pid, tree = true) {
  try {
    exec(`taskkill /PID ${pid}${tree ? ' /T' : ''} /F`);
    return true;
  } catch {
    return false;
  }
}

/** 某端口全部 LISTENING 的 PID（同一个端口可能有多个监听者，不能只取第一行） */
export function listeningPids(port) {
  if (!isWindows) {
    try {
      return exec(`lsof -ti tcp:${port}`).trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
  try {
    const out = exec(`netstat -ano | findstr :${port}`);
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

/** 项目进程判定：进程名必须是 node / python，且命令行命中任一关键字 */
function matches(proc, keywords, excludePatterns) {
  if (!isNodeOrPython(proc && proc.Name)) return false;
  const cmd = toLc(proc && proc.CommandLine);
  if (!cmd) return false;
  if (isSelfOrAncestor(proc.ProcessId)) return false; // 自己 + 整条祖先链，绝不自杀
  if (excludePatterns.some((p) => cmd.includes(toLc(p)))) return false;
  return keywords.some((k) => cmd.includes(toLc(k)));
}

/**
 * 列出本项目进程。Windows 走 PowerShell CIM（wmic 已被微软弃用，长命令行还会折行）。
 * @returns {Array|null} null 表示进程表读不到，调用方应降级为端口兜底
 */
export function listProjectProcesses({ keywords = ALL_KEYWORDS, excludePatterns = [] } = {}) {
  if (!isWindows) {
    try {
      const out = exec('ps -eo pid=,comm=,args=');
      return out.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const m = line.match(/^(\d+)\s+(\S+)\s+(.*)$/);
        if (!m) return null;
        return { ProcessId: Number(m[1]), Name: m[2], CommandLine: m[3] };
      }).filter((p) => p && matches(p, keywords, excludePatterns));
    } catch {
      return null;
    }
  }

  const ps = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; '
    + '@(Get-CimInstance Win32_Process '
    + "| Where-Object { $_.Name -eq 'node.exe' -or $_.Name -eq 'python.exe' } "
    + '| Select-Object ProcessId,ParentProcessId,Name,CommandLine '
    + '| ConvertTo-Json -Compress -Depth 3)';

  let parsed;
  try {
    const raw = exec(`powershell -NoProfile -Command "${ps}"`).trim();
    parsed = JSON.parse(raw || '[]');
  } catch {
    return null;
  }
  // 只有一条结果时 ConvertTo-Json 会退化成对象而不是数组
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.filter((p) => p && p.ProcessId && matches(p, keywords, excludePatterns));
}

/**
 * 全量清扫本项目残留进程 + 按端口兜底。
 *
 * @param {object}  [opts]
 * @param {string[]} [opts.keywords]        识别关键字，默认全量
 * @param {number[]} [opts.ports]           兜底端口，默认 3099/5173/8765；传 [] 跳过
 * @param {string[]} [opts.excludePatterns] 命令行额外排除（各脚本排自己）
 * @param {boolean}  [opts.dryRun]          只打印不执行
 * @param {string}   [opts.prefix]          输出行前缀
 * @param {Function} [opts.log]
 * @returns {{scanned:number, killed:number, leftover:Array|null, tableReadable:boolean}}
 */
export function cleanupProjectProcesses(opts = {}) {
  const {
    keywords = ALL_KEYWORDS,
    ports = DEV_PORTS,
    excludePatterns = [],
    dryRun = false,
    prefix = '  ',
    log = console.log,
  } = opts;

  const result = { scanned: 0, killed: 0, leftover: [], tableReadable: true };
  const procs = listProjectProcesses({ keywords, excludePatterns });

  if (procs === null) {
    result.tableReadable = false;
    log(`${prefix}无法读取进程表，跳过全量清扫（降级为端口兜底）`);
  } else {
    result.scanned = procs.length;
    if (procs.length === 0) {
      log(`${prefix}未发现运行中的本项目进程`);
    } else {
      log(`${prefix}发现 ${procs.length} 个本项目进程：`);
      for (const p of procs) log(`${prefix}  ${label(p.ProcessId, p.CommandLine)}`);

      // 监督进程优先，防止杀了子进程后它又把服务拉起来
      const ordered = [...procs].sort((a, b) => (isSupervisor(b.CommandLine) ? 1 : 0) - (isSupervisor(a.CommandLine) ? 1 : 0));
      if (dryRun) {
        log(`${prefix}(dry-run：以下为清理顺序，未执行)`);
        for (const p of ordered) {
          log(`${prefix}  [${isSupervisor(p.CommandLine) ? '监督' : '服务'}] ${label(p.ProcessId, p.CommandLine)}`);
        }
      } else {
        log(`${prefix}开始清理…`);
        for (const p of ordered) {
          const kind = isSupervisor(p.CommandLine) ? '监督进程' : '服务进程';
          if (killPid(p.ProcessId, true)) {
            result.killed++;
            log(`${prefix}已杀${kind} ${label(p.ProcessId, p.CommandLine)}`);
          } else {
            log(`${prefix}跳过${kind} ${label(p.ProcessId, p.CommandLine)}（已退出或无权限）`);
          }
        }
      }
    }
  }

  // 端口兜底：只杀 node / python，其他应用一律放行（并提示是哪个应用占了端口）
  for (const port of ports) {
    const pids = listeningPids(port);
    if (pids.length === 0) {
      log(`${prefix}端口 ${port} — 未占用`);
      continue;
    }
    for (const pid of pids) {
      if (isSelfOrAncestor(pid)) {
        log(`${prefix}端口 ${port} — PID ${pid} 是本进程或其祖先，跳过`);
        continue;
      }
      const name = isWindows ? getProcessName(pid) : '';
      if (isWindows && !isNodeOrPython(name)) {
        log(`${prefix}端口 ${port} — PID ${pid} (${name || '未知进程'}) 非本项目进程，跳过`);
        continue;
      }
      if (dryRun) {
        log(`${prefix}端口 ${port} — 待杀 PID ${pid} (dry-run)`);
        continue;
      }
      if (killPid(pid)) {
        result.killed++;
        log(`${prefix}端口 ${port} — 已杀掉 PID ${pid}`);
      } else {
        log(`${prefix}端口 ${port} — PID ${pid} 已退出`);
      }
    }
  }

  if (!dryRun) {
    result.leftover = listProjectProcesses({ keywords, excludePatterns });
  }
  return result;
}
