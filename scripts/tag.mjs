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
 *   4. git tag + push origin
 */

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const C = {
  reset: "\x1b[0m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m",
};

function sh(cmd, opts = {}) {
  const result = execSync(cmd, {
    cwd: ROOT, encoding: "utf8", windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"], ...opts,
  });
  // 非 pipe 模式（如 inherit）返回 null
  return result ? result.trim() : "";
}

function run(cmd) {
  sh(cmd, { stdio: "inherit" });
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
run("cd web-ui && npm run build");
ok("vite build 完成");

// ── 2. 获取最新 tag ──

let latestTag = "";
try {
  latestTag = sh("git describe --tags --abbrev=0");
} catch {
  latestTag = "v0.0.0";
}

// 解析版本号
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
  sh("git add .");
  run(`git commit -m "${commitMsg}"`);
  ok("提交完成");
} else {
  ok("工作区干净，跳过提交");
}

// ── 5. 打 tag ──

log(`创建 tag: ${newVersion}`);
run(`git tag -a ${newVersion} -m "${tagMessage}"`);
ok(`tag ${newVersion} 创建完成`);

// ── 6. 推送 ──

const branch = sh("git rev-parse --abbrev-ref HEAD");
log(`推送 ${branch} + tags → origin...`);
run(`git push origin ${branch} --tags`);
ok("推送完成");

console.log();
console.log(`  ${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
console.log(`  ${C.green}  ${newVersion}  已推送到 origin${C.reset}`);
console.log(`  ${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
console.log();
console.log(`  下一步: ${C.yellow}npm run release${C.reset}`);
console.log();
