/**
 * build-release.mjs — 一键打包完整 Release
 *
 *   $ node scripts/build-release.mjs
 *
 * 流程:
 *   1. 下载便携 Node.js / Python / Git
 *   2. 预装 npm 依赖 + vite build
 *   3. 预装 pip 依赖 + 下载嵌入模型
 *   4. PyInstaller 打包启动器
 *   5. shallow clone 保留 .git → 覆盖预构建产物 → 压缩 zip
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, createWriteStream } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import https from "node:https";
import http from "node:http";
import { createWriteStream as _createWriteStream } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ── 配置 ──
const NODE_VERSION = "22.18.0";
const PYTHON_VERSION = "3.12.10";
const GIT_VERSION = "2.47.1.windows.1";

// 从 git tag 自动获取版本号
let VERSION = "dev";
try {
  const tag = execSync("git describe --tags --abbrev=0", {
    cwd: ROOT, encoding: "utf8", windowsHide: true, stdio: ["pipe","pipe","pipe"]
  }).trim();
  // 去掉可能的 v 前缀
  VERSION = tag.replace(/^v/, "");
} catch {
  // 没有 tag 则用 dev
  console.log(`  ${C.yellow}[WARN] 未找到 git tag，使用版本号: dev${C.reset}`);
}
const PROJECT_NAME = "邻舍.EXE";
const RELEASE_NAME = `${PROJECT_NAME}-v${VERSION}`;

const CACHE_DIR = resolve(ROOT, "launcher", "build_cache");
const RUNTIME_DIR = resolve(ROOT, "runtime");
const RELEASE_DIR = resolve(ROOT, "release", RELEASE_NAME);

const NODE_DIR = resolve(RUNTIME_DIR, "nodejs");
const PY_DIR = resolve(RUNTIME_DIR, "python");
const GIT_DIR = resolve(RUNTIME_DIR, "git");

const AGENT_CORE = resolve(ROOT, "agent-core");
const WEB_UI = resolve(ROOT, "web-ui");
const VECTOR_SVC = resolve(ROOT, "vector-service");

// 镜像源
const MIRRORS = {
  node: `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
  nodeOfficial: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
  python: `https://npmmirror.com/mirrors/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
  pythonOfficial: `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
  git: `https://npmmirror.com/mirrors/git-for-windows/v${GIT_VERSION}/PortableGit-${GIT_VERSION}-64-bit.7z.exe`,
  gitOfficial: `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}/PortableGit-${GIT_VERSION}-64-bit.7z.exe`,
  pipBootstrap: "https://bootstrap.pypa.io/get-pip.py",
};

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

const LOG_PREFIX = `  `;

// ── 辅助函数 ──

function log(msg) {
  console.log(`${LOG_PREFIX}${msg}`);
}

function ok(msg) {
  console.log(`${LOG_PREFIX}${C.green}✓ ${msg}${C.reset}`);
}

function warn(msg) {
  console.log(`${LOG_PREFIX}${C.yellow}[WARN] ${msg}${C.reset}`);
}

function fail(msg) {
  console.error(`${LOG_PREFIX}${C.red}[ERROR] ${msg}${C.reset}`);
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 下载文件，失败返回 false
 */
function downloadFile(url, dest, timeoutSec = 300) {
  return new Promise((resolvePromise) => {
    const proto = url.startsWith("https") ? https : http;
    const req = proto.get(url, { timeout: timeoutSec * 1000 }, (res) => {
      // 跟随重定向
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

/**
 * 执行命令并等待完成，返回 { ok, stdout, stderr, code }
 */
function exec(cmd, args, opts = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
      ...opts,
      env: { ...process.env, PYTHONUNBUFFERED: "1", FORCE_COLOR: "0", ...(opts.env || {}) },
    });

    let stdout = "";
    let stderr = "";

    // timeout
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

/**
 * 解压 zip 文件到目标目录
 */
function extractZip(zipPath, destDir) {
  // 使用 PowerShell 解压（Windows 内置）
  return exec("powershell", [
    "-NoProfile", "-Command",
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`
  ]);
}

/**
 * robocopy 复制目录
 */
async function robocopy(src, dest, excludeDirs = []) {
  const args = [src, dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS"];
  for (const d of excludeDirs) {
    args.push("/XD", d);
  }
  const result = await exec("robocopy", args);
  return result.code < 8;
}

// ── 主流程 ──

async function main() {
  console.clear();
  console.log();
  console.log(`  ${C.bold}邻舍.EXE — 完整 Release 打包${C.reset}`);
  console.log(`  ${C.dim}${"=".repeat(50)}${C.reset}`);
  console.log();

  // 创建目录
  ensureDir(CACHE_DIR);
  if (existsSync(RELEASE_DIR)) {
    log("清理旧的 release 目录...");
    rmSync(RELEASE_DIR, { recursive: true, force: true });
  }
  ensureDir(RUNTIME_DIR);

  // ═══════════════════════════════════════════
  // [1/8] 便携 Node.js
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[1/8]${C.reset} 准备便携 Node.js v${NODE_VERSION}...`);

  const nodeZip = resolve(CACHE_DIR, `node-v${NODE_VERSION}-win-x64.zip`);

  if (!existsSync(resolve(NODE_DIR, "node.exe"))) {
    if (!existsSync(nodeZip)) {
      log("下载 Node.js (~30MB)...");
      let dlOk = await downloadFile(MIRRORS.node, nodeZip);
      if (!dlOk) {
        warn("npmmirror 下载失败，尝试官方源...");
        dlOk = await downloadFile(MIRRORS.nodeOfficial, nodeZip);
        if (!dlOk) { fail("Node.js 下载失败!"); process.exit(1); }
      }
    }

    log("解压 Node.js...");
    if (existsSync(NODE_DIR)) rmSync(NODE_DIR, { recursive: true, force: true });
    await extractZip(nodeZip, RUNTIME_DIR);
    // 重命名 node-v* → nodejs
    const { readdirSync, renameSync } = await import("node:fs");
    const entries = readdirSync(RUNTIME_DIR);
    const nodeDirEntry = entries.find(e => e.startsWith("node-v"));
    if (nodeDirEntry) {
      renameSync(resolve(RUNTIME_DIR, nodeDirEntry), NODE_DIR);
    }
    ok("Node.js 就绪");
  } else {
    ok("已有捆绑 Node.js，跳过");
  }

  // ═══════════════════════════════════════════
  // [2/8] 便携 Python
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[2/8]${C.reset} 准备便携 Python ${PYTHON_VERSION}...`);

  const pyZip = resolve(CACHE_DIR, `python-${PYTHON_VERSION}-embed-amd64.zip`);
  const getPip = resolve(CACHE_DIR, "get-pip.py");

  if (!existsSync(resolve(PY_DIR, "python.exe"))) {
    if (!existsSync(pyZip)) {
      log("下载 Python embeddable (~11MB)...");
      let dlOk = await downloadFile(MIRRORS.python, pyZip, 120);
      if (!dlOk) {
        warn("npmmirror 下载失败，尝试官方源...");
        dlOk = await downloadFile(MIRRORS.pythonOfficial, pyZip, 120);
        if (!dlOk) { fail("Python 下载失败!"); process.exit(1); }
      }
    }

    log("解压 Python...");
    if (existsSync(PY_DIR)) rmSync(PY_DIR, { recursive: true, force: true });
    ensureDir(PY_DIR);
    await extractZip(pyZip, PY_DIR);

    // 修改 python3XX._pth 启用 site-packages + pip
    const { readdirSync, writeFileSync } = await import("node:fs");
    const pthFiles = readdirSync(PY_DIR).filter(f => f.startsWith("python") && f.endsWith("._pth"));
    if (pthFiles.length > 0) {
      const pthFile = resolve(PY_DIR, pthFiles[0]);
      log(`配置 ${pthFiles[0]}...`);
      writeFileSync(pthFile, "python312.zip\n.\nLib\\site-packages\nimport site\n", "ascii");
    }

    const sitePkgs = resolve(PY_DIR, "Lib", "site-packages");
    ensureDir(sitePkgs);

    if (!existsSync(getPip)) {
      log("下载 get-pip.py...");
      await downloadFile(MIRRORS.pipBootstrap, getPip, 60);
    }

    log("安装 pip...");
    const pipResult = await exec(resolve(PY_DIR, "python.exe"), [getPip, "--no-warn-script-location"]);
    if (!pipResult.ok) { fail("pip 安装失败!"); process.exit(1); }
    ok("Python 就绪");
  } else {
    ok("已有捆绑 Python，跳过");
  }

  // ═══════════════════════════════════════════
  // [3/8] 便携 Git
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[3/8]${C.reset} 准备便携 Git v${GIT_VERSION}...`);

  const gitExe = resolve(CACHE_DIR, `PortableGit-${GIT_VERSION}-64-bit.7z.exe`);
  const gitCmd = resolve(GIT_DIR, "cmd", "git.exe");
  const gitBin = resolve(GIT_DIR, "bin", "git.exe");

  if (existsSync(gitCmd) || existsSync(gitBin)) {
    ok("已有捆绑 Git，跳过");
  } else {
    if (!existsSync(gitExe)) {
      log("下载 Portable Git (~50MB)...");
      let dlOk = await downloadFile(MIRRORS.git, gitExe);
      if (!dlOk) {
        warn("npmmirror 下载失败，尝试官方源...");
        dlOk = await downloadFile(MIRRORS.gitOfficial, gitExe);
        if (!dlOk) {
          warn("Git 下载失败，版本更新功能将不可用");
        }
      }
    }

    if (existsSync(gitExe)) {
      log("解压 Git（自解压，静默）...");
      if (existsSync(GIT_DIR)) rmSync(GIT_DIR, { recursive: true, force: true });
      await exec(gitExe, [`-o"${GIT_DIR}"`, "-y"]);
      if (existsSync(gitCmd) || existsSync(gitBin)) {
        ok("Git 就绪");
      } else {
        warn("Git 解压后未找到 git.exe，版本更新功能将不可用");
      }
    }
  }

  // ═══════════════════════════════════════════
  // [4/8] 预装 Node.js 依赖
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[4/8]${C.reset} 预装 Node.js 依赖...`);

  const npmCmd = resolve(NODE_DIR, "npm.cmd");

  // agent-core
  if (existsSync(resolve(AGENT_CORE, "node_modules", "express"))) {
    ok("agent-core 已预装，跳过");
  } else {
    log("agent-core npm install (~3-8min)...");
    const r = await exec(npmCmd, ["install", "--no-audit", "--no-fund"], { cwd: AGENT_CORE, print: true });
    if (!r.ok) { fail("agent-core npm install 失败!"); process.exit(1); }
    ok("agent-core 完成");
  }

  // web-ui
  if (existsSync(resolve(WEB_UI, "node_modules"))) {
    ok("web-ui 已预装，跳过");
  } else {
    log("web-ui npm install (~2-5min)...");
    const r = await exec(npmCmd, ["install", "--no-audit", "--no-fund"], { cwd: WEB_UI, print: true });
    if (!r.ok) { fail("web-ui npm install 失败!"); process.exit(1); }
    ok("web-ui 完成");
  }

  // vite build
  if (existsSync(resolve(AGENT_CORE, "public", "index.html"))) {
    ok("vite build 产物已存在，跳过");
  } else {
    log("vite build (~1min)...");
    const r = await exec(npmCmd, ["run", "build"], { cwd: WEB_UI, print: true });
    if (!r.ok) {
      warn("vite build 失败，继续...");
    } else {
      ok("vite build 完成");
    }
  }

  // ═══════════════════════════════════════════
  // [5/8] 预装 Python 依赖
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[5/8]${C.reset} 预装 Python 依赖...`);

  const pyExe = resolve(PY_DIR, "python.exe");
  // pip 通用环境变量：跳过版本检查 + 信任镜像源（embeddable Python 可能缺 SSL 证书）
  const pipEnv = {
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_NO_CACHE_DIR: "1",
  };
  const pipMirror = "https://pypi.tuna.tsinghua.edu.cn/simple";
  const pipTrusted = ["--trusted-host", "pypi.tuna.tsinghua.edu.cn"];

  {
    const check = await exec(pyExe, [
      "-c", "import fastapi, uvicorn, chromadb, onnxruntime, numpy"
    ]);
    if (check.ok) {
      ok("Python 依赖已预装，跳过");
    } else {
      log("pip install (~1-3min)...");

      // 先确保 pip 本身是最新的
      log("  升级 pip...");
      await exec(pyExe, ["-m", "pip", "install", "--upgrade", "pip", ...pipTrusted],
        { print: true, env: pipEnv });

      // 逐个安装关键包以便定位失败点
      const pkgs = [
        "numpy",
        "fastapi",
        "uvicorn[standard]",
        "pydantic",
        "httpx",
        "onnxruntime",
        "huggingface-hub",
        "transformers",
        "chromadb",
        "cloudscraper",
        "beautifulsoup4",
        "lxml",
      ];

      let allOk = true;
      for (const pkg of pkgs) {
        log(`  pip install ${pkg}...`);
        // 先试清华源 + trusted-host
        let r = await exec(pyExe, [
          "-m", "pip", "install", pkg,
          "-i", pipMirror,
          ...pipTrusted,
        ], { print: true, env: pipEnv, timeout: 120000 });
        // 清华源失败则用默认源
        if (!r.ok) {
          r = await exec(pyExe, [
            "-m", "pip", "install", pkg,
          ], { print: true, env: pipEnv, timeout: 120000 });
        }
        if (!r.ok) {
          fail(`${pkg} 安装失败 (exit: ${r.code})`);
          log(`  stderr: ${r.stderr.slice(-500)}`);
          allOk = false;
          break;
        }
      }

      if (!allOk) {
        fail("Python 依赖安装失败!");
        log(`  请检查网络连接或手动执行:`);
        log(`  cd ${VECTOR_SVC}`);
        log(`  ${pyExe} -m pip install -r requirements.txt`);
        process.exit(1);
      }
      ok("Python 依赖完成");
    }
  }

  // ═══════════════════════════════════════════
  // [6/8] 预下载嵌入模型
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[6/8]${C.reset} 预下载嵌入模型...`);

  const modelFile = resolve(VECTOR_SVC, "models", "jina-embeddings-v2-base-zh", "onnx", "model_int8.onnx");

  if (existsSync(modelFile)) {
    ok("模型已存在，跳过");
  } else {
    log("下载嵌入模型 (~155MB)...");
    const r = await exec(pyExe, ["download_model.py"], { cwd: VECTOR_SVC, print: true });
    if (!r.ok) {
      warn("模型下载失败，用户首次启动时会自动下载");
    } else {
      ok("模型下载完成");
    }
  }

  // ═══════════════════════════════════════════
  // [7/8] PyInstaller 打包启动器
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[7/8]${C.reset} PyInstaller 打包启动器...`);

  const launcherDir = resolve(ROOT, "launcher");

  {
    const check = await exec("pip", ["show", "PySide6"]);
    if (!check.ok) {
      log("安装 PyInstaller 依赖...");
      await exec("pip", ["install", "PySide6", "psutil", "pyinstaller"], { print: true });
    }
  }

  {
    const r = await exec("pyinstaller", [
      "--onefile", "--windowed",
      "--name", "邻舍.EXE",
      "--icon", "assets/icon.ico",
      "--add-data", "assets/launchHeader.jpg;assets",
      "--add-data", "assets/icon.ico;assets",
      "--add-data", "assets/HarmonyOS_Sans_Regular.ttf;assets",
      "--add-data", "assets/navbar-title.png;assets",
      "--hidden-import", "PySide6.QtCore",
      "--hidden-import", "PySide6.QtGui",
      "--hidden-import", "PySide6.QtWidgets",
      "--hidden-import", "PySide6.QtNetwork",
      "--clean", "--noconfirm",
      "main.py",
    ], { cwd: launcherDir, print: true });
    if (!r.ok) { fail("PyInstaller 打包失败!"); process.exit(1); }
    ok("PyInstaller 打包完成");
  }

  // ═══════════════════════════════════════════
  // [8/8] 组装 Release 包
  // ═══════════════════════════════════════════
  console.log(`  ${C.bold}[8/8]${C.reset} 组装 Release 包...`);

  // shallow clone 保留 .git/
  log("创建 shallow clone (保留 .git 用于版本更新)...");
  const cloneResult = await exec("git", ["clone", "--depth", "1", ROOT, RELEASE_DIR]);
  let hasGit = cloneResult.ok;

  if (!hasGit) {
    warn("git clone 失败，回退到文件复制（版本更新功能不可用）");
    warn(`  错误: ${cloneResult.stderr.slice(0, 200)}`);
    ensureDir(RELEASE_DIR);

    // robocopy 排除目录
    const robocopyExclude = [".git", "node_modules", "release", "__pycache__", ".cache"];
    const rcOk = await robocopy(ROOT, RELEASE_DIR, robocopyExclude);
    if (!rcOk) { fail("文件复制失败!"); process.exit(1); }
  } else {
    ok("shallow clone 完成");
  }

  // ── 覆盖预构建产物 ──

  // runtime
  log("复制 runtime...");
  {
    const rcOk = await robocopy(RUNTIME_DIR, resolve(RELEASE_DIR, "runtime"));
    if (!rcOk) { fail("runtime 复制失败!"); process.exit(1); }
    ok("runtime (Node.js + Python + Git)");
  }

  // agent-core/node_modules
  log("复制 agent-core\\node_modules...");
  ensureDir(resolve(RELEASE_DIR, "agent-core"));
  {
    const rcOk = await robocopy(
      resolve(AGENT_CORE, "node_modules"),
      resolve(RELEASE_DIR, "agent-core", "node_modules"),
      [".cache"]
    );
    if (!rcOk) { fail("node_modules 复制失败!"); process.exit(1); }
    ok("agent-core\\node_modules");
  }

  // agent-core/public
  log("复制 agent-core\\public...");
  if (existsSync(resolve(AGENT_CORE, "public"))) {
    await robocopy(
      resolve(AGENT_CORE, "public"),
      resolve(RELEASE_DIR, "agent-core", "public")
    );
  }
  ok("agent-core\\public");

  // vector-service/models
  if (existsSync(modelFile)) {
    log("复制嵌入模型...");
    const modelDst = resolve(RELEASE_DIR, "vector-service", "models");
    ensureDir(modelDst);
    await robocopy(
      resolve(VECTOR_SVC, "models"),
      modelDst
    );
    ok("vector-service\\models");
  }

  // 邻舍.EXE.exe
  const launcherExe = resolve(launcherDir, "dist", "邻舍.EXE.exe");
  if (existsSync(launcherExe)) {
    const { copyFileSync } = await import("node:fs");
    copyFileSync(launcherExe, resolve(RELEASE_DIR, "邻舍.EXE.exe"));
    ok("邻舍.EXE.exe");
  } else {
    warn("未找到 邻舍.EXE.exe，PyInstaller 可能未成功");
  }

  // 使用说明
  const { writeFileSync } = await import("node:fs");
  writeFileSync(resolve(RELEASE_DIR, "使用说明.txt"), [
    "邻舍 - AI 图像生成智能体",
    "",
    "【使用步骤】",
    "1. 双击运行 邻舍.EXE.exe",
    "2. 在「设置」中配置 ComfyUI 启动器路径",
    "3. 返回「首页」点击「启动」",
    "4. 浏览器访问 http://localhost:3099",
    "",
    "【首次使用】",
    "启动后如需配置 LLM API Key，请编辑：",
    "  agent-core\\.env （首次启动时自动创建）",
    "",
    "【版本更新】",
    "切换到「版本」页签 → 点击「检查更新」",
    "如有新版本，选择后点击「切换到此版本」，会自动构建",
    "",
    "【常见问题】",
    "- 确保 ComfyUI 已正确安装并能正常运行",
    "- 本程序自带运行环境（Node.js/Python/Git），无需额外安装",
  ].join("\n"), "utf-8");
  ok("使用说明.txt");

  // 默认头像：复制到 avatars 目录，确保首次启动时有默认头像
  const defaultAvatar = resolve(WEB_UI, "public", "default_assistant_header.png");
  if (existsSync(defaultAvatar)) {
    const avatarDst = resolve(RELEASE_DIR, "agent-core", "data", "avatars");
    ensureDir(avatarDst);
    const { copyFileSync } = await import("node:fs");
    copyFileSync(defaultAvatar, resolve(avatarDst, "default_assistant_header.png"));
    ok("默认头像 → agent-core\\data\\avatars\\");
  } else {
    warn("默认头像不存在: web-ui/public/default_assistant_header.png");
  }

  // ═══════════════════════════════════════════
  // 打包 zip
  // ═══════════════════════════════════════════
  console.log();
  log("创建 release zip...");

  const zipFile = resolve(ROOT, "release", `${RELEASE_NAME}.zip`);
  if (existsSync(zipFile)) {
    const { unlinkSync } = await import("node:fs");
    unlinkSync(zipFile);
  }

  // 使用 PowerShell Compress-Archive（Windows 内置，无需额外依赖）
  const zipResult = await exec("powershell", [
    "-NoProfile", "-Command",
    `Compress-Archive -Path '${RELEASE_DIR}\\*' -DestinationPath '${zipFile}' -Force`
  ]);
  if (!zipResult.ok) { fail("zip 创建失败!"); process.exit(1); }

  const { statSync } = await import("node:fs");
  const zipSizeMB = Math.round(statSync(zipFile).size / (1024 * 1024));

  console.log();
  console.log(`  ${C.bold}${"=".repeat(50)}${C.reset}`);
  console.log(`  ${C.bold}✨ Release 打包完成!${C.reset}`);
  console.log(`  ${C.dim}${"=".repeat(50)}${C.reset}`);
  console.log();
  console.log(`  版本: v${VERSION}`);
  console.log(`  输出: release\\${RELEASE_NAME}.zip`);
  console.log(`  体积: ~${zipSizeMB} MB`);
  console.log();
  console.log(`  包含内容:`);
  console.log(`  - Node.js v${NODE_VERSION} 便携版`);
  console.log(`  - Python ${PYTHON_VERSION} + 全部依赖`);
  console.log(`  - Portable Git (版本更新)`);
  console.log(`  - .git/ (shallow, 约 5-10MB)`);
  console.log(`  - agent-core (预装依赖)`);
  console.log(`  - vector-service (含嵌入模型)`);
  console.log(`  - 邻舍.EXE 启动器`);
  console.log();
  console.log(`  用户解压后:`);
  console.log(`  - 零构建，解压即用`);
  console.log(`  - 版本管理功能完整可用`);
  console.log();

  // 提示清理
  log(`${C.dim}提示: runtime/ 和 launcher/build_cache/ 为缓存，可保留用于下次打包加速${C.reset}`);
}

main().catch((err) => {
  console.error(`${C.red}Fatal: ${err.message}${C.reset}`);
  console.error(err.stack);
  process.exit(1);
});
