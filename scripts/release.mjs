/**
 * release.mjs — 一键发布打包
 *
 *   $ node scripts/release.mjs [version_tag]
 *
 * 自动完成:
 *   1. 克隆干净仓库到 .production/galgame-with-comfyUI
 *   2. 复制 default_assistant_header.png
 *   3. 复制 vector-service/models (嵌入模型)
 *   4. 复制 邻舍.EXE.exe 启动器
 *   5. 可选: 打 zip 包 / 创建 GitHub Release
 *
 * 前置条件:
 *   - 已安装 Git
 *   - 已安装 GitHub CLI (gh)，如需创建 Release
 *   - 邻舍.EXE.exe 已通过 launcher/build.bat 构建
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

// ── 配置 ──
const REPO_URL = "https://github.com/icecranberry/galgame-with-comfyUI.git";
const PROD_DIR = resolve(ROOT, ".production", "galgame-with-comfyUI");
const AVATAR_SRC = resolve(ROOT, ".production", "data", "avatars", "default_assistant_header.png");
const MODELS_SRC = resolve(ROOT, "vector-service", "models");
const LAUNCHER_SRC = resolve(ROOT, "邻舍.EXE.exe");

// ── 工具函数 ──

function run(cmd, opts = {}) {
  const { cwd = ROOT, silent = false, ignoreError = false } = opts;
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      stdio: silent ? ["pipe", "pipe", "pipe"] : "inherit",
    });
  } catch (e) {
    if (!ignoreError) throw e;
    return "";
  }
}

function step(title) {
  console.log(`\n  ${C.bold}${C.cyan}▶ ${title}${C.reset}`);
}

function ok(msg) {
  console.log(`    ${C.green}✓ ${msg}${C.reset}`);
}

function warn(msg) {
  console.log(`    ${C.yellow}⚠ ${msg}${C.reset}`);
}

function fail(msg) {
  console.log(`    ${C.red}✗ ${msg}${C.reset}`);
}

// ── 检查前置条件 ──

function checkPrerequisites() {
  step("检查前置条件");

  // 检查启动器
  if (!existsSync(LAUNCHER_SRC)) {
    fail("邻舍.EXE.exe 不存在，请先运行 launcher/build.bat 构建启动器");
    return false;
  }
  ok("邻舍.EXE.exe 已就绪");

  // 检查默认头像
  if (!existsSync(AVATAR_SRC)) {
    warn("default_assistant_header.png 不存在，将跳过（首次启动时会使用空头像）");
  } else {
    ok("default_assistant_header.png 已就绪");
  }

  // 检查模型
  if (!existsSync(MODELS_SRC)) {
    warn("vector-service/models 不存在，将跳过（用户首次构建时会自动下载 ~155MB）");
  } else {
    ok("vector-service/models 已就绪");
  }

  // 检查 git
  try {
    run("git --version", { silent: true });
    ok("Git 已安装");
  } catch {
    fail("Git 未安装");
    return false;
  }

  return true;
}

// ── 步骤 1: 准备干净仓库 ──

function prepareRepo() {
  step("步骤 1/4: 准备干净仓库");

  // 确保 .production 目录存在
  const prodParent = resolve(ROOT, ".production");
  mkdirSync(prodParent, { recursive: true });

  if (existsSync(PROD_DIR)) {
    // 已存在 → git pull
    console.log(`    目录已存在，执行 git pull...`);
    try {
      run("git fetch origin --tags", { cwd: PROD_DIR });
      run("git checkout main", { cwd: PROD_DIR });
      run("git reset --hard origin/main", { cwd: PROD_DIR });
      run("git clean -fdx", { cwd: PROD_DIR });
      ok("仓库已更新到最新 main 分支");
    } catch (e) {
      warn(`git pull 失败: ${e.message}，将删除后重新 clone`);
      rmSync(PROD_DIR, { recursive: true, force: true });
      cloneFresh();
    }
  } else {
    cloneFresh();
  }

  function cloneFresh() {
    console.log(`    git clone ${REPO_URL} → ${PROD_DIR}`);
    run(`git clone "${REPO_URL}" "${PROD_DIR}"`);
    ok("仓库克隆完成");
  }
}

// ── 步骤 2: 复制默认头像 ──

function copyAvatar() {
  step("步骤 2/4: 复制默认头像");

  if (!existsSync(AVATAR_SRC)) {
    warn("源文件不存在，跳过");
    return;
  }

  const destDir = resolve(PROD_DIR, "agent-core", "data", "avatars");
  mkdirSync(destDir, { recursive: true });
  cpSync(AVATAR_SRC, resolve(destDir, "default_assistant_header.png"));
  ok("default_assistant_header.png → agent-core/data/avatars/");
}

// ── 步骤 3: 复制嵌入模型 ──

function copyModels() {
  step("步骤 3/4: 复制嵌入模型");

  if (!existsSync(MODELS_SRC)) {
    warn("源目录不存在，跳过（用户首次构建时会自动下载）");
    return;
  }

  const destDir = resolve(PROD_DIR, "vector-service", "models");
  mkdirSync(destDir, { recursive: true });

  // 使用 robocopy 或 cpSync 复制整个目录
  const modelDir = resolve(MODELS_SRC, "jina-embeddings-v2-base-zh");
  if (existsSync(modelDir)) {
    cpSync(modelDir, resolve(destDir, "jina-embeddings-v2-base-zh"), { recursive: true });
    ok("jina-embeddings-v2-base-zh → vector-service/models/");
  } else {
    warn("模型子目录不存在，跳过");
  }
}

// ── 步骤 4: 复制启动器 ──

function copyLauncher() {
  step("步骤 4/4: 复制启动器");

  const dest = resolve(PROD_DIR, "邻舍.EXE.exe");
  cpSync(LAUNCHER_SRC, dest);
  ok("邻舍.EXE.exe → 项目根目录");
}

// ── 可选: 打包 zip ──

function createZip(versionTag) {
  step("打包 zip");

  const tag = versionTag || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const zipName = `邻舍.EXE-${tag}.zip`;
  const zipPath = resolve(ROOT, ".production", zipName);

  // 删除旧 zip
  if (existsSync(zipPath)) {
    rmSync(zipPath);
  }

  console.log(`    正在压缩...`);
  try {
    // 使用 PowerShell 压缩（Windows 自带）
    run(
      `powershell -NoProfile -Command "Compress-Archive -Path '${PROD_DIR}\\*' -DestinationPath '${zipPath}' -Force"`,
      { cwd: ROOT }
    );
    ok(`zip 已创建: .production/${zipName}`);

    // 显示大小
    const stats = run(
      `powershell -NoProfile -Command "(Get-Item '${zipPath}').Length / 1MB"`,
      { silent: true }
    ).trim();
    console.log(`    大小: ${Number(stats).toFixed(0)} MB`);
  } catch (e) {
    fail(`压缩失败: ${e.message}`);
  }
}

// ── 可选: 创建 GitHub Release ──

async function createGitHubRelease(versionTag) {
  step("创建 GitHub Release");

  // 检查 gh CLI
  try {
    run("gh --version", { silent: true });
  } catch {
    warn("GitHub CLI (gh) 未安装或未登录，跳过 Release 创建");
    warn("安装方法: winget install GitHub.cli  然后: gh auth login");
    return;
  }

  const tag = versionTag || `v${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const zipName = `邻舍.EXE-${tag}.zip`;
  const zipPath = resolve(ROOT, ".production", zipName);

  if (!existsSync(zipPath)) {
    warn("zip 包不存在，请先执行打包");
    return;
  }

  try {
    // 先确保 tag 存在（在 prod 目录中打 tag）
    run(`git tag -f "${tag}"`, { cwd: PROD_DIR, ignoreError: true });
    run(`git push origin "${tag}"`, { cwd: PROD_DIR, ignoreError: true });

    // 创建 Release 并上传 zip
    run(
      `gh release create "${tag}" "${zipPath}" --title "${tag}" --notes "自动打包版本 ${tag}" --repo icecranberry/galgame-with-comfyUI`,
      { cwd: ROOT }
    );
    ok(`GitHub Release ${tag} 已创建`);
  } catch (e) {
    fail(`GitHub Release 创建失败: ${e.message}`);
  }
}

// ── 主流程 ──

async function main() {
  const args = process.argv.slice(2);
  const versionTag = args[0] || "";
  const doZip = args.includes("--zip") || args.includes("-z") || true;  // 默认打包 zip
  const doRelease = args.includes("--release") || args.includes("-r");
  const skipModel = args.includes("--skip-model");

  console.clear();
  console.log();
  console.log(`  ${C.bold}🔧 邻舍 — 发布打包脚本${C.reset}`);
  console.log(`  ${C.dim}${"=".repeat(50)}${C.reset}`);
  console.log();

  if (!checkPrerequisites()) {
    process.exit(1);
  }

  const startTime = Date.now();

  prepareRepo();
  copyAvatar();

  if (skipModel) {
    warn("--skip-model: 跳过模型复制（用户首次构建时会自动下载）");
  } else {
    copyModels();
  }

  copyLauncher();

  // 打包
  if (doZip) {
    createZip(versionTag);
  }

  // GitHub Release（可选）
  if (doRelease) {
    await createGitHubRelease(versionTag);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log();
  console.log(`  ${C.bold}${C.green}✓ 发布打包完成！${C.reset} (耗时 ${elapsed}s)`);
  console.log();
  console.log(`  输出目录: ${C.cyan}${PROD_DIR}${C.reset}`);
  console.log();
  console.log(`  ${C.dim}提示:${C.reset}`);
  console.log(`  ${C.dim}  - 跳过模型可加速打包: node scripts/release.mjs --skip-model${C.reset}`);
  console.log(`  ${C.dim}  - 创建 GitHub Release: node scripts/release.mjs v1.0.0 --release${C.reset}`);
  console.log();
}

main().catch((err) => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  process.exit(1);
});
