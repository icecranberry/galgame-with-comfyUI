"""
Git 管理器 —— 封装 git CLI 调用，所有耗时操作通过 QProcess 异步执行。
"""
import os
import re
from PySide6.QtCore import QObject, Signal, QProcess


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

    def get_tags(self) -> list[str]:
        """获取所有 tags，按创建时间倒序。"""
        import subprocess

        try:
            result = subprocess.run(
                ["git", "tag", "--sort=-creatordate"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                return [t.strip() for t in result.stdout.splitlines() if t.strip()]
        except Exception:
            pass
        return []

    def get_current_tag(self) -> str | None:
        """获取 HEAD 对应的 tag 名（精确匹配），不在 tag 上则返回 None。"""
        import subprocess

        try:
            result = subprocess.run(
                ["git", "describe", "--tags", "--exact-match", "--abbrev=0"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return None

    def get_current_branch(self) -> str:
        """获取当前分支名。"""
        import subprocess

        try:
            result = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return "unknown"

    def get_latest_remote_tag(self) -> str | None:
        """获取远程最新 tag（需要先 fetch）。"""
        tags = self.get_tags()
        # 过滤出远程存在的 tags（在 origin 上）
        import subprocess

        try:
            result = subprocess.run(
                ["git", "ls-remote", "--tags", "--sort=-creatordate", "origin"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=15,
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

        self._proc.start("git", args)

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
