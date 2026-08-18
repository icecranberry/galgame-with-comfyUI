"""
MaiBot 运行器 —— 管理 MaiBot 与 SnowLuma 两个外部服务进程。

目录结构（项目根目录下的一键包）:
  MaiBot-Container/
    MaiBot/            # MaiBot 本体（自带 .venv）
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

from PySide6.QtCore import QObject, Signal, QThread, QTimer

from .service_runner import ServiceWorker

MAIBOT_PORT = 8001
SNOWLUMA_PORT = 5099


def maibot_root(project_path: str) -> str:
    return os.path.join(project_path, "MaiBot-Container")


def maibot_installed(project_path: str) -> bool:
    return os.path.isdir(maibot_root(project_path))


def _maibot_services() -> dict:
    return {
        "maibot": {
            "name": "maibot",
            "display": "MaiBot",
            "port": MAIBOT_PORT,
            "health_path": "/",
            "cwd": os.path.join("MaiBot-Container", "MaiBot"),
            "get_cmd": lambda p: os.path.join(
                p, "MaiBot-Container", "MaiBot", ".venv", "Scripts", "python.exe"
            ),
            "get_args": lambda: ["bot.py"],
            "env": {"PYTHONUTF8": "1"},
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
                if base not in " ".join(proc.cmdline()).lower():
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

        for key, svc_def in _maibot_services().items():
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
        maibot_py = self._workers["maibot"]._def["get_cmd"](self._project_path)
        if not os.path.isfile(maibot_py):
            missing.append(f"MaiBot 环境缺失: {maibot_py}")
        snowluma_node = self._workers["snowluma"]._def["get_cmd"](self._project_path)
        if not os.path.isfile(snowluma_node):
            missing.append(f"SnowLuma 缺失: {snowluma_node}")
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
        any_stopping = False
        for worker in self._workers.values():
            if worker.status != ServiceWorker.STATUS_STOPPED:
                worker.stop()
                any_stopping = True
        if any_stopping:
            QTimer.singleShot(1500, self._kill_worker_trees)

    def force_kill_all(self):
        """立即强制清理（应用退出路径使用）。"""
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
