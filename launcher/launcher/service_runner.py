"""
服务运行器 —— 管理 2 个生产服务进程（vector-service + agent-core）。
包括端口清理、启动、健康检查、优雅停止。
"""
import os
import sys
import time
from PySide6.QtCore import QObject, Signal, QProcess, QTimer
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkRequest, QNetworkReply
from PySide6.QtCore import QUrl


# 服务定义
SERVICES = {
    "vector": {
        "name": "vector",
        "display": "向量服务",
        "port": 8765,
        "health_path": "/health",
        "cwd": "vector-service",
        "get_cmd": lambda project_path: _venv_python(project_path),
        "get_args": lambda: [
            "-m",
            "uvicorn",
            "server:app",
            "--host",
            "0.0.0.0",
            "--port",
            "8765",
        ],
    },
    "agent_core": {
        "name": "agent_core",
        "display": "主控后端",
        "port": 3099,
        "health_path": "/api/health",
        "shutdown_path": "/api/shutdown",
        "cwd": "agent-core",
        "get_cmd": lambda _: "node.exe" if sys.platform == "win32" else "node",
        "get_args": lambda: ["app.js"],
    },
}


def _venv_python(project_path: str) -> str:
    """获取 vector-service venv 中的 python 路径。"""
    venv_py = os.path.join(project_path, "vector-service", "venv", "Scripts", "python.exe")
    if os.path.exists(venv_py):
        return venv_py
    return sys.executable  # fallback


class ServiceWorker(QObject):
    """单个服务的 QProcess 包装。"""

    output = Signal(str, str)  # (service_name, text)
    status_changed = Signal(str, str)  # (service_name, status)
    health_changed = Signal(str, bool)  # (service_name, healthy)

    STATUS_STOPPED = "stopped"
    STATUS_STARTING = "starting"
    STATUS_RUNNING = "running"
    STATUS_STOPPING = "stopping"
    STATUS_ERROR = "error"
    STATUS_TIMEOUT = "timeout"

    def __init__(self, svc_def: dict, project_path: str, parent=None):
        super().__init__(parent)
        self._def = svc_def
        self._project_path = project_path
        self._proc: QProcess | None = None
        self._status = self.STATUS_STOPPED
        self._pid: int | None = None

    @property
    def name(self) -> str:
        return self._def["name"]

    @property
    def display(self) -> str:
        return self._def["display"]

    @property
    def port(self) -> int:
        return self._def["port"]

    @property
    def status(self) -> str:
        return self._status

    @property
    def pid(self) -> int | None:
        return self._pid

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def start(self):
        self._set_status(self.STATUS_STARTING)
        self._launch_process()

    def stop(self):
        was_running = self._status == self.STATUS_RUNNING
        self._set_status(self.STATUS_STOPPING)

        shutdown_url = self._def.get("shutdown_path")
        if shutdown_url and was_running:
            self._graceful_shutdown(shutdown_url)
        else:
            self._kill_process()

    # ------------------------------------------------------------------
    # Internal — Launch
    # ------------------------------------------------------------------

    def _launch_process(self):
        self._proc = QProcess(self)
        cwd = os.path.join(self._project_path, self._def["cwd"])

        # 以系统环境为底，补全关键变量（尤其是 chromadb 需要的 HOME/USERPROFILE）
        env = self._proc.processEnvironment()
        env.insert("PYTHONUNBUFFERED", "1")
        env.insert("NODE_ENV", "production")
        # 确保路径和用户目录变量存在
        for _key in ("USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP",
                      "SystemRoot", "PATH", "APPDATA", "LOCALAPPDATA"):
            if _key in os.environ and _key not in env.keys():
                env.insert(_key, os.environ[_key])
        self._proc.setProcessEnvironment(env)

        self._proc.setWorkingDirectory(cwd)
        self._proc.setProcessChannelMode(QProcess.SeparateChannels)
        self._proc.readyReadStandardOutput.connect(self._on_stdout)
        self._proc.readyReadStandardError.connect(self._on_stderr)
        self._proc.finished.connect(self._on_finished)

        cmd = self._def["get_cmd"](self._project_path)
        args = self._def["get_args"]()

        self.output.emit(self.name, f"[{self.display}] 启动: {cmd} {' '.join(args)}")
        self._proc.start(cmd, args)

        if self._proc.processId():
            self._pid = self._proc.processId()
            # 开始健康检查轮询
            self._health_retries = 0
            self._health_max_retries = 30  # 最多 60s (2s × 30)
            QTimer.singleShot(2000, self._health_check)
        else:
            self._set_status(self.STATUS_ERROR)
            self.output.emit(self.name, f"[ERROR] [{self.display}] 无法启动进程")

    def _health_check(self):
        if self._status not in (self.STATUS_STARTING,):
            return

        self._health_retries += 1
        url = f"http://localhost:{self.port}{self._def['health_path']}"

        # 用简单的 socket 检测更可靠
        import socket

        try:
            s = socket.create_connection(("localhost", self.port), timeout=2)
            s.close()
            # 端口已监听 → 认为 healthy
            self._set_status(self.STATUS_RUNNING)
            self.health_changed.emit(self.name, True)
            self.output.emit(self.name, f"[{self.display}] ✓ :{self.port} healthy")
            return
        except (socket.error, OSError):
            pass

        if self._health_retries >= self._health_max_retries:
            self.output.emit(self.name, f"[WARN] [{self.display}] 健康检查超时，但进程仍在运行")
            self._set_status(self.STATUS_TIMEOUT)
            return

        QTimer.singleShot(2000, self._health_check)

    # ------------------------------------------------------------------
    # Internal — Stop
    # ------------------------------------------------------------------

    def _graceful_shutdown(self, shutdown_path: str):
        """POST /api/shutdown 优雅关闭。"""
        import urllib.request

        url = f"http://localhost:{self.port}{shutdown_path}"
        try:
            urllib.request.urlopen(f"http://localhost:{self.port}{shutdown_path}", data=b"", timeout=3)
            self.output.emit(self.name, f"[{self.display}] 已发送关闭请求")
        except Exception:
            pass

        # 等待 3 秒后强制 kill
        QTimer.singleShot(3000, self._kill_process)

    def _kill_process(self):
        if self._proc and self._proc.state() != QProcess.NotRunning:
            self._proc.terminate()
            if not self._proc.waitForFinished(3000):
                self._proc.kill()
                self._proc.waitForFinished(2000)
        self._pid = None
        self._set_status(self.STATUS_STOPPED)
        self.health_changed.emit(self.name, False)

    # ------------------------------------------------------------------
    # Internal — Output
    # ------------------------------------------------------------------

    def _on_stdout(self):
        if self._proc:
            data = self._proc.readAllStandardOutput()
            text = _decode_output(data.data())
            if text.strip():
                self.output.emit(self.name, f"[{self.display}] {text.strip()}")

    def _on_stderr(self):
        if self._proc:
            data = self._proc.readAllStandardError()
            text = _decode_output(data.data())
            if text.strip():
                self.output.emit(self.name, f"[{self.display}] {text.strip()}")

    def _on_finished(self, exit_code, exit_status):
        self._pid = None
        if self._status == self.STATUS_STOPPING:
            self._set_status(self.STATUS_STOPPED)
        else:
            # 意外退出
            self._set_status(self.STATUS_ERROR)
            self.output.emit(self.name, f"[ERROR] [{self.display}] 意外退出 (code: {exit_code})")
        self.health_changed.emit(self.name, False)

    # ------------------------------------------------------------------
    # Internal — Status
    # ------------------------------------------------------------------

    def _set_status(self, status: str):
        if self._status != status:
            self._status = status
            self.status_changed.emit(self.name, status)


class ServiceRunner(QObject):
    """管理 2 个服务的启停和端口清理。"""

    status_summary = Signal(str, str, str)  # (vector_status, agent_status, overall)
    output = Signal(str, str)  # (service_name, text) — 转发给日志

    def __init__(self, project_path: str, parent=None):
        super().__init__(parent)
        self._project_path = project_path
        self._workers: dict[str, ServiceWorker] = {}

        for key, svc_def in SERVICES.items():
            worker = ServiceWorker(svc_def, project_path, self)
            worker.output.connect(self.output)
            worker.status_changed.connect(self._on_worker_status)
            self._workers[key] = worker

    @property
    def vector_worker(self) -> ServiceWorker:
        return self._workers["vector"]

    @property
    def agent_worker(self) -> ServiceWorker:
        return self._workers["agent_core"]

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def set_project_path(self, path: str):
        self._project_path = path

    def start_all(self):
        """顺序启动：先端口清理 → vector → agent_core。"""
        self.output.emit("system", "正在清理端口...")
        self._kill_port_processes()

        # 先启 vector
        self._workers["vector"].start()

        # vector 健康后启 agent_core
        def on_vector_healthy(name, is_healthy):
            if is_healthy and name == "vector":
                self._workers["vector"].health_changed.disconnect(on_vector_healthy)
                self._workers["agent_core"].start()

        self._workers["vector"].health_changed.connect(on_vector_healthy)

        # 如果 vector 已经超时/失败，仍然尝试启动 agent_core
        def on_vector_status(name, status):
            if name == "vector" and status in (
                ServiceWorker.STATUS_TIMEOUT,
                ServiceWorker.STATUS_ERROR,
            ):
                self._workers["vector"].status_changed.disconnect(on_vector_status)
                self.output.emit("system", "[!] 向量服务启动异常，继续启动主控后端...")
                self._workers["agent_core"].start()

        self._workers["vector"].status_changed.connect(on_vector_status)

    def stop_all(self):
        """优雅停止：agent_core 先 stop → vector 后 stop。"""
        self._workers["agent_core"].stop()

        def on_agent_done(name, status):
            if name == "agent_core" and status == ServiceWorker.STATUS_STOPPED:
                self._workers["agent_core"].status_changed.disconnect(on_agent_done)
                self._workers["vector"].stop()

        self._workers["agent_core"].status_changed.connect(on_agent_done)

        # 如果 agent_core 已经停了就直接停 vector
        if self._workers["agent_core"].status == ServiceWorker.STATUS_STOPPED:
            self._workers["vector"].stop()

        # 兜底：10s 后强制清理
        self._stop_timer = QTimer(self)
        self._stop_timer.setSingleShot(True)
        self._stop_timer.timeout.connect(self._force_kill_all)
        self._stop_timer.start(10000)

        # 当所有服务停止后取消兜底定时器
        def on_all_stopped(vs, acs, overall):
            if overall == "all_stopped":
                if hasattr(self, "_stop_timer") and self._stop_timer:
                    self._stop_timer.stop()
                self.status_summary.disconnect(on_all_stopped)

        self.status_summary.connect(on_all_stopped)

    def _force_kill_all(self):
        if hasattr(self, "_stop_timer") and self._stop_timer:
            self._stop_timer.stop()
        for w in self._workers.values():
            if w.status not in (ServiceWorker.STATUS_STOPPED,):
                w._kill_process()
        self._kill_port_processes()

    def is_any_running(self) -> bool:
        return any(
            w.status == ServiceWorker.STATUS_RUNNING for w in self._workers.values()
        )

    def is_all_running(self) -> bool:
        return all(
            w.status == ServiceWorker.STATUS_RUNNING for w in self._workers.values()
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _on_worker_status(self, name: str, status: str):
        v = self._workers["vector"].status
        a = self._workers["agent_core"].status

        if status == ServiceWorker.STATUS_RUNNING and self.is_all_running():
            self.status_summary.emit(v, a, "all_running")
            self.output.emit("system", "🎉 全部启动完成")
        elif all(
            s == ServiceWorker.STATUS_STOPPED for s in [v, a]
        ):
            self.status_summary.emit(v, a, "all_stopped")
        else:
            self.status_summary.emit(v, a, "partial")

    def _kill_port_processes(self):
        """杀死 3099 和 8765 端口上残留的项目进程。"""
        try:
            import psutil

            ports = [SERVICES[s]["port"] for s in SERVICES]
            keywords = [
                "agent-core", "vector-service", "web-ui",
                "app.js", "server:app", "uvicorn", "nodemon",
            ]
            for conn in psutil.net_connections(kind="inet"):
                if conn.laddr.port in ports and conn.status == "LISTEN":
                    try:
                        proc = psutil.Process(conn.pid)
                        name = proc.name().lower()
                        if name in ("node.exe", "python.exe"):
                            cmdline = " ".join(proc.cmdline()).lower()
                            if any(kw.lower() in cmdline for kw in keywords):
                                proc.kill()
                                self.output.emit(
                                    "system",
                                    f"  已终止残留进程: {proc.name()} (PID {conn.pid}) on port {conn.laddr.port}",
                                )
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
        except Exception:
            pass  # psutil 不可用时静默跳过
        self.output.emit("system", "端口清理完成")


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
