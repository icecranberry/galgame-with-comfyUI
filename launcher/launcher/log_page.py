"""
运行日志页 —— 服务状态指示 + 实时日志。
"""
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
        self._text.setStyleSheet("color: #e0e0e0; font-size: 13px;")

        self._pid_label = QLabel("")
        self._pid_label.setStyleSheet("color: #666; font-size: 11px;")

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
            self._dot.setStyleSheet("color: #44cc44; font-size: 14px; font-weight: bold;")
        else:
            self._dot.setStyleSheet("color: #555; font-size: 14px;")


class LogPage(QWidget):
    """运行日志页面。"""

    stop_all_clicked = Signal()
    start_clicked = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()

    def _setup_ui(self):
        self.setStyleSheet("background: #1a1a1a;")

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
                background: #cc4444; color: white; font-size: 12px;
                padding: 6px 14px; border-radius: 6px; border: none;
            }
            QPushButton:hover { background: #bb3333; }
            QPushButton:pressed { background: #aa2222; }
            QPushButton:disabled {
                background: #444; color: #888;
            }
        """)
        self.stop_btn.clicked.connect(self.stop_all_clicked.emit)
        self.stop_btn.setEnabled(False)
        status_layout.addWidget(self.stop_btn)

        self.start_btn = QPushButton("▶ 启动服务")
        self.start_btn.setStyleSheet("""
            QPushButton {
                background: #4CAF50; color: white; font-size: 12px;
                padding: 6px 14px; border-radius: 6px; border: none;
            }
            QPushButton:hover { background: #45a049; }
            QPushButton:pressed { background: #3d8b40; }
            QPushButton:disabled {
                background: #444; color: #888;
            }
        """)
        self.start_btn.clicked.connect(self.start_clicked.emit)
        self.start_btn.setEnabled(True)
        status_layout.addWidget(self.start_btn)

        layout.addLayout(status_layout)

        # --- 日志区域 ---
        self.log_widget = LogWidget(self)
        layout.addWidget(self.log_widget, stretch=1)

    def append_log(self, text: str):
        self.log_widget.append_line(text)

    def update_service_status(self, service_name: str, status: str, pid: int | None = None):
        running = status == "running"
        if service_name == "vector":
            self.vector_indicator.set_running(running, pid)
        elif service_name == "agent_core":
            self.agent_indicator.set_running(running, pid)

        # 更新按钮状态：有服务运行时可停止，无可运行服务时可启动
        any_running = (
            self.vector_indicator._running or self.agent_indicator._running
        )
        all_stopped = (
            not self.vector_indicator._running and not self.agent_indicator._running
        )
        self.stop_btn.setEnabled(any_running)
        self.start_btn.setEnabled(all_stopped)
