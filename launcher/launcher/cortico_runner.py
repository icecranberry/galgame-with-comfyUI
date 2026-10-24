"""Cortico isolated source installation and owned-process lifecycle."""
import json
import os
import shutil
import socket
import urllib.request
from pathlib import Path

from PySide6.QtCore import QObject, Signal, QProcess, QTimer
from .service_runner import ServiceWorker, find_bundled_git, _resolve_node
from .maibot_runner import sanitize_output

CORTICO_REPO = 'https://github.com/Pal-AI-Lab/Cortico.git'
CORTICO_PORT = 7900
CORTICO_ADMIN_URL = f'http://127.0.0.1:{CORTICO_PORT}/'
CORTICO_DEPLOYMENT = 'linshe'
LINSHE_CORE_URL = 'http://127.0.0.1:3099'

# 部署 config.json 首次创建时的骨架；不覆盖用户已改过的文件。
DEPLOYMENT_CONFIG = {
    'displayName': '邻舍',
    'timezone': 'Asia/Shanghai',
    'activeProvider': '',
    'worlds': {
        'console': {'enabled': True},
        'qq': {
            'enabled': False,
            'wsUrl': 'ws://127.0.0.1:3001',
            'token': '',
            'groups': [],
            'privates': [],
        },
        'linshe': {
            'enabled': True,
            'baseUrl': LINSHE_CORE_URL,
            'taskTimeoutSec': 240,
        },
    },
}

EXTENSION_LINKS = {
    'cortico-world-linshe': 'link:../../agent-core/src/cortico-bridge/world',
    'cortico-bot-linshe': 'link:../../agent-core/src/cortico-bridge/bot',
}


class CorticoWorker(ServiceWorker):
    """首次启动可能要装依赖、构建 WebUI 产物；放宽健康检查窗口。"""

    def _launch_process(self):
        super()._launch_process()
        self._health_max_retries = 150


def cortico_root(project_path):
    return Path(project_path) / 'Cortico'


def cortico_installed(project_path):
    return (cortico_root(project_path) / 'bin' / 'cortico.mjs').is_file()


def _pnpm_command():
    """与 bin/cortico.mjs 相同的发现顺序:corepack 优先,pnpm 兜底。"""
    corepack = shutil.which('corepack')
    if corepack:
        return corepack, ['pnpm']
    pnpm = shutil.which('pnpm')
    if pnpm:
        return pnpm, []
    return None, None


def ensure_extensions(project_path):
    """把 agent-core/src/cortico-bridge 下的 world / bot 扩展包 link 进 Cortico/extensions。"""
    root = cortico_root(project_path)
    extensions = root / 'extensions'
    extensions.mkdir(parents=True, exist_ok=True)
    manifest = extensions / 'package.json'
    current = {}
    if manifest.is_file():
        try:
            current = json.loads(manifest.read_text(encoding='utf-8'))
        except ValueError:
            current = {}
    dependencies = {**(current.get('dependencies') or {}), **EXTENSION_LINKS}
    manifest.write_text(
        json.dumps({'name': 'linshe-extensions', 'private': True, 'dependencies': dependencies}, indent=2) + '\n',
        encoding='utf-8',
    )
    for relative in EXTENSION_LINKS.values():
        target = (extensions / relative[len('link:'):]).resolve()
        if not target.is_dir():
            raise ValueError(f'扩展包缺失: {relative}')


def ensure_deployment(project_path):
    """保证 linshe 部署存在;已存在的 config.json / .env 一律不动。"""
    deployment = cortico_root(project_path) / 'deployments' / CORTICO_DEPLOYMENT
    deployment.mkdir(parents=True, exist_ok=True)
    manifest = deployment / 'deployment.json'
    if not manifest.is_file():
        manifest.write_text(json.dumps({'bot': 'cortico-bot-linshe'}, indent=2) + '\n', encoding='utf-8')
    config = deployment / 'config.json'
    if not config.is_file():
        config.write_text(json.dumps(DEPLOYMENT_CONFIG, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def sync_bridge_settings(project_path, emit):
    """从邻舍管理接口读取桥接 Token 与地址，写进部署 .env 与 config.json。

    后端未启动或读取失败时仅提示，不阻断启动（World 会在邻舍可用后自行恢复）。
    """
    try:
        request = urllib.request.Request(LINSHE_CORE_URL + '/api/cortico/admin/settings')
        with urllib.request.urlopen(request, timeout=3) as response:
            data = json.loads(response.read().decode('utf-8'))
    except Exception as error:
        emit('cortico', f'[Cortico] 未能从邻舍读取桥接配置（{error}），沿用部署现有 .env')
        return
    token = str(data.get('token') or '')
    base_url = str((data.get('settings') or {}).get('public_url') or LINSHE_CORE_URL)
    if not token:
        emit('cortico', '[Cortico] 邻舍未返回桥接 Token，沿用部署现有 .env')
        return
    env_path = cortico_root(project_path) / 'deployments' / CORTICO_DEPLOYMENT / '.env'
    lines = []
    if env_path.is_file():
        for line in env_path.read_text(encoding='utf-8').splitlines():
            if line.strip() and not line.strip().startswith('LINSHE_BRIDGE_TOKEN='):
                lines.append(line)
    lines.append(f'LINSHE_BRIDGE_TOKEN={token}')
    env_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    config_path = cortico_root(project_path) / 'deployments' / CORTICO_DEPLOYMENT / 'config.json'
    try:
        config = json.loads(config_path.read_text(encoding='utf-8')) if config_path.is_file() else {}
    except ValueError:
        config = {}
    worlds = config.get('worlds') or {}
    linshe = worlds.get('linshe') or {}
    linshe['baseUrl'] = base_url
    worlds['linshe'] = linshe
    config['worlds'] = worlds
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    emit('cortico', '[Cortico] 已同步邻舍桥接 Token 与地址到 linshe 部署')


class CorticoRunner(QObject):
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
        self._worker = CorticoWorker({
            'name': 'cortico', 'display': 'Cortico', 'port': CORTICO_PORT,
            'health_path': '/', 'cwd': 'Cortico',
            'get_cmd': _resolve_node, 'get_args': lambda: ['bin/cortico.mjs', CORTICO_DEPLOYMENT],
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
        root = cortico_root(self.project_path)
        if not root.resolve().is_relative_to(Path(self.project_path).resolve()):
            self.output.emit('cortico', '[ERROR] Cortico 目录不能指向邻舍目录之外')
            return
        pnpm, prefix = _pnpm_command()
        if not pnpm:
            self.output.emit('cortico', '[ERROR] 未找到 pnpm/corepack，请安装 Node.js 22+（自带 corepack）后重试')
            return
        self._steps = []
        if not cortico_installed(self.project_path):
            if root.exists() and any(root.iterdir()):
                self.output.emit('cortico', '[ERROR] Cortico 文件夹非空但缺少 bin/cortico.mjs，请检查手动安装或未完成的下载；现有文件不会被覆盖')
                return
            git = find_bundled_git(self.project_path) or shutil.which('git')
            if not git:
                self.output.emit('cortico', '[ERROR] 未找到 Git，请先安装 Git 或把官方源码放入 Cortico 文件夹')
                return
            self._steps.append((git, ['clone', '--depth', '1', CORTICO_REPO, str(root)], self.project_path))
        self._steps.append((pnpm, [*prefix, 'install'], str(root)))
        self._steps.append((pnpm, [*prefix, 'install'], str(root / 'extensions')))
        self._installing = True
        self.status_changed.emit('cortico', 'installing', None)
        self._next_step()

    def _next_step(self):
        if not self._installing:
            return
        if not self._steps:
            try:
                ensure_extensions(self.project_path)
                ensure_deployment(self.project_path)
                self.output.emit('cortico', '[Cortico] 安装完成，linshe 部署与邻舍扩展已就绪。启动后在 Cortico 后台配置模型与 QQ 监听名单。')
                self._finish_install(True)
            except Exception as error:
                self.output.emit('cortico', '[ERROR] ' + str(error))
                self._finish_install(False)
            return
        program, arguments, cwd = self._steps.pop(0)
        proc = QProcess(self)
        self._setup = proc
        proc.setWorkingDirectory(cwd)
        env = proc.processEnvironment()
        for key in ('USERPROFILE', 'HOME', 'TEMP', 'TMP', 'SystemRoot', 'PATH', 'APPDATA', 'LOCALAPPDATA'):
            if key in os.environ:
                env.insert(key, os.environ[key])
        bundled_git = find_bundled_git(self.project_path)
        if bundled_git:
            env.insert('PATH', os.path.dirname(bundled_git) + os.pathsep + env.value('PATH'))
        proc.setProcessEnvironment(env)
        proc.setProcessChannelMode(QProcess.MergedChannels)
        proc.readyReadStandardOutput.connect(lambda: self.output.emit('cortico', sanitize_output(bytes(proc.readAllStandardOutput()).decode('utf-8', errors='replace'))))
        proc.errorOccurred.connect(lambda error: self._setup_error(proc, error))
        proc.finished.connect(lambda code, status: self._setup_finished(proc, code))
        self.output.emit('cortico', '[Cortico] ' + ' '.join([program, *arguments]))
        proc.start(program, arguments)

    def _setup_error(self, proc, error):
        if proc is self._setup and error == QProcess.FailedToStart:
            self.output.emit('cortico', '[ERROR] 安装命令无法启动：' + proc.errorString())
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
            self.output.emit('cortico', f'[ERROR] 安装退出 ({code})，请检查上方网络或依赖错误，可再次点击安装环境重试')
            self._finish_install(False)
        else:
            self._next_step()

    def _finish_install(self, success):
        self._installing = False
        self._steps = []
        self.status_changed.emit('cortico', 'stopped' if success else 'error', None)
        self.install_finished.emit(success)
        if not self.any_active():
            self.all_stopped.emit()

    def start_all(self):
        if self.any_active():
            return
        if not cortico_installed(self.project_path):
            self.output.emit('cortico', '[ERROR] 请先点击安装环境，或将官方源码放入邻舍根目录下的 Cortico 文件夹')
            return
        # Refuse a port conflict; never kill someone else's Cortico process.
        with socket.socket() as sock:
            sock.settimeout(0.2)
            if sock.connect_ex(('127.0.0.1', CORTICO_PORT)) == 0:
                self.output.emit('cortico', '[ERROR] 7900 端口已占用，请先停止外部 Cortico 或直接打开其后台')
                return
        ensure_extensions(self.project_path)
        ensure_deployment(self.project_path)
        sync_bridge_settings(self.project_path, self.output.emit)
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
        self.status_changed.emit('cortico', 'stopping', self._worker.pid)
        self._wait_stopped()

    def _wait_stopped(self):
        if any(p and p.state() != QProcess.NotRunning for p in (self._setup, self._worker._proc)):
            QTimer.singleShot(100, self._wait_stopped)
            return
        self._stopping = False
        self._worker._set_status(ServiceWorker.STATUS_STOPPED)
        self.status_changed.emit('cortico', 'stopped', None)
        self.all_stopped.emit()

    def force_kill_all(self):
        self._installing = False
        self._steps = []
        self._kill_tree(self._setup)
        self._kill_tree(self._worker._proc)
