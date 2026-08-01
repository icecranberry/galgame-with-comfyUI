/**
 * build-apk.mjs — 构建安卓 APK 壳
 *
 *   $ npm run apk          # 单独构建，失败时退出码非 0
 *
 * 也被 build-release.mjs 作为模块调用（buildApk()，失败返回 null 不抛异常）。
 *
 * 工具链（JDK 17 / Gradle / Android SDK）自动下载到
 * launcher/build_cache/android-toolchain/ —— 仅构建缓存，不进发布包。
 */

import { spawn } from "node:child_process";
import {
  existsSync, mkdirSync, rmSync, createWriteStream,
  readdirSync, renameSync, readFileSync, writeFileSync, statSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import https from "node:https";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const ANDROID_DIR = resolve(ROOT, "android-shell");
const CACHE_DIR = resolve(ROOT, "launcher", "build_cache");
const TOOLCHAIN = resolve(CACHE_DIR, "android-toolchain");
const APP_BUILD_FILE = resolve(ANDROID_DIR, "app", "build.gradle.kts");

const GRADLE_VER = "8.7";

/** 读取 Android 构建配置中的应用版本名，作为 APK 发布文件名的唯一版本来源。 */
export function getAndroidVersionName() {
  const buildConfig = readFileSync(APP_BUILD_FILE, "utf8");
  const match = buildConfig.match(/\bversionName\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`未在 ${APP_BUILD_FILE} 中找到 versionName`);
  }
  return match[1];
}

// ── 终端颜色 ──
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

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function downloadFile(url, dest, timeoutSec = 600) {
  return new Promise((resolvePromise) => {
    const proto = url.startsWith("https") ? https : http;
    const req = proto.get(url, { timeout: timeoutSec * 1000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolvePromise(downloadFile(res.headers.location, dest, timeoutSec));
      }
      if (res.statusCode !== 200) {
        req.destroy();
        return resolvePromise(false);
      }
      const file = createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => { file.close(); resolvePromise(true); });
      file.on("error", () => resolvePromise(false));
    });
    req.on("error", () => resolvePromise(false));
    req.on("timeout", () => { req.destroy(); resolvePromise(false); });
  });
}

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
    let timeoutId = null;
    if (opts.timeout) {
      timeoutId = setTimeout(() => {
        child.kill();
        resolvePromise({ ok: false, stdout, stderr, code: -1, killed: true });
      }, opts.timeout);
    }

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
      if (timeoutId) clearTimeout(timeoutId);
      resolvePromise({ ok: code === 0, stdout, stderr, code });
    });
    child.on("error", (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolvePromise({ ok: false, stdout, stderr: err.message, code: -1 });
    });
  });
}

function extractZip(zipPath, destDir) {
  return exec("powershell", [
    "-NoProfile", "-Command",
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`
  ]);
}

// 多候选 URL 下载；失败时清掉半截文件，避免残缺缓存导致后续构建永久失败
async function fetchFirst(urls, dest) {
  for (const u of urls) {
    log(`  下载 ${u.split("/").pop()}...`);
    if (await downloadFile(u, dest)) return true;
    warn(`  下载失败: ${u}`);
    try { rmSync(dest, { force: true }); } catch {}
  }
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Windows 上刚解压完的目录可能被杀软/索引器短暂占用导致 rename EPERM，
// 重试数次后回退到 robocopy /MOVE
async function renameWithRetry(src, dest, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      renameSync(src, dest);
      return true;
    } catch {
      await sleep(1000 * (i + 1));
    }
  }
  const r = await exec("robocopy", [src, dest, "/E", "/MOVE", "/NFL", "/NDL", "/NJH", "/NJS"]);
  return r.code < 8 && existsSync(dest);
}

// 解压 zip；若只有一个顶层目录则将其挪为 target（zip 内目录名不可预测）
async function extractInto(zip, target) {
  const tmp = resolve(TOOLCHAIN, "_extract_tmp");
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  ensureDir(tmp);
  const r = await extractZip(zip, tmp);
  if (!r.ok) {
    // zip 大概率已损坏（如上次下载中断的残留），删掉让下次重新下载
    try { rmSync(zip, { force: true }); } catch {}
    return false;
  }
  try {
    const entries = readdirSync(tmp);
    if (entries.length === 1) {
      if (!(await renameWithRetry(resolve(tmp, entries[0]), target))) return false;
      rmSync(tmp, { recursive: true, force: true });
    } else {
      if (!(await renameWithRetry(tmp, target))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 构建 APK。成功返回 APK 绝对路径，失败返回 null（只 warn 不抛异常）。
 */
export async function buildApk() {
  if (!existsSync(resolve(ANDROID_DIR, "settings.gradle.kts"))) {
    warn("未找到 android-shell/ 项目，跳过 APK 构建");
    return null;
  }

  ensureDir(CACHE_DIR);
  ensureDir(TOOLCHAIN);

  // ── 便携 JDK 17 ──
  const JDK_DIR = resolve(TOOLCHAIN, "jdk17");
  if (!existsSync(resolve(JDK_DIR, "bin", "java.exe"))) {
    const jdkZip = resolve(CACHE_DIR, "openjdk17-win-x64.zip");
    if (!existsSync(jdkZip)) {
      const okDl = await fetchFirst([
        "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.11_9.zip",
        "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.11%2B9/OpenJDK17U-jdk_x64_windows_hotspot_17.0.11_9.zip",
      ], jdkZip);
      if (!okDl) { warn("JDK 下载失败"); return null; }
    }
    log("  解压 JDK...");
    if (existsSync(JDK_DIR)) rmSync(JDK_DIR, { recursive: true, force: true });
    if (!(await extractInto(jdkZip, JDK_DIR))) { warn("JDK 解压失败"); return null; }
  }
  ok("JDK 17 就绪");

  // ── 便携 Gradle ──
  const GRADLE_DIR = resolve(TOOLCHAIN, `gradle-${GRADLE_VER}`);
  if (!existsSync(resolve(GRADLE_DIR, "bin", "gradle.bat"))) {
    const gradleZip = resolve(CACHE_DIR, `gradle-${GRADLE_VER}-bin.zip`);
    if (!existsSync(gradleZip)) {
      const okDl = await fetchFirst([
        `https://mirrors.cloud.tencent.com/gradle/gradle-${GRADLE_VER}-bin.zip`,
        `https://services.gradle.org/distributions/gradle-${GRADLE_VER}-bin.zip`,
      ], gradleZip);
      if (!okDl) { warn("Gradle 下载失败"); return null; }
    }
    log("  解压 Gradle...");
    if (existsSync(GRADLE_DIR)) rmSync(GRADLE_DIR, { recursive: true, force: true });
    if (!(await extractInto(gradleZip, GRADLE_DIR))) { warn("Gradle 解压失败"); return null; }
  }
  ok(`Gradle ${GRADLE_VER} 就绪`);

  // ── Android SDK（直接下载组件包，绕过 sdkmanager 交互式 license）──
  const SDK_DIR = resolve(TOOLCHAIN, "sdk");

  // platforms/android-34
  const platDir = resolve(SDK_DIR, "platforms", "android-34");
  if (!existsSync(platDir)) {
    const platZip = resolve(CACHE_DIR, "android-platform-34.zip");
    if (!existsSync(platZip)) {
      const okDl = await fetchFirst([
        "https://dl.google.com/android/repository/platform-34-ext7_r03.zip",
        "https://mirrors.cloud.tencent.com/AndroidSDK/platform-34-ext7_r03.zip",
        "https://dl.google.com/android/repository/platform-34_r02.zip",
        "https://dl.google.com/android/repository/platform-34_r01.zip",
      ], platZip);
      if (!okDl) { warn("Android platform-34 下载失败"); return null; }
    }
    log("  解压 platform-34...");
    ensureDir(resolve(SDK_DIR, "platforms"));
    if (!(await extractInto(platZip, platDir))) { warn("platform-34 解压失败"); return null; }
  }

  // build-tools/34.0.0
  const btDir = resolve(SDK_DIR, "build-tools", "34.0.0");
  if (!existsSync(btDir)) {
    const btZip = resolve(CACHE_DIR, "android-build-tools-34.zip");
    if (!existsSync(btZip)) {
      const okDl = await fetchFirst([
        "https://dl.google.com/android/repository/build-tools_r34-windows.zip",
        "https://mirrors.cloud.tencent.com/AndroidSDK/build-tools_r34-windows.zip",
      ], btZip);
      if (!okDl) { warn("build-tools 下载失败"); return null; }
    }
    log("  解压 build-tools...");
    ensureDir(resolve(SDK_DIR, "build-tools"));
    if (!(await extractInto(btZip, btDir))) { warn("build-tools 解压失败"); return null; }
  }

  // platform-tools（构建通常不需要，失败不阻塞）
  const ptDir = resolve(SDK_DIR, "platform-tools");
  if (!existsSync(ptDir)) {
    const ptZip = resolve(CACHE_DIR, "android-platform-tools.zip");
    if (!existsSync(ptZip)) {
      const okDl = await fetchFirst([
        "https://dl.google.com/android/repository/platform-tools-latest-windows.zip",
        "https://mirrors.cloud.tencent.com/AndroidSDK/platform-tools-latest-windows.zip",
      ], ptZip);
      if (!okDl) warn("platform-tools 下载失败（构建 APK 通常不需要，继续）");
    }
    if (existsSync(ptZip)) await extractInto(ptZip, ptDir);
  }

  // licenses（AGP 缺组件时自动补装需要）
  const licDir = resolve(SDK_DIR, "licenses");
  ensureDir(licDir);
  writeFileSync(resolve(licDir, "android-sdk-license"),
    "\n8933bad161af4178b1185d1a37fbf41ea5269c55" +
    "\nd56f5187479451eabf01fb78af6dfcb131a6481e" +
    "\n24333f8a63b6825ea9c5514f83c2829b004d1fee\n", "ascii");
  writeFileSync(resolve(licDir, "android-sdk-preview-license"),
    "\n84831b9409646a918e30573bab4c9c91346d8abd\n", "ascii");
  ok("Android SDK 就绪");

  // local.properties 指向便携 SDK
  writeFileSync(resolve(ANDROID_DIR, "local.properties"),
    `sdk.dir=${SDK_DIR.replace(/\\/g, "\\\\")}\n`, "utf-8");

  // 应用图标同步已下沉到 gradle 的 syncAppIcon 任务（app/build.gradle.kts），
  // npm run apk 与 Android Studio 两条构建路径均自动生效

  // ── gradle assembleRelease ──
  log("  gradle assembleRelease（首次构建需下载依赖，约 5-20 分钟）...");
  const r = await exec(resolve(GRADLE_DIR, "bin", "gradle.bat"), ["assembleRelease", "--no-daemon"], {
    cwd: ANDROID_DIR,
    print: true,
    timeout: 1800000,
    env: {
      JAVA_HOME: JDK_DIR,
      ANDROID_HOME: SDK_DIR,
      ANDROID_SDK_ROOT: SDK_DIR,
      GRADLE_USER_HOME: resolve(TOOLCHAIN, "gradle-home"),
    },
  });
  if (!r.ok) { warn(`APK 构建失败 (exit: ${r.code})`); return null; }

  const apk = resolve(ANDROID_DIR, "app", "build", "outputs", "apk", "release", "app-release.apk");
  if (!existsSync(apk)) {
    warn("gradle 构建成功但未找到 app-release.apk");
    return null;
  }
  ok("APK 构建完成");
  return apk;
}

// ── CLI 入口 ──
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log();
  console.log(`  ${C.bold}邻舍 — 安卓 APK 壳构建${C.reset}`);
  console.log(`  ${C.dim}${"=".repeat(50)}${C.reset}`);
  console.log();

  const apk = await buildApk();
  if (!apk) {
    fail("APK 构建失败");
    process.exit(1);
  }

  const sizeMB = (statSync(apk).size / (1024 * 1024)).toFixed(1);
  console.log();
  console.log(`  ${C.bold}✨ APK 构建完成!${C.reset}`);
  console.log(`  输出: ${apk}`);
  console.log(`  体积: ~${sizeMB} MB`);
  console.log(`  ${C.dim}提示: npm run release 会自动将 APK 打入发布压缩包${C.reset}`);
  console.log();
}
