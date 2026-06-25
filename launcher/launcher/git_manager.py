"""
Git 管理器 —— 封装 git CLI 调用，所有耗时操作通过 QProcess 异步执行。
"""
import os
import re
import subprocess
import sys
import time
from PySide6.QtCore import QObject, Signal, QProcess

# Windows 下隐藏 subprocess 弹出的命令行窗口
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if sys.platform == "win32" else 0
_CACHE_TTL = 2.0  # 同一次初始化链内去重，2 秒内复用缓存


def _cached(ttl: float = _CACHE_TTL):
    """装饰器：短 TTL 内存缓存，消除启动时链式调用导致的重复 subprocess。"""

    def deco(func):
        def wrapper(self, *args, **kwargs):
            now = time.monotonic()
            key = func.__name__
            entry = self._git_cache.get(key)
            if entry and (now - entry["ts"]) < ttl:
                return entry["value"]
            value = func(self, *args, **kwargs)
            self._git_cache[key] = {"value": value, "ts": now}
            return value

        return wrapper

    return deco


class GitManager(QObject):
    """Git 操作：fetch、tags、checkout、检测更新。"""

    # 信号
    output = Signal(str)  # 操作输出（逐行）
    operation_done = Signal(str, bool, str)  # (operation_name, success, message)

    def __init__(self, project_path: str, repo_url: str = "", parent=None):
        super().__init__(parent)
        self._project_path = project_path
        self._repo_url = repo_url
        self._proc: QProcess | None = None
        self._pending_op = ""
        self._fetch_gen = 0          # fetch 代际：递增以忽略被 kill 的 stale callback
        self._finished_fetch_gen = 0 # 当前完成的 fetch 代际
        self._git_cache: dict[str, dict] = {}  # key → {value, ts}
        self._stderr_lines: list[str] = []     # 累积当前操作的 stderr

    @property
    def project_path(self) -> str:
        return self._project_path

    def set_project_path(self, path: str):
        self._project_path = path

    def set_repo_url(self, url: str):
        self._repo_url = url

    def clear_cache(self):
        """清除 _cached 装饰器的内存缓存。"""
        self._git_cache.clear()

    def is_busy(self) -> bool:
        """是否有正在进行的异步操作。"""
        return bool(self._pending_op)

    def _cleanup_locks(self):
        """清理残留的 git 锁文件（进程被 kill 后可能遗留）。"""
        for name in ("index.lock", "HEAD.lock", "config.lock",
                     "packed-refs.lock", "shallow.lock"):
            lock = os.path.join(self._project_path, ".git", name)
            try:
                if os.path.isfile(lock):
                    os.remove(lock)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # 同步方法（快速，不阻塞）
    # ------------------------------------------------------------------

    def is_git_repo(self) -> bool:
        """检查是否为 git 仓库。"""
        return os.path.isdir(os.path.join(self._project_path, ".git"))

    def get_remote_url(self) -> str | None:
        """获取当前 origin remote URL。"""
        try:
            result = subprocess.run(
                ["git", "remote", "get-url", "origin"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=_CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return None

    def is_remote_local_path(self) -> bool:
        """检查 remote URL 是否为本地路径（构建机遗留）。"""
        url = self.get_remote_url()
        if not url:
            return False
        # 本地路径特征：盘符开头(Windows) 或 / 开头但不含 ://
        if sys.platform == "win32":
            if len(url) >= 2 and url[1] == ":":
                return True
        if url.startswith("/") and "://" not in url:
            return True
        return False

    def repair_remote(self) -> bool:
        """如果 origin URL 是本地路径（构建机遗留），修正为 GitHub URL。"""
        if not self._repo_url:
            return False
        if not self.is_git_repo():
            return False
        if not self.is_remote_local_path():
            return True  # 已经是正常 URL，无需修复

        try:
            result = subprocess.run(
                ["git", "remote", "set-url", "origin", self._repo_url],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=_CREATE_NO_WINDOW,
            )
            return result.returncode == 0
        except Exception:
            return False

    @_cached()
    def get_tags(self) -> list[dict]:
        """获取所有 tags，按创建时间倒序。每条含 name / message / date。"""
        try:
            result = subprocess.run(
                ["git", "for-each-ref", "--sort=-creatordate",
                 "--format=%(refname:short)%00%(subject)%00%(creatordate:short)", "refs/tags/"],
                cwd=self._project_path,
                capture_output=True,
                timeout=10,
                creationflags=_CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                tags = []
                # null-byte 分隔，先按换行拆条目，再按 \0 拆字段
                for line in result.stdout.decode("utf-8", errors="replace").splitlines():
                    if not line.strip():
                        continue
                    parts = line.split("\0")
                    name = parts[0].strip()
                    message = parts[1].strip() if len(parts) > 1 else ""
                    date = parts[2].strip() if len(parts) > 2 else ""
                    tags.append({"name": name, "message": message, "date": date})
                return tags
        except Exception:
            pass
        return []

    @_cached()
    def get_current_tag(self) -> str | None:
        """获取 HEAD 对应的 tag 名（精确匹配），不在 tag 上则返回 None。"""
        try:
            result = subprocess.run(
                ["git", "describe", "--tags", "--exact-match", "--abbrev=0"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=_CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return None

    @_cached()
    def get_current_branch(self) -> str:
        """获取当前分支名。"""
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=_CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return "unknown"

    @_cached(ttl=5.0)  # ls-remote 走网络，缓存稍长
    def get_latest_remote_tag(self) -> str | None:
        """获取远程最新 tag（需要先 fetch）。"""
        try:
            result = subprocess.run(
                ["git", "ls-remote", "--tags", "--sort=-creatordate", "origin"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=15,
                creationflags=_CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    m = re.search(r"refs/tags/(.+?)(?:\^\{\})?$", line.strip())
                    if m and not m.group(1).endswith("^{}"):
                        return m.group(1)
        except Exception:
            pass
        return None

    def has_updates(self) -> bool | None:
        """检查远程是否有更新的 tag。返回 None 表示无法判断。"""
        current = self.get_current_tag()
        latest = self.get_latest_remote_tag()
        if current is None or latest is None:
            return None
        # 简单字符串比较；对于语义化版本可以更精确
        return current != latest

    # ------------------------------------------------------------------
    # 异步方法（通过 QProcess）
    # ------------------------------------------------------------------

    def fetch_remote(self) -> str | None:
        """异步 fetch origin。返回 None 表示启动成功，否则返回错误信息。"""
        if not self.is_git_repo():
            return "不是有效的 git 仓库"
        if self.is_busy():
            return "上一个操作仍在进行中，请稍后再试"

        self._cleanup_locks()
        self._fetch_gen += 1
        self._pending_op = "fetch"
        self._run_git(["fetch", "origin", "--tags"])
        return None

    def checkout_tag(self, tag: str) -> str | None:
        """异步 checkout 指定 tag。使用 --force 覆盖本地修改（预构建产物等）。"""
        if not self.is_git_repo():
            return "不是有效的 git 仓库"
        if self.is_busy():
            return "上一个操作仍在进行中，请稍后再试"

        self._cleanup_locks()
        self._pending_op = "checkout"
        self._run_git(["checkout", "--force", f"tags/{tag}"])
        return None

    def init_repo(self) -> str | None:
        """异步初始化 git 仓库（无 .git 目录时）。

        链式执行: git init → git remote add origin → git fetch origin --tags。
        返回 None 表示启动成功，否则返回错误信息。
        """
        if self.is_git_repo():
            return "已是有效的 git 仓库"
        if not self._repo_url:
            return "未配置远程仓库地址"
        if self.is_busy():
            return "上一个操作仍在进行中，请稍后再试"

        self._fetch_gen += 1
        self._pending_op = "init_repo"
        self._init_repo_steps = [
            (["init"], "git init"),
            (["remote", "add", "origin", self._repo_url], "git remote add"),
            (["fetch", "origin", "--tags"], "git fetch"),
        ]
        self._init_repo_step_idx = 0
        self._run_git(self._init_repo_steps[0][0])
        return None

    def cancel(self):
        """取消当前操作。"""
        if self._proc and self._proc.state() != QProcess.NotRunning:
            self._proc.kill()
        self._init_repo_steps = []

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run_git(self, args: list[str]):
        if self._proc is not None:
            self._proc.kill()
            self._proc.deleteLater()

        self._stderr_lines.clear()

        self._proc = QProcess(self)
        self._proc.setWorkingDirectory(self._project_path)
        self._proc.setProcessChannelMode(QProcess.SeparateChannels)
        self._proc.readyReadStandardOutput.connect(self._on_stdout)
        self._proc.readyReadStandardError.connect(self._on_stderr)
        self._proc.finished.connect(self._on_finished)

        # 注入关键环境变量，避免 git 因找不到 HOME/.gitconfig 而崩溃
        env = self._proc.processEnvironment()
        for key in ("USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH",
                     "TEMP", "TMP", "SystemRoot", "PATH",
                     "APPDATA", "LOCALAPPDATA", "SSH_AUTH_SOCK"):
            if key in os.environ and key not in env.keys():
                env.insert(key, os.environ[key])
        # 禁止 git 弹出交互式认证窗口（否则 QProcess 无法处理会导致挂死）
        env.insert("GIT_TERMINAL_PROMPT", "0")
        self._proc.setProcessEnvironment(env)

        # 记录当前 fetch 代际，用于 _on_finished 忽略 stale callback
        self._started_fetch_gen = self._fetch_gen

        git_exe = self._resolve_git()
        self._proc.start(git_exe, args)

    def _resolve_git(self) -> str:
        """解析 git.exe 路径: 捆绑 Git > 系统 Git。"""
        from .service_runner import find_bundled_git
        bundled = find_bundled_git(self._project_path)
        if bundled:
            return bundled
        return _find_git()

    def _on_stdout(self):
        data = self._proc.readAllStandardOutput()
        text = _decode_output(data.data())
        if text.strip():
            self.output.emit(text.strip())

    def _on_stderr(self):
        data = self._proc.readAllStandardError()
        text = _decode_output(data.data())
        if text.strip():
            self._stderr_lines.append(text.strip())
            self.output.emit(text.strip())

    def _on_finished(self, exit_code, exit_status):
        # 忽略被 kill 的旧 QProcess 的 stale callback
        finished_gen = getattr(self, '_started_fetch_gen', 0)
        if self._pending_op in ("fetch", "init_repo") and finished_gen != self._fetch_gen:
            # 这是上一个 fetch 进程的回调，已被新 fetch kill，忽略
            return

        ok = exit_code == 0 and exit_status == QProcess.NormalExit

        # init_repo 是多步链式操作
        if self._pending_op == "init_repo" and ok:
            self._init_repo_step_idx += 1
            steps = getattr(self, '_init_repo_steps', [])
            if self._init_repo_step_idx < len(steps):
                # 继续下一步
                step_label = steps[self._init_repo_step_idx][1]
                self.output.emit(f"[init] {step_label}...")
                self._run_git(steps[self._init_repo_step_idx][0])
                return
            # 全部完成
            self._init_repo_steps = []

        if ok:
            msg = "操作成功"
        else:
            stderr_tail = ""
            if self._stderr_lines:
                joined = "; ".join(self._stderr_lines[-3:])
                stderr_tail = f" | stderr: {joined}"
            crash_hint = ""
            if exit_status != QProcess.NormalExit:
                crash_hint = f" (进程异常终止)"
            msg = f"操作失败 (exit code: {exit_code}){crash_hint}{stderr_tail}"
        self.operation_done.emit(self._pending_op, ok, msg)
        self._pending_op = ""


# ------------------------------------------------------------------
# Helper
# ------------------------------------------------------------------


def _decode_output(data: bytes) -> str:
    """Windows 兼容解码：UTF-8 → GBK → 替换模式。"""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return data.decode("gbk")
        except UnicodeDecodeError:
            return data.decode("utf-8", errors="replace")


def _find_git() -> str:
    """查找 git.exe 的完整路径。QProcess 不像 subprocess 那样自动搜索 PATH。

    优先级: 捆绑 Git (runtime/git/) > PATH > 已知安装路径
    """
    import shutil

    # 0. 捆绑 Git（预构建 release）
    # 从调用栈推断 project_path —— 遍历 _project_path 属性
    # 但这里没有 project_path，所以检查常见相对路径
    # _find_git 被 GitManager 调用，GitManager 有 self._project_path
    # 我们改为在 GitManager 实例方法中处理

    # 1. shutil.which 搜索系统 PATH
    found = shutil.which("git")
    if found:
        return found

    # 2. Windows 已知安装路径
    for base in [
        os.path.expandvars(r"%ProgramFiles%\Git\bin"),
        os.path.expandvars(r"%ProgramFiles%\Git\cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Git\bin"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Git\cmd"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\bin"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\cmd"),
    ]:
        candidate = os.path.join(base, "git.exe")
        if os.path.isfile(candidate):
            return candidate

    # 3. 兜底
    return "git"
