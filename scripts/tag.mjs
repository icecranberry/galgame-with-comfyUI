/**
 * tag.mjs — 自动打 tag 并推送
 *
 *   $ npm run tag                        # 自动 patch+1，用 commit 注释
 *   $ npm run tag -- v2.0.0              # 手动指定版本
 *   $ npm run tag -- v2.0.0 "重大更新"   # 手动指定版本+注释
 *
 * 流程:
 *   0. 检查更新说明是否变化 → 变化则刷新标志位
 *   1. vite build 打包前端
 *   2. 解析版本号（自动 patch+1 或手动指定）
 *   3. 工作区脏 → 自动提交；工作区干净 → 直接打 tag
 *   4. git fetch → git tag → 分步 push 分支 + tags（含失败重试）
 *
 * 关于更新说明标志位:
 *   web-ui/src/data/changelog.js 里有一行 `export const CHANGELOG_FLAG = '...'`。
 *   本脚本对「该文件除标志位行以外的内容」取哈希，与当前标志位比对，
 *   不一致就改写标志位。前端据此判断：标志位和浏览器里存的不一样 → 弹一次更新说明。
 *   所以想让用户重新看到弹窗，只需要改 changelog.js 的文案，不必手动碰标志位。
 */

import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const C = {
  reset: "\x1b[0m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m",
};

function sh(cmd, opts = {}) {
  try {
    const result = execSync(cmd, {
      cwd: ROOT, encoding: "utf8", windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"], ...opts,
    });
    return result ? result.trim() : "";
  } catch (e) {
    die(`命令执行失败: ${cmd}\n  ${e.stderr?.trim() || e.message}`);
  }
}

function exec(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT, encoding: "utf8", windowsHide: true,
    stdio: "inherit",
  });
  if (result.error) die(`${cmd} 执行失败: ${result.error.message}`);
  if (result.status !== 0) die(`${cmd} 退出码 ${result.status}`);
}

function execShell(cmdStr) {
  try {
    execSync(cmdStr, {
      cwd: ROOT, encoding: "utf8", windowsHide: true,
      stdio: "inherit",
    });
  } catch {
    die(`执行失败: ${cmdStr}`);
  }
}

function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ${C.green}✓ ${msg}${C.reset}`); }
function die(msg)  { console.error(`  [ERROR] ${msg}`); process.exit(1); }

// ── 解析参数 ──

const args = process.argv.slice(2);
let manualVersion = null;
let manualMessage = null;

for (const arg of args) {
  if (arg.startsWith("v") || /^\d/.test(arg)) {
    manualVersion = arg.startsWith("v") ? arg : `v${arg}`;
  } else {
    manualMessage = arg;
  }
}

// ── 0. 更新说明标志位 ──
// 必须早于 vite build（标志位会被打进前端包），也必须早于下面的自动提交（改动要进版本库）。

const CHANGELOG_FILE = resolve(ROOT, "web-ui/src/data/changelog.js");
const CHANGELOG_SKIP = Symbol("skip");
const FLAG_LINE_RE = /^export const CHANGELOG_FLAG = .*$/m;
const FLAG_VALUE_RE = /^export const CHANGELOG_FLAG = ['"]([^'"]*)['"]/m;

console.log();
log("检查更新说明...");

let changelogSource = CHANGELOG_SKIP;
try {
  changelogSource = readFileSync(CHANGELOG_FILE, "utf-8");
} catch {
  log(`${C.dim}未找到 web-ui/src/data/changelog.js，跳过标志位检查${C.reset}`);
}

if (changelogSource !== CHANGELOG_SKIP) {
  // 哈希口径：剔掉标志位行本身，统一换行符、去掉行尾空白。
  // 这样只有文案真的变了才换标志位 —— 编辑器换行风格差异、文件末尾增减空行都不算。
  const content = changelogSource
    .replace(/\r\n/g, "\n")
    .replace(FLAG_LINE_RE, "")
    .replace(/[ \t]+$/gm, "")
    .trim();

  const nextFlag = createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);
  const currentFlag = changelogSource.match(FLAG_VALUE_RE)?.[1] || "";

  if (nextFlag === currentFlag) {
    ok(`更新说明未变化，标志位保持 ${currentFlag}`);
    log(`${C.dim}（本次如果有面向用户的改动，记得往 changelog.js 里补一条）${C.reset}`);
  } else {
    writeFileSync(
      CHANGELOG_FILE,
      changelogSource.replace(FLAG_LINE_RE, `export const CHANGELOG_FLAG = '${nextFlag}'`),
      "utf-8",
    );
    ok(`更新说明有变化，标志位 ${currentFlag || "(空)"} → ${nextFlag}`);
    log(`${C.dim}老用户下次打开会看到更新说明弹窗${C.reset}`);
  }
}

// ── 1. vite build ──

console.log();
log("vite build...");
execShell("cd web-ui && npm run build");
ok("vite build 完成");

// ── 2. 获取最新 tag ──

let latestTag = "";
try {
  latestTag = execSync("git describe --tags --abbrev=0", {
    cwd: ROOT, encoding: "utf8", windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
} catch {
  latestTag = "v0.0.0";
}

const match = latestTag.match(/^v?(\d+)\.(\d+)\.(\d+)/);
let major = 1, minor = 0, patch = 0;
if (match) {
  major = parseInt(match[1]);
  minor = parseInt(match[2]);
  patch = parseInt(match[3]);
}

const newVersion = manualVersion || `v${major}.${minor}.${patch + 1}`;
log(`版本: ${latestTag} → ${C.cyan}${newVersion}${C.reset}`);

// ── 3. 获取注释 ──

const tagMessage = manualMessage || sh("git log -1 --format=%s");
log(`注释: ${tagMessage}`);

// ── 写入 VERSION 文件 ──
const versionWithoutV = newVersion.replace(/^v/, "");
writeFileSync(resolve(ROOT, "VERSION"), versionWithoutV + "\n", "utf-8");
log(`VERSION 文件已更新: ${versionWithoutV}`);

// ── 4. 检查工作区状态 ──

const status = sh("git status --porcelain");
const isDirty = status.length > 0;

if (isDirty) {
  const commitMsg = `【${newVersion}】${tagMessage}`;
  log(`工作区有变更，自动提交: ${commitMsg}`);
  exec("git", ["add", "."]);
  exec("git", ["commit", "-m", commitMsg]);
  ok("提交完成");
} else {
  ok("工作区干净，跳过提交");
}

// ── 5. 拉取远端 tags，避免冲突 ──

log("拉取远端 tags...");
exec("git", ["fetch", "--tags", "--quiet"]);
ok("远端 tags 同步完成");

// ── 6. 打 tag ──

log(`创建 tag: ${newVersion}`);
exec("git", ["tag", "-a", newVersion, "-m", tagMessage]);
ok(`tag ${newVersion} 创建完成`);

// ── 7. 推送（含重试机制） ──

const branch = sh("git rev-parse --abbrev-ref HEAD");

function pushWithRetry(pushArgs, label) {
  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = spawnSync("git", [
        "-c", "http.postBuffer=524288000",
        "push", ...pushArgs,
      ], {
        cwd: ROOT, encoding: "utf8", windowsHide: true,
        stdio: "inherit",
      });
      if (result.status === 0) return;
      throw new Error(`退出码 ${result.status}`);
    } catch (e) {
      if (attempt < maxRetries) {
        const wait = attempt === 1 ? 5 : 10;
        log(`${label} 推送失败 (${e.message})，${wait} 秒后重试...`);
        execSync(`ping -n ${wait} 127.0.0.1 >nul`, { stdio: "ignore" });
      } else {
        die(`${label} 推送失败，已重试 ${maxRetries - 1} 次`);
      }
    }
  }
}

log(`推送分支 ${branch}...`);
pushWithRetry(["origin", branch], "分支");

log("推送 tags...");
pushWithRetry(["origin", "--tags"], "Tags");

ok("推送完成");

console.log();
console.log(`  ${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
console.log(`  ${C.green}  ${newVersion}  已推送到 origin${C.reset}`);
console.log(`  ${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
console.log();
console.log(`  下一步: ${C.yellow}npm run release${C.reset}`);
console.log();
