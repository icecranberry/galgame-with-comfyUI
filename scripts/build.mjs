/**
 * build.mjs — 构建前端 + 打包启动器 EXE
 *
 *   $ node scripts/build.mjs   (或 npm run build)
 *
 * 流程:
 *   1. vite build (web-ui → agent-core/public)
 *   2. PyInstaller 打包 邻舍.EXE
 *   3. 复制 EXE 到项目根目录
 */

import { spawn } from "node:child_process";
import { existsSync, unlinkSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const LAUNCHER_DIR = resolve(ROOT, "launcher");
const WEB_UI = resolve(ROOT, "web-ui");

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

function log(msg) {
  console.log(`  ${msg}`);
}

function ok(msg) {
  console.log(`  ${C.green}✓ ${msg}${C.reset}`);
}

function warn(msg) {
  console.log(`  ${C.yellow}[WARN] ${msg}${C.reset}`);
}

function fail(msg) {
  console.error(`  ${C.red}[ERROR] ${msg}${C.reset}`);
}

/**
 * 执行命令并等待完成
 */
function exec(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
      ...opts,
      env: { ...process.env, FORCE_COLOR: "0", ...(opts.env || {}) },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      const text = d.toString();
      stdout += text;
      if (opts.print) process.stdout.write(text);
    });
    child.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      if (opts.print) process.stderr.write(text);
    });

    child.on("exit", (code) => {
      resolvePromise({ ok: code === 0, stdout, stderr, code });
    });

    child.on("error", (err) => {
      resolvePromise({ ok: false, stdout, stderr: err.message, code: -1 });
    });
  });
}

// ── 主流程 ──

async function main() {
  console.clear();
  console.log();
  console.log(`  ${C.bold}邻舍.EXE — 构建 & 打包${C.reset}`);
  console.log(`  ${C.dim}${"=".repeat(40)}${C.reset}`);
  console.log();

  // ═══════════════════════════════════════════
  // [1/3] vite build
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[1/3]${C.reset} 前端构建 (vite build)...`);

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const buildResult = await exec(npmCmd, ["run", "build"], { cwd: WEB_UI, print: true });
  if (!buildResult.ok) {
    fail("vite build 失败!");
    process.exit(1);
  }
  ok("前端构建完成");

  // ═══════════════════════════════════════════
  // [2/3] PyInstaller 打包
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[2/3]${C.reset} PyInstaller 打包启动器...`);

  // 删除旧 .spec 文件，避免缓存导致 --add-data 不生效
  const specFile = resolve(LAUNCHER_DIR, "邻舍.EXE.spec");
  if (existsSync(specFile)) {
    unlinkSync(specFile);
    log("已删除旧的 .spec 缓存");
  }

  const pyinstallerResult = await exec("pyinstaller", [
    "--onefile", "--windowed",
    "--name", "邻舍.EXE",
    "--icon", "assets/icon.ico",
    "--add-data", "assets/launchHeader.jpg;assets",
    "--add-data", "assets/icon.ico;assets",
    "--add-data", "assets/HarmonyOS_Sans_SC_Regular.ttf;assets",
    "--add-data", "assets/navbar-title.png;assets",
    "--hidden-import", "PySide6.QtCore",
    "--hidden-import", "PySide6.QtGui",
    "--hidden-import", "PySide6.QtWidgets",
    "--hidden-import", "PySide6.QtNetwork",
    "--clean", "--noconfirm",
    "main.py",
  ], { cwd: LAUNCHER_DIR, print: true });

  if (!pyinstallerResult.ok) {
    fail("PyInstaller 打包失败!");
    process.exit(1);
  }
  ok("PyInstaller 打包完成");

  // ═══════════════════════════════════════════
  // [3/3] 复制 EXE
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[3/3]${C.reset} 复制 EXE 到项目根目录...`);

  const exeSrc = resolve(LAUNCHER_DIR, "dist", "邻舍.EXE.exe");
  const exeDst = resolve(ROOT, "邻舍.EXE.exe");

  if (existsSync(exeSrc)) {
    copyFileSync(exeSrc, exeDst);
    ok(`邻舍.EXE.exe → 项目根目录`);
  } else {
    warn("未找到 dist/邻舍.EXE.exe，跳过复制");
  }

  console.log();
  console.log(`  ${C.bold}${C.green}✨ 构建完成${C.reset}`);
  console.log();
}

main().catch((err) => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});
