"""
构建管理器 —— 顺序执行构建流水线（npm install ×2, vite build, venv setup, model download）。
"""
import os
import sys
from PySide6.QtCore import QObject, Signal, QProcess


class BuildManager(QObject):
    """管理首次安装和版本切换后的重新构建。"""

    # 信号
    step_changed = Signal(str)  # 当前步骤名
    output = Signal(str)  # 构建输出
    build_done = Signal(bool, str)  # (success, message)

    def __init__(self, project_path: str, parent=None):
        super().__init__(parent)
        self._project_path = project_path
        self._steps: list[dict] = []
        self._current_idx = 0
        self._proc: QProcess | None = None
        self._cancelled = False

    @property
    def project_path(self) -> str:
        return self._project_path

    def set_project_path(self, path: str):
        self._project_path = path

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def is_built(self) -> bool:
        """快速检查关键构建产物是否存在。"""
        return all(
            [
                os.path.isdir(os.path.join(self._project_path, "agent-core", "node_modules")),
                os.path.isfile(os.path.join(self._project_path, "agent-core", "public", "index.html")),
                os.path.isdir(os.path.join(self._project_path, "vector-service", "venv")),
            ]
        )

    def start_build(self, force: bool = False) -> str | None:
        """启动构建流水线。返回 None 表示成功启动，否则返回错误信息。"""
        if not force and self.is_built():
            self.build_done.emit(True, "已构建，跳过")
            return None

        self._cancelled = False
        self._current_idx = -1

        # 构建步骤定义
        node_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
        python_cmd = sys.executable
        venv_pip = os.path.join(
            self._project_path, "vector-service", "venv", "Scripts", "pip.exe"
        )
        venv_python = os.path.join(
            self._project_path, "vector-service", "venv", "Scripts", "python.exe"
        )

        self._steps = [
            {
                "name": "安装 agent-core 依赖",
                "cwd": os.path.join(self._project_path, "agent-core"),
                "cmd": node_cmd,
                "args": ["install"],
                "timeout": 120000,
            },
            {
                "name": "安装 web-ui 依赖",
                "cwd": os.path.join(self._project_path, "web-ui"),
                "cmd": node_cmd,
                "args": ["install"],
                "timeout": 120000,
            },
            {
                "name": "构建前端 (vite build)",
                "cwd": os.path.join(self._project_path, "web-ui"),
                "cmd": node_cmd,
                "args": ["run", "build"],
                "timeout": 60000,
            },
            {
                "name": "创建 Python 虚拟环境",
                "cwd": os.path.join(self._project_path, "vector-service"),
                "cmd": python_cmd,
                "args": ["-m", "venv", "venv"],
                "timeout": 30000,
                "skip_if": lambda: os.path.isdir(
                    os.path.join(self._project_path, "vector-service", "venv")
                ),
            },
            {
                "name": "安装 Python 依赖",
                "cwd": os.path.join(self._project_path, "vector-service"),
                "cmd": venv_pip,
                "args": ["install", "-r", "requirements.txt"],
                "timeout": 180000,
            },
            {
                "name": "下载嵌入模型 (~155MB)",
                "cwd": os.path.join(self._project_path, "vector-service"),
                "cmd": venv_python,
                "args": ["download_model.py"],
                "timeout": 300000,
            },
        ]

        self._check_env_file()
        self._run_next_step()
        return None

    def cancel(self):
        self._cancelled = True
        if self._proc and self._proc.state() != QProcess.NotRunning:
            self._proc.kill()
            self._proc.waitForFinished(2000)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _check_env_file(self):
        """首次安装时自动复制 .env.example → .env。"""
        env_path = os.path.join(self._project_path, "agent-core", ".env")
        env_example = os.path.join(self._project_path, "agent-core", ".env.example")
        if not os.path.exists(env_path) and os.path.exists(env_example):
            try:
                import shutil

                shutil.copy2(env_example, env_path)
                self.output.emit("[!] 已创建 agent-core/.env，请编辑填入 LLM_API_KEY")
            except OSError:
                self.output.emit("[ERROR] 无法创建 .env 文件，请手动复制 .env.example")

    def _run_next_step(self):
        self._current_idx += 1

        if self._cancelled or self._current_idx >= len(self._steps):
            if self._cancelled:
                self.build_done.emit(False, "构建已取消")
            else:
                self.step_changed.emit("✓ 构建完成")
                self.build_done.emit(True, "构建完成")
            self._proc = None
            return

        step = self._steps[self._current_idx]

        # 跳过条件
        skip_if = step.get("skip_if")
        if skip_if and skip_if():
            self.output.emit(f"[构建] 跳过: {step['name']} (已存在)")
            self._run_next_step()
            return

        self.step_changed.emit(step["name"])
        self.output.emit(f"[构建] {step['name']}...")

        self._proc = QProcess(self)
        self._proc.setWorkingDirectory(step["cwd"])
        self._proc.setProcessChannelMode(QProcess.SeparateChannels)
        self._proc.readyReadStandardOutput.connect(self._on_stdout)
        self._proc.readyReadStandardError.connect(self._on_stderr)
        self._proc.finished.connect(self._on_step_finished)

        # 设置环境变量确保 UTF-8 输出 + 路径不丢失
        env = self._proc.processEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        env.insert("FORCE_COLOR", "0")
        for _key in ("USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP",
                      "SystemRoot", "PATH", "APPDATA", "LOCALAPPDATA"):
            if _key in os.environ and _key not in env.keys():
                env.insert(_key, os.environ[_key])
        self._proc.setProcessEnvironment(env)

        self._proc.start(step["cmd"], step["args"])

        # 超时保护
        timeout = step.get("timeout", 60000)
        from PySide6.QtCore import QTimer

        self._timeout_timer = QTimer(self)
        self._timeout_timer.setSingleShot(True)
        self._timeout_timer.timeout.connect(self._on_step_timeout)
        self._timeout_timer.start(timeout)

    def _on_stdout(self):
        data = self._proc.readAllStandardOutput()
        text = _decode_output(data.data())
        if text.strip():
            self.output.emit(text.strip())

    def _on_stderr(self):
        data = self._proc.readAllStandardError()
        text = _decode_output(data.data())
        if text.strip():
            self.output.emit(f"[warn] {text.strip()}")

    def _on_step_timeout(self):
        if self._proc and self._proc.state() != QProcess.NotRunning:
            self._proc.kill()
            self._proc.waitForFinished(2000)
            step = self._steps[self._current_idx]
            self.output.emit(f"[ERROR] 步骤超时: {step['name']}")
            self.build_done.emit(False, f"超时: {step['name']}")

    def _on_step_finished(self, exit_code, exit_status):
        if hasattr(self, "_timeout_timer"):
            self._timeout_timer.stop()

        step = self._steps[self._current_idx]
        ok = exit_code == 0 and exit_status == QProcess.NormalExit

        if ok:
            self.output.emit(f"[构建] ✓ {step['name']} 完成")
            self._run_next_step()
        else:
            self.output.emit(f"[ERROR] {step['name']} 失败 (exit: {exit_code})")
            self.build_done.emit(False, f"失败: {step['name']}")
            self._proc = None


# ------------------------------------------------------------------
# Helper
# ------------------------------------------------------------------


def _decode_output(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return data.decode("gbk")
        except UnicodeDecodeError:
            return data.decode("utf-8", errors="replace")
