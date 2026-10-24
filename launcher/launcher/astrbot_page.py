"""AstrBot launcher page, reusing MaiBot controls and the launcher palette."""
import webbrowser
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton
from .maibot_page import _primary_btn_style, _outline_btn_style
from .switch import Switch
from .log_widget import LogWidget
from .astrbot_runner import astrbot_installed, ASTRBOT_ADMIN_URL, ASTRBOT_VERSION


class AstrbotPage(QWidget):
    start_clicked = Signal()
    stop_clicked = Signal()
    install_clicked = Signal()
    setting_changed = Signal(str, object)

    def __init__(self, project_path, parent=None):
        super().__init__(parent)
        self.project_path = project_path
        self.setStyleSheet('background: #F7F3F0;')
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 44, 24, 24)
        layout.setSpacing(14)
        title = QLabel('AstrBot 集成')
        title.setStyleSheet('color: #2E2A27; font-size: 22px; font-weight: bold;')
        layout.addWidget(title)
        intro = QLabel(f'首次安装下载官方 {ASTRBOT_VERSION}，创建独立 Python 3.12 环境，并预置邻舍工具插件。已有源码可放在邻舍根目录的 AstrBot 文件夹。')
        intro.setWordWrap(True)
        intro.setStyleSheet('color: #756B65; font-size: 13px;')
        layout.addWidget(intro)
        self.status = QLabel()
        self.status.setStyleSheet('color: #756B65; font-size: 13px;')
        layout.addWidget(self.status)
        row = QHBoxLayout()
        self.install_btn = self._button('安装环境 / 修复依赖', self.install_clicked.emit)
        self.start_btn = self._button('启动 AstrBot', self.start_clicked.emit, primary=True)
        self.stop_btn = self._button('停止', self.stop_clicked.emit)
        self.detect_btn = self._button('重新检测', self.detect)
        for button in (self.install_btn, self.start_btn, self.stop_btn, self.detect_btn):
            row.addWidget(button)
        row.addStretch()
        layout.addLayout(row)
        links = QHBoxLayout()
        links.addWidget(self._button('打开 AstrBot 后台', lambda: webbrowser.open(ASTRBOT_ADMIN_URL)))
        links.addWidget(self._button('邻舍角色与工具设置', lambda: webbrowser.open('http://127.0.0.1:3099/#/settings/astrbot')))
        links.addWidget(self._button('官方安装文档', lambda: webbrowser.open('https://docs.astrbot.app/')))
        links.addStretch()
        layout.addLayout(links)
        self.autostart = Switch('随邻舍一键启动')
        self.autostart.toggled.connect(lambda value: self.setting_changed.emit('astrbot_autostart', value))
        layout.addWidget(self.autostart)
        self.open_browser = Switch('就绪后打开 AstrBot 后台')
        self.open_browser.toggled.connect(lambda value: self.setting_changed.emit('astrbot_open_browser', value))
        layout.addWidget(self.open_browser)
        hint = QLabel('首次启动后，在 AstrBot 配置模型与消息平台；在邻舍设置页选择角色、启用工具，并将 Token 填入 AstrBot 的邻舍插件配置。')
        hint.setWordWrap(True)
        hint.setStyleSheet('color: #756B65; font-size: 12px;')
        layout.addWidget(hint)
        self.log = LogWidget(self)
        layout.addWidget(self.log, 1)
        self.detect()

    def _button(self, title, callback, primary=False):
        button = QPushButton(title)
        button.setCursor(Qt.PointingHandCursor)
        button.setStyleSheet(_primary_btn_style() if primary else _outline_btn_style())
        button.clicked.connect(lambda: callback())
        return button

    def detect(self):
        installed = astrbot_installed(self.project_path)
        self.status.setText('已检测到 AstrBot，可启动' if installed else '尚未安装 AstrBot 环境')
        self.start_btn.setEnabled(installed)
        self.stop_btn.setEnabled(False)

    def update_status(self, key, status, pid):
        active = status in ('installing', 'starting', 'running', 'stopping', 'timeout')
        self.install_btn.setEnabled(not active)
        self.detect_btn.setEnabled(not active)
        self.start_btn.setEnabled(not active and astrbot_installed(self.project_path))
        self.stop_btn.setEnabled(active and status != 'stopping')
        names = {'installing': '正在安装环境…', 'starting': '正在启动…', 'running': 'AstrBot 已就绪', 'stopping': '正在停止…', 'stopped': '已停止', 'error': '发生错误，请查看日志', 'timeout': '后台尚未就绪，请查看日志'}
        self.status.setText(names.get(status, status))

    def append_log(self, key, text):
        self.log.append_line(text)

    def set_values(self, autostart, open_browser):
        for widget, value in ((self.autostart, autostart), (self.open_browser, open_browser)):
            widget.blockSignals(True)
            widget.setChecked(bool(value))
            widget.blockSignals(False)
