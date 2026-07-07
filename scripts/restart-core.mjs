/**
 * restart-core.mjs — 单独重启 agent-core
 *
 *   $ npm run restart-core   (在项目根目录)
 *
 * 流程:
 *   1. 端口清理 (3099, 含进程身份验证)
 *   2. 优雅退出（先调 /api/shutdown 防 SQLite WAL 损坏）
 *   3. 重新拉起 agent-core (node --watch)
 */

import { spawn, execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const C = {
  reset: "\x1b[0m",
  dim:   "\x1b[2m",
  green: "\x1b[32m",
  yellow:"\x1b[33m",
  cyan:  "\x1b[36m",
  red:   "\x1b[31m",
  bold:  "\x1b[1m",
};

function tag(name) {
  return `${C.dim}[${C.cyan}${name}${C.dim}]${C.reset}`;
}

// ── 端口清理（含进程身份验证，抄自 dev.mjs）──
const PROJECT_KEYWORDS = [
  "generate-image-agent", "agent-core", "vector-service", "web-ui",
  "app.js", "server:app", "vite", "uvicorn",
];

function getProcessName(pid) {
  try {
    return execSync(
      `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName"`,
      { encoding: "utf8", windowsHide: true, stdio: ["pipe","pipe","pipe"] }
    ).trim();
  } catch { return ""; }
}

function isProjectProcess(pid) {
  const name = getProcessName(pid).toLowerCase();
  if (!name || (name !== "node.exe" && name !== "python.exe")) return false;

  try {
    const cmdLine = execSync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
      { encoding: "utf8", windowsHide: true, stdio: ["pipe","pipe","pipe"] }
    ).trim();
    return PROJECT_KEYWORDS.some((kw) => cmdLine.toLowerCase().includes(kw));
  } catch {
    return false;
  }
}

function killPort(port) {
  if (process.platform !== "win32") {
    try {
      execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: "ignore" });
      return true;
    } catch { return false; }
  }

  try {
    const out = execSync(
      `netstat -ano | findstr ":${port} " | findstr "LISTENING"`,
      { encoding: "utf8", windowsHide: true, stdio: ["pipe","pipe","pipe"] }
    ).trim();
    if (!out) return false;

    const seen = new Set();
    for (const line of out.split("\n")) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) seen.add(pid);
    }

    let killed = 0;
    for (const pid of seen) {
      if (isProjectProcess(pid)) {
        execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: "ignore" });
        killed++;
        console.log(`        已杀掉旧进程 (PID ${pid})`);
      } else {
        const procName = getProcessName(pid) || `PID ${pid}`;
        console.log(`        端口 ${port} 被 "${procName}" (PID ${pid}) 占用 — 跳过`);
      }
    }
    return killed > 0;
  } catch { return false; }
}

// ── HTTP 健康检查 ──
async function waitFor(url, child, timeoutSec = 15) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) return false;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// ── 主流程 ──
async function main() {
  console.log();
  console.log(`  ${C.bold}Restart agent-core${C.reset}`);
  console.log(`  ${C.dim}${"=".repeat(40)}${C.reset}`);

  // 1. 杀掉旧进程
  console.log(`\n  [1/3] 清理端口 3099...`);
  const wasRunning = killPort(3099);
  if (!wasRunning) console.log(`        端口 3099 未占用`);

  // 2. 尝试优雅退出（如果还没完全挂）
  try {
    await fetch("http://localhost:3099/api/shutdown", {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* 已经挂了，无视 */ }

  // 等端口彻底释放
  await new Promise(r => setTimeout(r, 2000));

  // 3. 拉起 agent-core
  console.log(`\n  [2/3] 启动 agent-core (:3099)...`);
  const cwd = resolve(ROOT, "agent-core");
  const child = spawn("node", ["--watch", "app.js"], {
    cwd,
    stdio: "pipe",
    windowsHide: true,
    shell: process.platform === "win32",
  });

  child.stdout.on("data", (d) => process.stdout.write(`${tag("agent-core")} ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`${tag("agent-core")} ${d}`));
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && code !== 143) {
      console.log(`\n${tag("agent-core")} ${C.red}exited (code ${code})${C.reset}`);
    }
    process.exit(code || 0);
  });

  // 4. 等待就绪
  console.log(`\n  [3/3] 等待服务就绪...`);
  const ok = await waitFor("http://localhost:3099/api/health", child);
  if (ok) {
    console.log(`  ${C.green}[OK] agent-core 已就绪${C.reset}\n`);
  } else {
    console.log(`  ${C.yellow}超时，进程可能仍在启动中${C.reset}\n`);
  }

  // 父进程退出，agent-core 保持在后台
  process.exit(0);
}

main().catch((err) => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  process.exit(1);
});
