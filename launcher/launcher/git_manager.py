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

    def __init__(self, project_path: str, parent=None):
        super().__init__(parent)
        self._project_path = project_path
        self._proc: QProcess | None = None
        self._pending_op = ""
        self._fetch_gen = 0          # fetch 代际：递增以忽略被 kill 的 stale callback
        self._finished_fetch_gen = 0 # 当前完成的 fetch 代际
        self._git_cache: dict[str, dict] = {}  # key → {value, ts}

    @property
    def project_path(self) -> str:
        return self._project_path

    def set_project_path(self, path: str):
        self._project_path = path

    # ------------------------------------------------------------------
    # 同步方法（快速，不阻塞）
    # ------------------------------------------------------------------

    def is_git_repo(self) -> bool:
        """检查是否为 git 仓库。"""
        return os.path.isdir(os.path.join(self._project_path, ".git"))

    @_cached()
    def get_tags(self) -> list[dict]:
        """获取所有 tags，按创建时间倒序。每条含 name / message。"""
        try:
            result = subprocess.run(
                ["git", "for-each-ref", "--sort=-creatordate",
                 "--format=%(refname:short)%00%(subject)", "refs/tags/"],
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
                    tags.append({"name": name, "message": message})
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

        self._fetch_gen += 1
        self._pending_op = "fetch"
        self._run_git(["fetch", "origin", "--tags"])
        return None

    def checkout_tag(self, tag: str) -> str | None:
        """异步 checkout 指定 tag。返回 None 表示启动成功。"""
        if not self.is_git_repo():
            return "不是有效的 git 仓库"

        self._pending_op = "checkout"
        self._run_git(["checkout", f"tags/{tag}"])
        return None

    def cancel(self):
        """取消当前操作。"""
        if self._proc and self._proc.state() != QProcess.NotRunning:
            self._proc.kill()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run_git(self, args: list[str]):
        if self._proc is not None:
            self._proc.kill()
            self._proc.deleteLater()

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

        git_exe = _find_git()
        self._proc.start(git_exe, args)

    def _on_stdout(self):
        data = self._proc.readAllStandardOutput()
        text = _decode_output(data.data())
        if text.strip():
            self.output.emit(text.strip())

    def _on_stderr(self):
        data = self._proc.readAllStandardError()
        text = _decode_output(data.data())
        if text.strip():
            self.output.emit(text.strip())
            # git 经常把正常消息写到 stderr (如 clone progress)
            # 我们仍然转发但标记为信息级别

    def _on_finished(self, exit_code, exit_status):
        # 忽略被 kill 的旧 QProcess 的 stale callback
        finished_gen = getattr(self, '_started_fetch_gen', 0)
        if self._pending_op == "fetch" and finished_gen != self._fetch_gen:
            # 这是上一个 fetch 进程的回调，已被新 fetch kill，忽略
            return

        ok = exit_code == 0 and exit_status == QProcess.NormalExit
        msg = "操作成功" if ok else f"操作失败 (exit code: {exit_code})"
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
    """查找 git.exe 的完整路径。QProcess 不像 subprocess 那样自动搜索 PATH。"""
    import shutil

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
