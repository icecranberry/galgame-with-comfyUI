/**
 * restart-core.mjs — 单独重启 agent-core
 *
 *   $ npm run restart-core   (在项目根目录)
 *
 * 流程:
 *   1. 清理 agent-core 残留进程（优雅退出 + 全量清扫 agent-core 相关进程，不碰 vite / vector-service）
 *   2. 重新拉起 agent-core (node --watch)
 *   3. 等待服务就绪
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupProjectProcesses, AGENT_CORE_KEYWORDS } from "./lib/projectProcesses.mjs";

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

  // 1. 清理 agent-core 残留（只动 agent-core，绝不碰 vite / vector-service）
  //    只清端口是不够的：不占端口的「幽灵」node app.js 与遗留在外的 nodemon
  //    监督进程都要清掉，否则监督进程会立刻把服务再拉起来、幽灵会继续跑调度器。
  console.log(`\n  [1/3] 清理 agent-core 残留进程...`);

  // 先尝试优雅退出（占着 3099 的那个进程），避免硬杀导致 SQLite WAL 未落盘
  try {
    await fetch("http://localhost:3099/api/shutdown", {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* 已经挂了，无视 */ }
  await new Promise(r => setTimeout(r, 1500));

  cleanupProjectProcesses({
    keywords: AGENT_CORE_KEYWORDS,
    ports: [3099],
    excludePatterns: ["restart-core.mjs"],
    prefix: "        ",
  });

  // 等端口彻底释放
  await new Promise(r => setTimeout(r, 1000));

  // 2. 拉起 agent-core
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

  // 3. 等待就绪
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
