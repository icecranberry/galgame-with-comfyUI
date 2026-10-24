"""AstrBot isolated source installation and owned-process lifecycle."""
import os
import shutil
from pathlib import Path

from PySide6.QtCore import QObject, Signal, QProcess, QProcessEnvironment, QTimer
from .service_runner import ServiceWorker, find_bundled_git, _resolve_python
from .maibot_runner import sanitize_output

ASTRBOT_VERSION = 'v4.29.1'
ASTRBOT_PORT = 6185
ASTRBOT_ADMIN_URL = f'http://127.0.0.1:{ASTRBOT_PORT}/'


class AstrbotWorker(ServiceWorker):
    """Wait for QProcess.started before beginning HTTP health checks."""
    def _launch_process(self):
        proc = QProcess(self)
        self._proc = proc
        proc.setWorkingDirectory(str(astrbot_root(self._project_path)))
        env = QProcessEnvironment.systemEnvironment()
        env.insert('PYTHONUTF8', '1')
        env.insert('PYTHONUNBUFFERED', '1')
        git = find_bundled_git(self._project_path)
        if git:
            env.insert('PATH', os.path.dirname(git) + os.pathsep + env.value('PATH'))
        proc.setProcessEnvironment(env)
        proc.readyReadStandardOutput.connect(self._on_stdout)
        proc.readyReadStandardError.connect(self._on_stderr)
        proc.finished.connect(self._on_finished)
        proc.started.connect(self._started)
        proc.errorOccurred.connect(self._process_error)
        self.output.emit(self.name, '[AstrBot] 正在启动独立 Python 环境中的 main.py')
        proc.start(self._def['get_cmd'](self._project_path), self._def['get_args']())

    def _started(self):
        self._pid = self._proc.processId()
        self._health_retries = 0
        self._health_max_retries = 150  # First launch may download the dashboard.
        QTimer.singleShot(2000, self._health_check)

    def _process_error(self, error):
        if error == QProcess.FailedToStart:
            self._set_status(self.STATUS_ERROR)
            self.output.emit(self.name, '[ERROR] ' + self._proc.errorString())


def astrbot_root(project_path):
    return Path(project_path) / 'AstrBot'


def astrbot_python(project_path):
    root = astrbot_root(project_path)
    for relative in ('.venv/Scripts/python.exe', '.venv/bin/python'):
        candidate = root / relative
        if candidate.is_file():
            return str(candidate)
    return None


def astrbot_installed(project_path):
    return (astrbot_root(project_path) / 'main.py').is_file() and bool(astrbot_python(project_path))


def copy_bridge_plugin(project_path):
    root = Path(project_path).resolve()
    source = root / 'agent-core/src/astrbot-bridge/plugin'
    destination = root / 'AstrBot/data/plugins/astrbot_plugin_linshe'
    # Do not follow a user-created junction outside the managed installation.
    if not destination.resolve().is_relative_to(root / 'AstrBot'):
        raise ValueError('AstrBot 插件目录指向安装目录之外')
    destination.mkdir(parents=True, exist_ok=True)
    for name in ('main.py', 'client.py', 'metadata.yaml', '_conf_schema.json', 'requirements.txt', 'tools.json', 'README.md'):
        target = destination / name
        if target.is_symlink():
            raise ValueError('插件文件不能是符号链接')
        shutil.copyfile(source / name, target)


class AstrbotRunner(QObject):
    output = Signal(str, str)
    status_changed = Signal(str, str, object)
    health_changed = Signal(str, bool)
    install_finished = Signal(bool)
    all_stopped = Signal()

    def __init__(self, project_path, parent=None):
        super().__init__(parent)
        self.project_path = project_path
        self._setup = None
        self._steps = []
        self._installing = False
        self._stopping = False
        self._worker = AstrbotWorker({
            'name': 'astrbot', 'display': 'AstrBot', 'port': ASTRBOT_PORT,
            'health_path': '/', 'cwd': 'AstrBot',
            'get_cmd': astrbot_python, 'get_args': lambda: ['main.py'],
            'env': {'PYTHONUTF8': '1'},
        }, project_path, self)
        self._worker.output.connect(lambda key, text: self.output.emit(key, sanitize_output(text)))
        self._worker.health_changed.connect(self.health_changed)
        self._worker.status_changed.connect(self._status)

    def _status(self, name, status):
        self.status_changed.emit(name, status, self._worker.pid)
        if status in ('stopped', 'error') and not self.any_active():
            self.all_stopped.emit()

    def any_active(self):
        process = self._worker._proc
        return self._installing or self._stopping or bool(process and process.state() != QProcess.NotRunning)

    def install(self):
        if self.any_active():
            return
        root = astrbot_root(self.project_path)
        if not root.resolve().is_relative_to(Path(self.project_path).resolve()):
            self.output.emit('astrbot', '[ERROR] AstrBot 目录不能指向邻舍目录之外')
            return
        git = find_bundled_git(self.project_path) or shutil.which('git')
        uv = shutil.which('uv')
        self._steps = []
        if not (root / 'main.py').is_file():
            if root.exists() and any(root.iterdir()):
                self.output.emit('astrbot', '[ERROR] AstrBot 文件夹非空但缺少 main.py，请检查手动安装或未完成的下载；现有文件不会被覆盖')
                return
            if not git:
                self.output.emit('astrbot', '[ERROR] 未找到 Git，请先安装 Git 或使用官方源码包放入 AstrBot 文件夹')
                return
            self._steps.append((git, ['clone', '--depth', '1', '--branch', ASTRBOT_VERSION, 'https://github.com/AstrBotDevs/AstrBot.git', str(root)], self.project_path))
        bootstrap = Path(self.project_path) / 'runtime/astrbot-bootstrap'
        if not uv:
            bundled_uv = bootstrap / ('Scripts/uv.exe' if os.name == 'nt' else 'bin/uv')
            if bundled_uv.is_file():
                uv = str(bundled_uv)
            else:
                self._steps.append((_resolve_python(self.project_path), ['-m', 'pip', 'install', '--prefix', str(bootstrap), '--ignore-installed', 'uv'], self.project_path))
                uv = str(bundled_uv)
        self._steps.append((uv, ['sync', '--no-dev', '--no-install-project', '--python', '3.12'], str(root)))
        self._installing = True
        self.status_changed.emit('astrbot', 'installing', None)
        self._next_step()

    def _next_step(self):
        if not self._installing:
            return
        if not self._steps:
            try:
                copy_bridge_plugin(self.project_path)
                self.output.emit('astrbot', '[AstrBot] 安装完成，邻舍插件已预置。请启动后配置模型、消息平台和邻舍 Token。')
                self._finish_install(True)
            except Exception as error:
                self.output.emit('astrbot', '[ERROR] ' + str(error))
                self._finish_install(False)
            return
        program, arguments, cwd = self._steps.pop(0)
        proc = QProcess(self)
        self._setup = proc
        proc.setWorkingDirectory(cwd)
        env = QProcessEnvironment.systemEnvironment()
        env.insert('PYTHONUTF8', '1')
        proc.setProcessEnvironment(env)
        proc.setProcessChannelMode(QProcess.MergedChannels)
        proc.readyReadStandardOutput.connect(lambda: self.output.emit('astrbot', sanitize_output(bytes(proc.readAllStandardOutput()).decode('utf-8', errors='replace'))))
        proc.errorOccurred.connect(lambda error: self._setup_error(proc, error))
        proc.finished.connect(lambda code, status: self._setup_finished(proc, code))
        self.output.emit('astrbot', '[AstrBot] ' + ' '.join([program, *arguments]))
        proc.start(program, arguments)

    def _setup_error(self, proc, error):
        if proc is self._setup and error == QProcess.FailedToStart:
            self.output.emit('astrbot', '[ERROR] 安装命令无法启动：' + proc.errorString())
            self._setup = None
            proc.deleteLater()
            self._finish_install(False)

    def _setup_finished(self, proc, code):
        if proc is not self._setup:
            return
        self._setup = None
        proc.deleteLater()
        if not self._installing:
            return
        if code != 0:
            self.output.emit('astrbot', f'[ERROR] 安装退出 ({code})，请检查上方网络或依赖错误，可再次点击安装环境重试')
            self._finish_install(False)
        else:
            self._next_step()

    def _finish_install(self, success):
        self._installing = False
        self._steps = []
        self.status_changed.emit('astrbot', 'stopped' if success else 'error', None)
        self.install_finished.emit(success)
        if not self.any_active():
            self.all_stopped.emit()

    def start_all(self):
        if self.any_active():
            return
        if not astrbot_installed(self.project_path):
            self.output.emit('astrbot', '[ERROR] 请先点击安装环境，或将已有源码与 .venv 放入邻舍根目录下的 AstrBot 文件夹')
            return
        # Refuse a port conflict; never kill someone else's AstrBot process.
        import socket
        with socket.socket() as sock:
            sock.settimeout(0.2)
            if sock.connect_ex(('127.0.0.1', ASTRBOT_PORT)) == 0:
                self.output.emit('astrbot', '[ERROR] 6185 端口已占用，请先停止外部 AstrBot 或直接打开其后台')
                return
        self._worker.start()

    @staticmethod
    def _kill_tree(proc):
        if not proc or proc.state() == QProcess.NotRunning:
            return
        import psutil
        try:
            parent = psutil.Process(proc.processId())
            children = parent.children(recursive=True)
            for child in reversed(children):
                try:
                    child.kill()
                except psutil.Error:
                    pass
        except psutil.Error:
            pass
        proc.kill()

    def stop_all(self):
        self._stopping = True
        self._installing = False
        self._steps = []
        self._worker._set_status(ServiceWorker.STATUS_STOPPING)
        self._kill_tree(self._setup)
        self._kill_tree(self._worker._proc)
        self.status_changed.emit('astrbot', 'stopping', self._worker.pid)
        self._wait_stopped()

    def _wait_stopped(self):
        if any(p and p.state() != QProcess.NotRunning for p in (self._setup, self._worker._proc)):
            QTimer.singleShot(100, self._wait_stopped)
            return
        self._stopping = False
        self._worker._set_status(ServiceWorker.STATUS_STOPPED)
        self.status_changed.emit('astrbot', 'stopped', None)
        self.all_stopped.emit()

    def force_kill_all(self):
        self._installing = False
        self._steps = []
        self._kill_tree(self._setup)
        self._kill_tree(self._worker._proc)
