"""
构建管理器 —— 顺序执行构建流水线（env check → npm install ×2 → vite build → venv setup → model download）。
"""
import os
import shutil
import sys
from PySide6.QtCore import QObject, Signal, QProcess, QTimer
from PySide6.QtWidgets import QApplication
from .env_manager import EnvManager


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
        self._env_mgr = EnvManager(self)
        self._env_mgr.output.connect(self.output.emit)
        self._tool_path_overrides: dict[str, str] = {}
        self.use_mirror: bool = True   # 由外部设置

    @property
    def project_path(self) -> str:
        return self._project_path

    def set_project_path(self, path: str):
        self._project_path = path

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def is_built(self) -> bool:
        """快速检查关键构建产物是否存在（验证真实安装，非仅目录存在）。"""
        node_modules = os.path.join(self._project_path, "agent-core", "node_modules")
        return all(
            [
                # 验证 express 真实安装，防止 npm install 中途失败导致目录存在但包缺失
                os.path.isdir(os.path.join(node_modules, "express")),
                os.path.isfile(os.path.join(self._project_path, "agent-core", "public", "index.html")),
                os.path.isdir(os.path.join(self._project_path, "vector-service", "venv")),
            ]
        )

    def start_build(self, force: bool = False) -> str | None:
        """启动构建流水线。返回 None 表示成功启动，否则返回错误信息。"""
        if not force and self.is_built():
            self.build_done.emit(True, "已构建，跳过")
            return None

        try:
            self._cancelled = False
            self._current_idx = -1
            self._tool_path_overrides.clear()

            # 跳过环境检测（os.path.isdir 在 Windows 特殊目录上可能阻塞）
            # 工具缺失时，后续 QProcess 启动会自然报错，信息更明确
            self.output.emit("准备构建步骤...")
            QApplication.processEvents()
            env_steps: list[dict] = []

            # 生成项目构建步骤
            try:
                build_steps = self._build_build_steps()
                self.output.emit(f"共 {len(build_steps)} 个步骤，开始执行...")
                QApplication.processEvents()
            except Exception as e:
                self.output.emit(f"[ERROR] 构建步骤生成异常: {e}")
                import traceback
                traceback.print_exc()
                build_steps = []

            self._steps = build_steps

            self._check_env_file()

            QTimer.singleShot(0, self._run_next_step)
        except Exception as e:
            self.output.emit(f"[ERROR] start_build 异常: {e}")
            import traceback
            traceback.print_exc()
        return None

    # ------------------------------------------------------------------
    # 环境检测与自动安装
    # ------------------------------------------------------------------

    def _build_env_steps(self) -> list[dict]:
        """检测系统依赖，为缺失的工具生成 winget 安装步骤。"""
        steps: list[dict] = []

        # winget 检测：只查已知路径，不调用任何可能阻塞的操作
        try:
            winget_ok = self._env_mgr.is_winget_available()
        except Exception:
            winget_ok = False
        if not winget_ok:
            self.output.emit("[env] ⚠ winget 不可用，将跳过自动安装")

        for tool_key in ("node", "python", "git"):
            info = self._env_mgr.TOOLS[tool_key]
            try:
                available = self._env_mgr.is_tool_available(tool_key)
            except Exception as e:
                self.output.emit(f"[env] ⚠ 检查 {info['display']} 时出错: {e}")
                available = False

            if available:
                self.output.emit(f"[env] ✓ {info['display']} 已就绪")
            elif winget_ok:
                self.output.emit(
                    f"[env] ➜ {info['display']} 未安装，正在通过 winget 安装..."
                )
                steps.append(self._env_mgr.get_install_step(tool_key))
            else:
                self.output.emit(
                    f"[ERROR] ❌ {info['display']} 未安装，请手动安装"
                )
                self.output.emit(
                    f"[ERROR]     winget install {info['winget_id']}"
                )

        return steps

    # ------------------------------------------------------------------
    # 项目构建步骤
    # ------------------------------------------------------------------

    def _build_build_steps(self) -> list[dict]:
        """生成项目构建步骤（npm install ×2, vite build, venv, pip, model）。"""
        # npm: 优先用 tool_path_overrides 中的路径，否则让 QProcess 从 PATH 查找
        node_dir = self._tool_path_overrides.get("node")
        if node_dir and os.path.isfile(os.path.join(node_dir, "npm.cmd")):
            node_cmd = os.path.join(node_dir, "npm.cmd")
        else:
            node_cmd = "npm.cmd"  # QProcess 会自行在 PATH 中查找

        # python: 优先用 winget 安装路径，否则让 QProcess 从 PATH 查找
        # 绝不使用 sys.executable 兜底（PyInstaller 打包后是启动器自身）
        py_dir = self._tool_path_overrides.get("python")
        if py_dir and os.path.isfile(os.path.join(py_dir, "python.exe")):
            python_cmd = os.path.join(py_dir, "python.exe")
        elif not getattr(sys, "frozen", False):
            python_cmd = sys.executable  # 开发环境可以用
        else:
            python_cmd = "python.exe"  # 让 QProcess 在 PATH 上查找
        venv_pip = os.path.join(
            self._project_path, "vector-service", "venv", "Scripts", "pip.exe"
        )
        venv_python = os.path.join(
            self._project_path, "vector-service", "venv", "Scripts", "python.exe"
        )

        # npm install 参数：跳过审计和赞助商列表以加速
        _npm_args = ["install", "--no-audit", "--no-fund"]
        if self.use_mirror:
            _npm_args.append("--registry=https://registry.npmmirror.com")

        return [
            {
                "name": "安装 agent-core 依赖（首次约 3-8 分钟）",
                "cwd": os.path.join(self._project_path, "agent-core"),
                "cmd": node_cmd,
                "args": _npm_args,
                "timeout": 600000,
            },
            {
                "name": "安装 web-ui 依赖（首次约 2-5 分钟）",
                "cwd": os.path.join(self._project_path, "web-ui"),
                "cmd": node_cmd,
                "args": _npm_args,
                "timeout": 600000,
            },
            {
                "name": "构建前端 (vite build)",
                "cwd": os.path.join(self._project_path, "web-ui"),
                "cmd": node_cmd,
                "args": ["run", "build"],
                "timeout": 120000,
            },
            {
                "name": "创建 Python 虚拟环境",
                "cwd": os.path.join(self._project_path, "vector-service"),
                "cmd": python_cmd,
                "args": ["-m", "venv", "venv"],
                "timeout": 60000,
                "skip_if": lambda: os.path.isdir(
                    os.path.join(self._project_path, "vector-service", "venv")
                ),
            },
            {
                "name": "安装 Python 依赖（首次约 1-3 分钟）",
                "cwd": os.path.join(self._project_path, "vector-service"),
                "cmd": venv_pip,
                "args": ["install", "-r", "requirements.txt"]
                        + (["-i", "https://pypi.tuna.tsinghua.edu.cn/simple"] if self.use_mirror else []),
                "timeout": 300000,
            },
            {
                "name": "下载嵌入模型 (~155MB)",
                "cwd": os.path.join(self._project_path, "vector-service"),
                "cmd": venv_python,
                "args": ["download_model.py"],
                "timeout": 600000,
            },
        ]

    def _resolve_tool_path(self, tool_key: str, default: str, binary: str | None = None) -> str:
        """解析工具路径。若 winget 安装后记录过路径，则拼接绝对路径；否则返回默认值。"""
        override_dir = self._tool_path_overrides.get(tool_key)
        if override_dir:
            target = binary if binary else os.path.basename(default)
            resolved = os.path.join(override_dir, target)
            if os.path.isfile(resolved):
                return resolved
        return default

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
            self.output.emit(f"跳过: {step['name']} (已存在)")
            self._run_next_step()
            return

        self.step_changed.emit(step["name"])
        self.output.emit(f"{step['name']}...")
        QApplication.processEvents()  # 强制渲染步骤标题

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

        # 安装后路径发现（winget 安装后 PATH 可能未刷新）
        tool_key = step.get("_tool_key")
        if tool_key and ok:
            install_dir = self._env_mgr.find_tool_dir(tool_key)
            if install_dir:
                self._tool_path_overrides[tool_key] = install_dir
                info = self._env_mgr.TOOLS[tool_key]
                self.output.emit(
                    f"[env] ✓ {info['display']} 已安装: {install_dir}"
                )
            else:
                self.output.emit(
                    f"[WARN] {self._env_mgr.TOOLS[tool_key]['display']} "
                    "安装完成但未找到二进制文件，后续步骤可能失败"
                )

        if ok:
            self.output.emit(f"✓ {step['name']} 完成")
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
