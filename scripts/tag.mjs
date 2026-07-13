/**
 * tag.mjs — 自动打 tag 并推送
 *
 *   $ npm run tag                        # 自动 patch+1，用 commit 注释
 *   $ npm run tag -- v2.0.0              # 手动指定版本
 *   $ npm run tag -- v2.0.0 "重大更新"   # 手动指定版本+注释
 *
 * 流程:
 *   1. vite build 打包前端
 *   2. 解析版本号（自动 patch+1 或手动指定）
 *   3. 工作区脏 → 自动提交；工作区干净 → 直接打 tag
 *   4. git fetch → git tag → 分步 push 分支 + tags（含失败重试）
 */

import { execSync, spawnSync } from "node:child_process";
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
