/**
 * dev.mjs — 一键启动全部开发服务
 *
 *   $ npm run dev   (在项目根目录)
 *
 * 启动流程:
 *   1. 清理端口占用 (3099, 8765, 5173)
 *   2. 检查 Node.js / Python 环境
 *   3. vector-service  (:8765) — Python uvicorn
 *   4. agent-core       (:3099) — Express (node --watch)
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

// ── 端口清理（带进程身份验证，防止误杀其他应用）──
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
  // 第一层：只检查 node.exe / python.exe —— 其他进程（如京东金融等原生应用）直接放行
  const name = getProcessName(pid).toLowerCase();
  if (!name || (name !== "node.exe" && name !== "python.exe")) {
    return false;
  }

  // 第二层：检查命令行是否包含项目路径/关键字
  try {
    const cmdLine = execSync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
      { encoding: "utf8", windowsHide: true, stdio: ["pipe","pipe","pipe"] }
    ).trim();

    const lower = cmdLine.toLowerCase();
    return PROJECT_KEYWORDS.some((kw) => lower.includes(kw));
  } catch {
    // 无法获取命令行 → 保守处理，不杀
    return false;
  }
}

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

      let killedCount = 0;
      for (const pid of seen) {
        if (isProjectProcess(pid)) {
          execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: "ignore" });
          killedCount++;
          console.log(`        ${C.dim}Killed old project process (PID ${pid}) on port ${port}${C.reset}`);
        } else {
          const procName = getProcessName(pid) || `PID ${pid}`;
          console.log(
            `\n        ${C.yellow}[WARN] Port ${port} occupied by "${procName}" (PID ${pid}) — not killing${C.reset}`
          );
          console.log(
            `        ${C.yellow}       This is NOT a project process. Check your running applications.${C.reset}`
          );
        }
      }
      return killedCount > 0;
    } else {
      execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { stdio: "ignore" });
      return true;
    }
  } catch { return false; }
}

// ── 嵌入模型检测 & 自动下载 ──
const MODEL_ONNX = resolve(ROOT, "vector-service", "models", "jina-embeddings-v2-base-zh", "onnx", "model_int8.onnx");

function checkModel() {
  return existsSync(MODEL_ONNX);
}

function downloadModelBg() {
  return new Promise((resolvePromise) => {
    const venvPy = resolve(ROOT, "vector-service", "venv", "Scripts", "python.exe");
    const python = existsSync(venvPy) ? venvPy : "python";
    const script = resolve(ROOT, "vector-service", "download_model.py");

    console.log(`        ${C.yellow}模型缺失，后台自动下载 (~155MB, hf-mirror.com)...${C.reset}`);

    const child = spawn(python, [script], {
      cwd: resolve(ROOT, "vector-service"),
      stdio: "pipe",
      windowsHide: true,
      shell: process.platform === "win32",
    });

    // 把下载进度输出到控制台
    child.stdout.on("data", (d) => process.stdout.write(`        ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`        ${d}`));

    child.on("exit", (code) => {
      const ok = code === 0 && checkModel();
      if (ok) {
        console.log(`        ${C.green}[OK] 模型下载完成${C.reset}`);
      } else {
        console.log(`        ${C.red}[FAIL] 模型下载失败 (code ${code})，vector-service 将跳过${C.reset}`);
      }
      resolvePromise(ok);
    });
  });
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

// ── 启动单个服务（返回是否就绪）──
async function startService(svc) {
  const child = spawn(svc.getCmd(), svc.args, {
    cwd: svc.cwd,
    stdio: "pipe",
    windowsHide: true,
    shell: process.platform === "win32",
  });

  children.add(child);

  child.stdout.on("data", (d) => process.stdout.write(`${tag(svc.name)} ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`${tag(svc.name)} ${d}`));

  child.on("exit", (code) => {
    children.delete(child);
    if (code !== null && code !== 0 && code !== 143 && code !== 1) {
      console.log(`${tag(svc.name)} ${C.red}exited (code ${code})${C.reset}`);
    }
  });

  return waitFor(svc.url, child);
}

// ── 子进程管理 ──
const children = new Set();

async function shutdown() {
  if (shutdown._called) return;
  shutdown._called = true;
  console.log(`\n${C.yellow}Shutting down all services...${C.reset}`);

  // ── Windows: 先请求 agent-core 优雅退出（防止 SQLite WAL 损坏）──
  if (process.platform === "win32") {
    try {
      await fetch("http://localhost:3099/api/shutdown", {
        method: "POST",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // 可能已经挂了，无视
    }
    // 给 agent-core 时间关 HTTP 服务 → closeDb → exit
    await new Promise((r) => setTimeout(r, 5000));
  }

  // ── 强制清理残留进程 ──
  for (const c of children) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${c.pid}`, { windowsHide: true, stdio: "ignore" });
      } else {
        c.kill("SIGTERM");
      }
    } catch {}
  }
  setTimeout(() => process.exit(0), 1000);
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
  killPort(3099);
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
      port: 3099,
      url: "http://localhost:3099/api/health",
      cwd: resolve(ROOT, "agent-core"),
      getCmd() { return "npx"; },
      args: ["nodemon", "--watch", "src", "--watch", "app.js", "-e", "js,json", "app.js"],
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

  // [2/4] 模型检测（后台下载，不阻塞）
  const modelReady = checkModel()
    ? Promise.resolve(true)
    : downloadModelBg();

  // [3/4], [4/4] 并行启动 agent-core + web-ui
  const coreSvcs = services.slice(1); // agent-core, web-ui
  const corePromises = coreSvcs.map((svc) => {
    const step = svc.name === "agent-core" ? 3 : 4;
    process.stdout.write(`  [${step}/4] Starting ${svc.name} (:${svc.port})...`);
    return startService(svc).then(ok =>
      console.log(ok ? ` ${C.green}OK${C.reset}` : ` ${C.yellow}timeout — continuing${C.reset}`));
  });

  // vector-service: 等模型就绪后再启动
  const vectorSvc = services[0];
  modelReady.then(async (ok) => {
    if (!ok) {
      console.log(`  [2/4] ${C.red}vector-service SKIPPED (模型缺失)${C.reset}`);
      return;
    }
    process.stdout.write(`  [2/4] Starting vector-service (:${vectorSvc.port})...`);
    const started = await startService(vectorSvc);
    console.log(started ? ` ${C.green}OK${C.reset}` : ` ${C.yellow}timeout — continuing${C.reset}`);
  });

  // 等 agent-core + web-ui 就绪
  await Promise.all(corePromises);
  // 等 vector-service 就绪（如果模型需要下载，这里会等下载完成 + 启动）
  await modelReady;

  console.log();
  console.log(`  ${C.bold}${"=".repeat(40)}${C.reset}`);
  console.log(`  ${C.bold}All services running!${C.reset}`);
  console.log();
  console.log(`    Web UI:  ${C.cyan}http://localhost:5173${C.reset}  (Vite HMR)`);
  console.log(`    API:     ${C.cyan}http://localhost:3099${C.reset}   (Express)`);
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
