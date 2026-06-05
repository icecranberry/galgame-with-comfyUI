/**
 * dev.mjs — 一键启动全部开发服务
 *
 *   $ npm run dev   (在项目根目录)
 *
 * 启动流程:
 *   1. 清理端口占用 (3000, 8765, 5173)
 *   2. 检查 Node.js / Python 环境
 *   3. vector-service  (:8765) — Python uvicorn
 *   4. agent-core       (:3000) — Express (node --watch)
 *   5. web-ui           (:5173) — Vite HMR
 *
 * Ctrl+C 一键停止全部子进程。
 */

import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── 终端颜色 ──
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

// ── 端口清理 ──
function killPort(port) {
  try {
    if (process.platform === "win32") {
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
      for (const pid of seen) {
        execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: "ignore" });
      }
      return seen.size > 0;
    } else {
      execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: "ignore" });
      return true;
    }
  } catch { return false; }
}

// ── HTTP 健康检查 ──
async function waitFor(url, child, timeoutSec = 30) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    // 子进程已退出 → 不再等待
    if (child && child.exitCode !== null) return false;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// ── 子进程管理 ──
const children = new Set();

function shutdown() {
  console.log(`\n${C.yellow}Shutting down all services...${C.reset}`);
  for (const c of children) {
    try {
      if (process.platform === "win32") {
        // Windows: taskkill 整个进程树
        execSync(`taskkill /F /T /PID ${c.pid}`, { windowsHide: true, stdio: "ignore" });
      } else {
        c.kill("SIGTERM");
      }
    } catch {}
  }
  setTimeout(() => process.exit(0), 1500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Windows 终端 Ctrl+C → SIGINT 转发
if (process.platform === "win32") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => process.emit("SIGINT", "SIGINT"));
}

// ── 主流程 ──
async function main() {
  console.clear();
  console.log();
  console.log(`  ${C.bold}AI Agent — Dev Mode${C.reset}`);
  console.log(`  ${C.dim}${"=".repeat(40)}${C.reset}`);
  console.log();

  // [0/4] 端口清理
  process.stdout.write(`  [0/4] Cleaning up ports...`);
  killPort(3000);
  killPort(8765);
  killPort(5173);
  console.log(` ${C.green}Done${C.reset}`);

  // [1/4] 环境检查
  console.log(`  [1/4] Checking environment...`);
  let nodeVer, pyVer;
  try {
    nodeVer = execSync("node -v", { encoding: "utf8", windowsHide: true }).trim();
    console.log(`        Node.js: ${nodeVer}`);
  } catch {
    console.error(`  ${C.red}[ERROR] Node.js not found${C.reset}`);
    process.exit(1);
  }
  try {
    pyVer = execSync("python --version", { encoding: "utf8", windowsHide: true }).trim();
    console.log(`        Python:  ${pyVer}`);
  } catch {
    console.error(`  ${C.red}[ERROR] Python not found${C.reset}`);
    process.exit(1);
  }

  // ── 服务定义 ──
  const services = [
    {
      name: "vector-service",
      port: 8765,
      url: "http://localhost:8765/health",
      cwd: resolve(ROOT, "vector-service"),
      getCmd() {
        // 优先使用 venv 里的 python
        const venvPy = resolve(this.cwd, "venv", "Scripts", "python.exe");
        if (existsSync(venvPy)) return venvPy;
        return "python";
      },
      args: ["-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"],
    },
    {
      name: "agent-core",
      port: 3000,
      url: "http://localhost:3000/api/health",
      cwd: resolve(ROOT, "agent-core"),
      getCmd() { return "node"; },
      args: ["--watch", "app.js"],
    },
    {
      name: "web-ui",
      port: 5173,
      url: "http://localhost:5173",
      cwd: resolve(ROOT, "web-ui"),
      getCmd() { return "npx"; },
      args: ["vite", "--host"],
    },
  ];

  // [2/4], [3/4], [4/4] 启动
  for (let i = 0; i < services.length; i++) {
    const svc = services[i];
    const step = i + 2;
    process.stdout.write(`  [${step}/4] Starting ${svc.name} (:${svc.port})...`);

    const child = spawn(svc.getCmd(), svc.args, {
      cwd: svc.cwd,
      stdio: "pipe",
      windowsHide: true,
      shell: process.platform === "win32",
    });

    children.add(child);

    // 将输出重定向到父进程（带上 tag）
    child.stdout.on("data", (d) => process.stdout.write(`${tag(svc.name)} ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`${tag(svc.name)} ${d}`));

    child.on("exit", (code) => {
      children.delete(child);
      if (code !== null && code !== 0 && code !== 143 && code !== 1) {
        console.log(`${tag(svc.name)} ${C.red}exited (code ${code})${C.reset}`);
      }
    });

    const ok = await waitFor(svc.url, child);
    console.log(ok ? ` ${C.green}OK${C.reset}` : ` ${C.yellow}timeout — continuing${C.reset}`);
  }

  console.log();
  console.log(`  ${C.bold}${"=".repeat(40)}${C.reset}`);
  console.log(`  ${C.bold}All services running!${C.reset}`);
  console.log();
  console.log(`    Web UI:  ${C.cyan}http://localhost:5173${C.reset}  (Vite HMR)`);
  console.log(`    API:     ${C.cyan}http://localhost:3000${C.reset}   (Express)`);
  console.log(`    Vector:  ${C.cyan}http://localhost:8765${C.reset}   (FastAPI)`);
  console.log();
  console.log(`  ${C.dim}Press Ctrl+C to stop all services${C.reset}`);
  console.log();

  // 3 秒后自动打开浏览器
  setTimeout(() => {
    const url = "http://localhost:5173";
    try {
      if (process.platform === "win32") {
        execSync(`start "" "${url}"`, { windowsHide: true, stdio: "ignore" });
      } else if (process.platform === "darwin") {
        execSync(`open "${url}"`, { stdio: "ignore" });
      } else {
        execSync(`xdg-open "${url}"`, { stdio: "ignore" });
      }
    } catch {}
  }, 3000);
}

main().catch((err) => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  shutdown();
});
