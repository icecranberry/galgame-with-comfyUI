"""
MaiBot 运行器 —— 管理 MaiBot 与 SnowLuma 两个外部服务进程。

目录结构（项目根目录下的一键包）:
  MaiBot-Container/
    MaiBot/            # MaiBot 本体（自带 python/ 便携环境）
      bot.py
    Snowluma/          # SnowLuma 连接器（自带 node.exe）
      index.mjs
    start.bat          # 独立启动脚本（用户也可手动双击）

两个服务端口:
  MaiBot    → 8001（后台页面 http://127.0.0.1:8001/）
  SnowLuma  → 5099（后台页面 http://127.0.0.1:5099/）
"""
import os
import re
import shutil

from PySide6.QtCore import QObject, QProcess, Signal, QThread, QTimer

from .service_runner import ServiceWorker, _decode_output, find_bundled_python

MAIBOT_PORT = 8001
SNOWLUMA_PORT = 5099


def maibot_root(project_path: str) -> str:
    return os.path.join(project_path, "MaiBot-Container")


def maibot_installed(project_path: str) -> bool:
    return os.path.isdir(maibot_root(project_path))


MAIBOT_SOURCE_DIR = os.path.join("MaiBot-Container", "MaiBot")
MAIBOT_VENV_PY = os.path.join(MAIBOT_SOURCE_DIR, ".venv", "Scripts", "python.exe")
MAIBOT_REQUIREMENTS = os.path.join(MAIBOT_SOURCE_DIR, "requirements.txt")
MAIBOT_EMBEDDED_PY = os.path.join(MAIBOT_SOURCE_DIR, "python", "python.exe")

_MAIBOT_DEPS_CHECK = (
    "import aiohttp, fastapi, numpy, pydantic, "
    "maim_message, maibot_dashboard, faiss, pyarrow, playwright"
)


def maibot_python(project_path: str) -> str | None:
    """优先使用 MaiBot 包内便携 Python，其次邻舍捆绑 Python，最后回退 venv。"""
    embedded = os.path.join(project_path, MAIBOT_EMBEDDED_PY)
    if os.path.isfile(embedded):
        return embedded
    bundled = find_bundled_python(project_path)
    if bundled:
        return bundled
    venv_py = os.path.join(project_path, MAIBOT_VENV_PY)
    if os.path.isfile(venv_py):
        return venv_py
    return None


def maibot_uv_available() -> bool:
    return shutil.which("uv") is not None


def maibot_launch_command(project_path: str) -> tuple[str | None, list[str]]:
    """返回 MaiBot 启动命令与参数；没有本地 Python 时用官方 uv 兜底。"""
    python_exe = maibot_python(project_path)
    if python_exe:
        return python_exe, ["bot.py"]
    if maibot_uv_available():
        return shutil.which("uv"), ["run", "python", "bot.py"]
    return None, ["bot.py"]


def maibot_source_dir(project_path: str) -> str:
    return os.path.join(project_path, MAIBOT_SOURCE_DIR)


def maibot_requirements(project_path: str) -> str:
    return os.path.join(project_path, MAIBOT_REQUIREMENTS)


def maibot_deps_ready(python_exe: str) -> bool:
    """快速检查 MaiBot 关键依赖是否已装入指定 Python。"""
    try:
        import subprocess as _sp
        _kwargs = {}
        if os.name == "nt":
            _kwargs["creationflags"] = getattr(_sp, "CREATE_NO_WINDOW", 0)
        result = _sp.run(
            [python_exe, "-c", _MAIBOT_DEPS_CHECK],
            capture_output=True,
            timeout=30,
            **_kwargs,
        )
        return result.returncode == 0
    except Exception:
        return False


def _maibot_services(project_path: str) -> dict:
    return {
        "maibot": {
            "name": "maibot",
            "display": "MaiBot",
            "port": MAIBOT_PORT,
            "health_path": "/",
            "cwd": MAIBOT_SOURCE_DIR,
            "get_cmd": lambda p: maibot_launch_command(p)[0],
            "get_args": lambda: maibot_launch_command(project_path)[1],
            "env": {"PYTHONUTF8": "1", "MAIBOT_WEBUI_USE_LOCAL_DASHBOARD": "1"},
        },
        "snowluma": {
            "name": "snowluma",
            "display": "SnowLuma",
            "port": SNOWLUMA_PORT,
            "health_path": "/",
            "cwd": os.path.join("MaiBot-Container", "Snowluma"),
            "get_cmd": lambda p: os.path.join(p, "MaiBot-Container", "Snowluma", "node.exe"),
            "get_args": lambda: ["index.mjs"],
        },
    }


# ── 输出清洗 ──

_ANSI_RE = re.compile(
    r"\x1b\[[0-9;?]*[ -/]*[@-~]"      # CSI 序列（颜色/光标控制）
    r"|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)"  # OSC 序列（窗口标题等）
)


def sanitize_output(text: str) -> str:
    """去掉 ANSI 颜色/控制序列，处理 \\r 覆盖行（进度条取最后一段）。"""
    text = _ANSI_RE.sub("", text)
    lines = []
    for seg in text.split("\n"):
        seg = seg.rstrip("\r")  # \r\n 拆分后的行尾残留
        if "\r" in seg:  # 行内 \r 覆盖（进度条）→ 取最后一段
            seg = seg.split("\r")[-1]
        lines.append(seg)
    return "\n".join(lines)


# ── 端口清理 ──

def kill_maibot_port_processes(project_path: str, report=None):
    """终止 8001/5099 端口上属于 MaiBot 一键包的残留进程（如手动跑过 start.bat）。

    report 为可选回调，接收一行描述文本。
    """
    try:
        import psutil
    except ImportError:
        return
    base = maibot_root(project_path).lower()
    runtime_base = os.path.join(project_path, "runtime", "python").lower()
    try:
        for conn in psutil.net_connections(kind="inet"):
            if conn.laddr.port not in (MAIBOT_PORT, SNOWLUMA_PORT):
                continue
            if conn.status != "LISTEN":
                continue
            try:
                proc = psutil.Process(conn.pid)
                if proc.name().lower() not in ("python.exe", "pythonw.exe", "node.exe"):
                    continue
                cmdline = " ".join(proc.cmdline()).lower()
                if base not in cmdline and runtime_base not in cmdline and "bot.py" not in cmdline:
                    continue
                proc.kill()
                if report:
                    report(
                        f"  已终止残留进程: {proc.name()} (PID {conn.pid}) "
                        f"on port {conn.laddr.port}"
                    )
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    except Exception:
        pass


class _PortCleaner(QObject):
    """在后台线程执行 psutil 端口清理，避免阻塞 GUI。"""

    output = Signal(str, str)
    finished = Signal()

    def __init__(self, project_path: str):
        super().__init__()
        self._project_path = project_path

    def run(self):
        kill_maibot_port_processes(self._project_path, report=self._report)
        self.finished.emit()

    def _report(self, text: str):
        self.output.emit("system", text)


class _MaiBotEnvCheckWorker(QObject):
    """后台线程执行 MaiBot 依赖检查，避免阻塞 GUI。"""

    result = Signal(bool)

    def __init__(self, python_exe: str):
        super().__init__()
        self._python_exe = python_exe

    def run(self):
        self.result.emit(maibot_deps_ready(self._python_exe))


class MaiBotRunner(QObject):
    """MaiBot + SnowLuma 双服务的启停与输出转发。"""

    output = Signal(str, str)                  # (service_key, text)
    status_changed = Signal(str, str, object)  # (service_key, status, pid)
    health_changed = Signal(str, bool)         # (service_key, healthy)
    all_stopped = Signal()

    def __init__(self, project_path: str, parent=None):
        super().__init__(parent)
        self._project_path = project_path
        self._workers: dict[str, ServiceWorker] = {}
        self._cleaner_thread: QThread | None = None

        for key, svc_def in _maibot_services(project_path).items():
            worker = ServiceWorker(svc_def, project_path, self)
            worker.output.connect(self._on_worker_output)
            worker.status_changed.connect(self._on_worker_status)
            worker.health_changed.connect(self.health_changed)
            self._workers[key] = worker

    @property
    def maibot_worker(self) -> ServiceWorker:
        return self._workers["maibot"]

    @property
    def snowluma_worker(self) -> ServiceWorker:
        return self._workers["snowluma"]

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def check_prerequisites(self) -> list[str]:
        """返回缺失项描述（空列表 = 可以启动）。"""
        missing = []
        source_dir = maibot_source_dir(self._project_path)
        bot_py = os.path.join(source_dir, "bot.py")
        if not os.path.isfile(bot_py):
            missing.append(f"MaiBot 源码缺失: {bot_py}")
        maibot_py = maibot_python(self._project_path)
        if not maibot_py and not maibot_uv_available():
            missing.append(
                "未找到可用 Python 或 uv：既没有 MaiBot 自带环境，也没有邻舍 runtime\\python 或系统 uv"
            )
        return missing

    def start_all(self) -> tuple[bool, list[str]]:
        """清理端口后并行启动两个服务。返回 (是否成功, 缺失项列表)。"""
        missing = self.check_prerequisites()
        if missing:
            for item in missing:
                self.output.emit("system", f"[ERROR] {item}")
            self.output.emit("system", "[ERROR] 请确认 MaiBot 一键包已完整解压，或重新下载安装")
            return False, missing

        if self.any_active():
            self.output.emit("system", "[!] MaiBot 服务已在运行中")
            return True, []

        self._cleaner_thread = QThread(self)
        self._cleaner = _PortCleaner(self._project_path)
        self._cleaner.moveToThread(self._cleaner_thread)
        self._cleaner.output.connect(self.output)
        self._cleaner_thread.started.connect(self._cleaner.run)
        self._cleaner.finished.connect(self._on_ports_cleaned)
        self._cleaner.finished.connect(self._cleaner_thread.quit)
        self._cleaner_thread.start()
        return True, []

    def stop_all(self):
        """停止两个服务，稍后连同子进程树一起补刀，防止孤儿进程残留端口。"""
        self._kill_install_process()
        any_stopping = False
        for worker in self._workers.values():
            if worker.status != ServiceWorker.STATUS_STOPPED:
                worker.stop()
                any_stopping = True
        if any_stopping:
            QTimer.singleShot(1500, self._kill_worker_trees)

    def force_kill_all(self):
        """立即强制清理（应用退出路径使用）。"""
        self._kill_install_process()
        for worker in self._workers.values():
            if worker.status != ServiceWorker.STATUS_STOPPED:
                worker._kill_process()
        self._kill_worker_trees()
        kill_maibot_port_processes(
            self._project_path,
            report=lambda t: self.output.emit("system", t),
        )

    def is_any_running(self) -> bool:
        return any(
            w.status == ServiceWorker.STATUS_RUNNING for w in self._workers.values()
        )

    def any_active(self) -> bool:
        """是否有进程仍存活或正在启停（ERROR/STOPPED 视为不活跃）。"""
        return any(
            w.status in (
                ServiceWorker.STATUS_STARTING,
                ServiceWorker.STATUS_RUNNING,
                ServiceWorker.STATUS_STOPPING,
            )
            for w in self._workers.values()
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _on_ports_cleaned(self):
        self.output.emit("system", "端口清理完成，正在启动 MaiBot 与 SnowLuma ...")
        if self._env_check_needed():
            self.output.emit("maibot", "[MaiBot] 正在检查依赖环境 ...")
            self._start_env_check()
        else:
            self._start_services()

    def _env_check_needed(self) -> bool:
        """是否需要后台检查 MaiBot 依赖（仅文件判断，不阻塞 GUI）。"""
        if not find_bundled_python(self._project_path):
            if not os.path.isfile(os.path.join(self._project_path, MAIBOT_EMBEDDED_PY)):
                return False
        python_exe = maibot_python(self._project_path)
        req = maibot_requirements(self._project_path)
        return bool(python_exe and os.path.isfile(req))

    def _start_env_check(self):
        python_exe = maibot_python(self._project_path)
        thread = QThread(self)
        worker = _MaiBotEnvCheckWorker(python_exe)
        worker.moveToThread(thread)
        thread.started.connect(worker.run)
        worker.result.connect(self._on_env_check_done)
        worker.result.connect(thread.quit)
        self._env_check_thread = thread
        self._env_check_worker = worker
        thread.start()

    def _on_env_check_done(self, ready: bool):
        if ready:
            self.output.emit("maibot", "[MaiBot] 依赖环境正常，正在启动 ...")
            self._start_services()
        else:
            self.output.emit(
                "maibot",
                "[MaiBot] 首次运行：正在向邻舍捆绑 Python 安装 MaiBot 依赖，请稍候 ...",
            )
            self._install_maibot_deps()

    def _install_maibot_deps(self):
        python_exe = maibot_python(self._project_path)
        req = maibot_requirements(self._project_path)
        if not python_exe or not os.path.isfile(req):
            self.output.emit("maibot", "[ERROR] [MaiBot] 缺少 Python 或 requirements.txt")
            self._workers["maibot"]._set_status(ServiceWorker.STATUS_ERROR)
            self.health_changed.emit("maibot", False)
            return
        proc = QProcess(self)
        self._install_cancelled = False
        env = proc.processEnvironment()
        env.insert("PYTHONUTF8", "1")
        env.insert("PYTHONUNBUFFERED", "1")
        for key in (
            "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP",
            "SystemRoot", "PATH", "APPDATA", "LOCALAPPDATA",
        ):
            if key in os.environ and key not in env.keys():
                env.insert(key, os.environ[key])
        proc.setProcessEnvironment(env)
        proc.setWorkingDirectory(maibot_source_dir(self._project_path))
        proc.setProcessChannelMode(QProcess.SeparateChannels)
        proc.readyReadStandardOutput.connect(self._on_install_stdout)
        proc.readyReadStandardError.connect(self._on_install_stderr)
        proc.finished.connect(self._on_install_finished)
        self._install_proc = proc
        self._workers["maibot"]._set_status(ServiceWorker.STATUS_STARTING)
        self.status_changed.emit("maibot", ServiceWorker.STATUS_STARTING, None)
        proc.start(
            python_exe,
            [
                "-m", "pip", "install", "-r", req,
                "-i", "https://pypi.tuna.tsinghua.edu.cn/simple",
                "--trusted-host", "pypi.tuna.tsinghua.edu.cn",
            ],
        )

    def _on_install_stdout(self):
        if self._install_proc:
            self._forward_install_output(self._install_proc.readAllStandardOutput())

    def _on_install_stderr(self):
        if self._install_proc:
            self._forward_install_output(self._install_proc.readAllStandardError())

    def _forward_install_output(self, data):
        text = _decode_output(data.data())
        if text.strip():
            self.output.emit("maibot", f"[MaiBot] {text.strip()}")

    def _on_install_finished(self, exit_code, exit_status):
        self._install_proc = None
        if getattr(self, "_install_cancelled", False):
            self._install_cancelled = False
            self._workers["maibot"]._set_status(ServiceWorker.STATUS_STOPPED)
            self.health_changed.emit("maibot", False)
            return
        if exit_code == 0 and exit_status == QProcess.NormalExit:
            self.output.emit("maibot", "[MaiBot] 依赖安装完成，正在启动 ...")
            self._start_services()
        else:
            self.output.emit(
                "maibot",
                f"[ERROR] [MaiBot] 依赖安装失败 (code: {exit_code})，请检查网络后重试",
            )
            self._workers["maibot"]._set_status(ServiceWorker.STATUS_ERROR)
            self.status_changed.emit("maibot", ServiceWorker.STATUS_ERROR, None)
            self.health_changed.emit("maibot", False)

    def _start_services(self):
        self._workers["maibot"].start()
        self._workers["snowluma"].start()

    def _on_worker_output(self, name: str, text: str):
        text = sanitize_output(text)
        if text.strip():
            self.output.emit(name, text)

    def _on_worker_status(self, name: str, status: str):
        worker = self._workers[name]
        self.status_changed.emit(name, status, worker.pid)
        if all(
            w.status == ServiceWorker.STATUS_STOPPED for w in self._workers.values()
        ):
            self.all_stopped.emit()

    def _kill_worker_trees(self):
        """psutil 连同子进程一起终止（bot.py 可能派生子进程）。"""
        self._kill_install_process()
        try:
            import psutil
        except ImportError:
            return
        for worker in self._workers.values():
            pid = worker.pid
            if not pid:
                continue
            try:
                proc = psutil.Process(pid)
                if proc.is_running():
                    for child in proc.children(recursive=True):
                        try:
                            child.kill()
                        except psutil.Error:
                            pass
                    proc.kill()
            except psutil.Error:
                pass

    def _kill_install_process(self):
        proc = getattr(self, "_install_proc", None)
        if proc and proc.state() != QProcess.NotRunning:
            self._install_cancelled = True
            proc.kill()
