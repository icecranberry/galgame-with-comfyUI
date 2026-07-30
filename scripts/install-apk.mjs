/**
 * install-apk.mjs — 构建 APK 并通过 adb 安装到手机
 *
 *   $ npm run install-apk         # 构建 + 安装
 *   $ npm run install-apk -- -n   # 跳过构建，直接 adb 安装已有 APK
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const ANDROID_DIR = resolve(ROOT, "android-shell");
const APK = resolve(ANDROID_DIR, "app", "build", "outputs", "apk", "release", "app-release.apk");

const C = {
  reset: "\x1b[0m",
  dim:   "\x1b[2m",
  green: "\x1b[32m",
  yellow:"\x1b[33m",
  red:   "\x1b[31m",
  bold:  "\x1b[1m",
};

function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ${C.green}✓ ${msg}${C.reset}`); }
function warn(msg) { console.log(`  ${C.yellow}[WARN] ${msg}${C.reset}`); }
function fail(msg) { console.error(`  ${C.red}[ERROR] ${msg}${C.reset}`); }

function exec(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
      ...opts,
      env: { ...process.env, ...(opts.env || {}) },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { const text = d.toString(); stdout += text; if (opts.print) process.stdout.write(text); });
    child.stderr.on("data", (d) => { const text = d.toString(); stderr += text; if (opts.print) process.stderr.write(text); });

    child.on("exit", (code) => resolvePromise({ ok: code === 0, stdout, stderr, code }));
    child.on("error", (err) => resolvePromise({ ok: false, stdout, stderr: err.message, code: -1 }));
  });
}

async function checkAdb() {
  const r = await exec("adb", ["devices"]);
  if (!r.ok) {
    fail("adb 未找到，请确保 Android SDK platform-tools 已安装并加入 PATH");
    return null;
  }
  // 检查是否有已连接的设备
  const lines = r.stdout.split("\n").filter(l => l.trim());
  const devices = lines.slice(1).filter(l => l.trim() && !l.startsWith("*"));
  if (devices.length === 0) {
    fail("没有检测到已连接的设备，请连接手机并开启 USB 调试");
    log('  手机需开启"开发者选项"→"USB 调试"');
    return null;
  }
  ok(`已连接设备: ${devices.map(d => d.split("\t")[0]).join(", ")}`);
  return true;
}

async function installApk(apkPath) {
  log("正在安装 APK...");
  const r = await exec("adb", ["install", "-r", apkPath], { print: true });
  if (r.ok) {
    ok("APK 安装成功!");
    return true;
  }
  // adb install 失败时尝试检查常见问题
  if (r.stdout.includes("INSTALL_FAILED_UPDATE_INCOMPATIBLE") || r.stderr.includes("INSTALL_FAILED_UPDATE_INCOMPATIBLE")) {
    warn("签名不一致，需要先卸载旧版本");
    log("  尝试卸载...");
    const uninstall = await exec("adb", ["uninstall", "com.linshe.shell"]);
    if (uninstall.ok) {
      log("  卸载成功，重新安装...");
      const retry = await exec("adb", ["install", "-r", apkPath], { print: true });
      if (retry.ok) {
        ok("APK 安装成功!");
        return true;
      }
    }
  }
  fail("APK 安装失败");
  return false;
}

// ── CLI 入口 ──
const args = process.argv.slice(2);
const noBuild = args.includes("-n");

console.log();
console.log(`  ${C.bold}邻舍 — APK 安装${C.reset}`);
console.log(`  ${C.dim}${"=".repeat(50)}${C.reset}`);
console.log();

// 1. 检查 adb
const adbOk = await checkAdb();
if (!adbOk) process.exit(1);

// 2. 构建 APK（除非 -n）
let apkPath = APK;
if (!noBuild) {
  console.log();
  // 动态导入 build-apk.mjs 中的 buildApk
  const { buildApk } = await import("./build-apk.mjs");
  const built = await buildApk();
  if (!built) {
    fail("APK 构建失败");
    process.exit(1);
  }
  apkPath = built;
} else {
  if (!existsSync(APK)) {
    fail(`未找到 APK 文件: ${APK}`);
    log("  请先执行 npm run apk 构建，或去掉 -n 参数自动构建");
    process.exit(1);
  }
  const sizeMB = (statSync(APK).size / (1024 * 1024)).toFixed(1);
  ok(`使用已有 APK (${sizeMB} MB)`);
}

// 3. 安装
console.log();
const installed = await installApk(apkPath);
if (!installed) process.exit(1);

console.log();
console.log(`  ${C.bold}🎉 完成! APK 已安装到手机${C.reset}`);
console.log();
