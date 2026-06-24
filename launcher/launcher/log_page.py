"""
运行日志页 —— 服务状态指示 + 实时日志 + 提醒条幅。
"""
import socket
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
)
from PySide6.QtCore import Qt, Signal
from .log_widget import LogWidget


class ServiceIndicator(QWidget):
    """单个服务状态指示器：圆点 + 名称 + PID。"""

    def __init__(self, name: str, port: int, parent=None):
        super().__init__(parent)
        self._name = name
        self._port = port
        self._running = False
        self._pid = None
        self._setup_ui()

    def _setup_ui(self):
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 2, 0, 2)
        layout.setSpacing(6)

        self._dot = QLabel("●")
        self._dot.setFixedWidth(16)
        self._update_dot()

        self._text = QLabel(f"{self._name} (:{self._port})")
        self._text.setStyleSheet("color: #2E2A27; font-size: 13px;")

        self._pid_label = QLabel("")
        self._pid_label.setStyleSheet("color: #756B65; font-size: 11px;")

        layout.addWidget(self._dot)
        layout.addWidget(self._text)
        layout.addWidget(self._pid_label)
        layout.addStretch()

    def set_running(self, running: bool, pid: int | None = None):
        self._running = running
        self._pid = pid
        self._update_dot()
        self._pid_label.setText(f"PID {pid}" if pid else "")

    def _update_dot(self):
        if self._running:
            self._dot.setStyleSheet("color: #4CAF50; font-size: 14px; font-weight: bold;")
        else:
            self._dot.setStyleSheet("color: #C9C0BB; font-size: 14px;")


class LogPage(QWidget):
    """运行日志页面。"""

    stop_all_clicked = Signal()
    start_clicked = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()

    def _setup_ui(self):
        self.setStyleSheet("background: #F7F3F0;")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 44, 16, 0)
        layout.setSpacing(8)

        # --- 服务状态栏 ---
        status_layout = QHBoxLayout()

        self.vector_indicator = ServiceIndicator("向量服务", 8765)
        self.agent_indicator = ServiceIndicator("主控后端", 3099)

        status_layout.addWidget(self.vector_indicator)
        status_layout.addWidget(self.agent_indicator)
        status_layout.addStretch()

        self.stop_btn = QPushButton("■ 停止所有")
        self.stop_btn.setStyleSheet("""
            QPushButton {
                background: #E07B6C; color: #FCFAF8; font-size: 12px;
                padding: 6px 14px; border-radius: 6px; border: none;
            }
            QPushButton:hover { background: #D96D5D; }
            QPushButton:pressed { background: #C95F4F; }
            QPushButton:disabled {
                background: #E5D9D2; color: #C9C0BB;
            }
        """)
        self.stop_btn.clicked.connect(self.stop_all_clicked.emit)
        self.stop_btn.setEnabled(False)
        status_layout.addWidget(self.stop_btn)

        self.start_btn = QPushButton("▶ 启动服务")
        self.start_btn.setStyleSheet("""
            QPushButton {
                background: #E07B6C; color: #FCFAF8; font-size: 12px;
                padding: 6px 14px; border-radius: 6px; border: none;
            }
            QPushButton:hover { background: #D96D5D; }
            QPushButton:pressed { background: #C95F4F; }
            QPushButton:disabled {
                background: #E5D9D2; color: #C9C0BB;
            }
        """)
        self.start_btn.clicked.connect(self.start_clicked.emit)
        self.start_btn.setEnabled(True)
        status_layout.addWidget(self.start_btn)

        layout.addLayout(status_layout)

        # --- 手机端访问条幅（全宽橙色长条，服务运行时显示在日志窗口上方） ---
        self._mobile_banner = QLabel("")
        self._mobile_banner.setTextFormat(Qt.RichText)
        self._mobile_banner.setAlignment(Qt.AlignCenter)
        self._mobile_banner.setFixedHeight(36)
        self._mobile_banner.setStyleSheet("""
            QLabel {
                background: #E07B6C;
                color: #FCFAF8;
                font-size: 13px;
                font-weight: bold;
                border-radius: 6px;
            }
        """)
        self._mobile_banner.hide()
        layout.addWidget(self._mobile_banner)

        # --- 日志区域 ---
        self.log_widget = LogWidget(self)
        layout.addWidget(self.log_widget, stretch=1)

    def append_log(self, text: str):
        self.log_widget.append_line(text)

    # ------------------------------------------------------------------
    # 条幅控制
    # ------------------------------------------------------------------

    @staticmethod
    def _get_local_ip() -> str | None:
        """获取本机局域网 IP 地址。失败时返回 None。"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(1)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return None

    def show_mobile_banner(self) -> None:
        """显示手机端访问条幅（全宽橙色长条，服务运行时常驻）。IP 只获取一次并缓存。"""
        if not hasattr(self, '_cached_ip'):
            self._cached_ip = self._get_local_ip()
        if self._cached_ip:
            self._mobile_banner.setText(
                f'手机端可访问 http://{self._cached_ip}:3099 打开邻舍'
            )
            self._mobile_banner.show()
        else:
            self._mobile_banner.hide()

    def hide_mobile_banner(self) -> None:
        """隐藏手机端访问条幅。"""
        self._mobile_banner.hide()

    # ------------------------------------------------------------------
    # 服务状态
    # ------------------------------------------------------------------

    def set_busy_state(self, busy: bool, label: str = ""):
        """构建/启动中时禁用启动按钮，防止重复点击。"""
        self._busy = busy
        if busy:
            self.start_btn.setText(label)
            self.start_btn.setEnabled(False)
            self.start_btn.setStyleSheet("""
                QPushButton {
                    background: #E5D9D2; color: #756B65; font-size: 12px;
                    padding: 6px 14px; border-radius: 6px; border: none;
                }
            """)
        else:
            self.start_btn.setText("▶ 启动服务")
            self.start_btn.setEnabled(True)
            self.start_btn.setStyleSheet("""
                QPushButton {
                    background: #E07B6C; color: #FCFAF8; font-size: 12px;
                    padding: 6px 14px; border-radius: 6px; border: none;
                }
                QPushButton:hover { background: #D96D5D; }
                QPushButton:pressed { background: #C95F4F; }
                QPushButton:disabled {
                    background: #E5D9D2; color: #C9C0BB;
                }
            """)

    def update_service_status(self, service_name: str, status: str, pid: int | None = None):
        running = status == "running"
        if service_name == "vector":
            self.vector_indicator.set_running(running, pid)
        elif service_name == "agent_core":
            self.agent_indicator.set_running(running, pid)

        # 更新按钮状态
        any_running = (
            self.vector_indicator._running or self.agent_indicator._running
        )
        all_stopped = (
            not self.vector_indicator._running and not self.agent_indicator._running
        )
        self.stop_btn.setEnabled(any_running)
        if not getattr(self, "_busy", False):
            self.start_btn.setEnabled(all_stopped)
