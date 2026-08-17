"""
MaiBot 页面 —— 根目录未检测到 MaiBot 文件夹时展示安装教程；
已安装时提供一键启动、双服务控制台（MaiBot / SnowLuma 标签页可切换）与后台入口。
"""
import os

from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QStackedWidget,
    QScrollArea,
    QTabWidget,
    QFrame,
)
from PySide6.QtCore import Qt, Signal

from .log_page import ServiceIndicator
from .log_widget import LogWidget
from .switch import Switch

QUARK_PAN_URL = "https://pan.quark.cn/s/8ee40c22ccc6?pwd=SWwE"
BILI_SPACE_URL = "https://space.bilibili.com/632137"
MAIBOT_ADMIN_URL = "http://127.0.0.1:8001/"
SNOWLUMA_ADMIN_URL = "http://127.0.0.1:5099/"

_LINK = 'style="color: #E07B6C; text-decoration: none;"'

# 安装教程（依据 MaiBot 一键包内的 简单教程！.txt 精简而来）
INTRO_TEXT = (
    "MaiBot 用于在群内快速部署一个 QQ 机器人。它与 SnowLuma 连接器配套运行，"
    "让邻舍的纸片人可以在 QQ 群和私聊中接收消息、自动回复营业。"
)

INSTALL_STEPS = [
    (
        "① 下载一键包",
        f'从 <a href="{QUARK_PAN_URL}" {_LINK}>夸克网盘（提取码 SWwE）</a> '
        "下载 MaiBot 一键包。",
    ),
    (
        "② 解压到邻舍根目录",
        "将压缩包解压到邻舍根目录（与 邻舍.EXE.exe 同级），确保根目录下出现 MaiBot 文件夹（里面包含MaiBot和Snowluma）。",
    ),
    (
        "③ 观看安装视频",
        f'B 站 <a href="{BILI_SPACE_URL}" {_LINK}>@琪猫猫来了全秒了</a> '
        "有完整的安装演示，跟着做即可。",
    ),
    (
        "④ 完成安装",
        "点击下方「我已安装，重新检测」，之后即可在本页一键启动"
        "（也可以直接双击 MaiBot\\start.bat）。",
    ),
]

AFTER_START_STEPS = [
    "默认 Token：MaiBot 后台为 MaiBot.admin，SnowLuma 后台为 Snowluma.admin",
    "先去 Snowluma 后台连接已登录、用作机器人的 QQ 客户端，消息才能被截取和注入",
    "在后台「模型列表」配置 LLM 模型",
    "麦麦设置 → 核心设置 → 填写机器人 QQ 号",
    "在 MaiBot 的插件管理 → Snowluma 连接器里配置接收消息的 QQ 群或私聊账号"
    "（强烈建议在聊天管理中把发言频率降低到 0.05，避免刷屏）",
]


class MaiBotPage(QWidget):
    """MaiBot 安装教程 / 运行控制页面。"""

    start_clicked = Signal()
    stop_clicked = Signal()
    open_admin_requested = Signal(str)   # "maibot" | "snowluma"
    setting_changed = Signal(str, object)  # (key, value)
    installed_changed = Signal(bool)

    def __init__(self, project_path: str, parent=None):
        super().__init__(parent)
        self._project_path = project_path
        self._installed = False
        self._statuses = {"maibot": "stopped", "snowluma": "stopped"}
        self._launch_requested = False  # 点击启动后置位，控制「启动后视图」
        self._stop_requested = False    # 用户主动停止，停止完成后回到启动前视图
        self._saw_activity = False      # 启动后是否见过进程活动（区分刚点击/崩溃）
        self._setup_ui()
        self.detect()

    # ==================================================================
    # UI
    # ==================================================================

    def _setup_ui(self):
        self.setStyleSheet("background: #F7F3F0;")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        self._stack = QStackedWidget()
        self._stack.setStyleSheet("QStackedWidget { background: transparent; }")
        layout.addWidget(self._stack)

        self._tutorial_panel = self._build_tutorial_panel()
        self._stack.addWidget(self._tutorial_panel)

        self._control_panel = self._build_control_panel()
        self._stack.addWidget(self._control_panel)

    # ------------------------------------------------------------------
    # 安装教程面板
    # ------------------------------------------------------------------

    def _build_tutorial_panel(self) -> QWidget:
        panel = QWidget()
        panel.setStyleSheet("background: #F7F3F0;")

        outer = QVBoxLayout(panel)
        outer.setContentsMargins(0, 0, 0, 0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("""
            QScrollArea {
                background: transparent;
                border: none;
            }
            QScrollBar:vertical {
                background: #F1ECE8;
                width: 6px;
                margin: 0;
            }
            QScrollBar::handle:vertical {
                background: #C9C0BB;
                border-radius: 3px;
                min-height: 30px;
            }
            QScrollBar::handle:vertical:hover {
                background: #B0A8A3;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0;
            }
        """)

        container = QWidget()
        container.setStyleSheet("background: transparent;")
        layout = QVBoxLayout(container)
        layout.setContentsMargins(24, 44, 24, 24)
        layout.setSpacing(12)

        title = QLabel("MaiBot 安装教程")
        title.setStyleSheet("color: #2E2A27; font-size: 18px; font-weight: bold;")
        layout.addWidget(title)

        intro = QLabel(INTRO_TEXT)
        intro.setWordWrap(True)
        intro.setStyleSheet("color: #756B65; font-size: 13px;")
        layout.addWidget(intro)

        layout.addSpacing(4)

        sub_title = QLabel("安装步骤")
        sub_title.setStyleSheet("color: #E07B6C; font-size: 14px; font-weight: bold;")
        layout.addWidget(sub_title)

        for step_title, body in INSTALL_STEPS:
            t = QLabel(step_title)
            t.setStyleSheet("color: #2E2A27; font-size: 13px; font-weight: bold;")
            layout.addWidget(t)

            b = QLabel(body)
            b.setWordWrap(True)
            b.setTextFormat(Qt.RichText)
            b.setOpenExternalLinks(True)
            b.setStyleSheet("color: #756B65; font-size: 13px;")
            layout.addWidget(b)

        layout.addSpacing(4)

        sub_title2 = QLabel("启动后的配置（简要）")
        sub_title2.setStyleSheet("color: #E07B6C; font-size: 14px; font-weight: bold;")
        layout.addWidget(sub_title2)

        for i, tip in enumerate(AFTER_START_STEPS, 1):
            item = QLabel(f"{i}. {tip}")
            item.setWordWrap(True)
            item.setStyleSheet("color: #756B65; font-size: 13px;")
            layout.addWidget(item)

        layout.addSpacing(8)

        redetect_btn = QPushButton("⟳ 我已安装，重新检测")
        redetect_btn.setCursor(Qt.PointingHandCursor)
        redetect_btn.setStyleSheet(_primary_btn_style())
        redetect_btn.setFixedHeight(34)
        redetect_btn.clicked.connect(self._on_redetect)
        layout.addWidget(redetect_btn)

        layout.addStretch()
        scroll.setWidget(container)
        outer.addWidget(scroll)

        # 重新检测失败时的常驻提示（位于滚动区下方）
        self._detect_hint = QLabel("仍未检测到 MaiBot 文件夹，请确认已解压到邻舍根目录（与 邻舍.EXE.exe 同级）")
        self._detect_hint.setStyleSheet("color: #C88700; font-size: 12px;")
        self._detect_hint.hide()
        outer.addWidget(self._detect_hint)

        return panel

    # ------------------------------------------------------------------
    # 控制面板
    # ------------------------------------------------------------------

    def _build_control_panel(self) -> QWidget:
        """控制面板：启动前（大按钮 + 启动设置）/ 启动后（状态卡片 + 控制台）两个视图。"""
        panel = QWidget()
        panel.setStyleSheet("background: #F7F3F0;")

        self._mode_stack = QStackedWidget()
        self._mode_stack.setStyleSheet("QStackedWidget { background: transparent; }")
        self._mode_stack.addWidget(self._build_idle_view())  # 0: 启动前
        self._mode_stack.addWidget(self._build_run_view())   # 1: 启动后

        layout = QVBoxLayout(panel)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self._mode_stack)

        self._refresh_buttons()
        return panel

    # ------------------------------------------------------------------
    # 启动前视图
    # ------------------------------------------------------------------

    def _build_idle_view(self) -> QWidget:
        """启动前视图：一键启动大按钮 + 启动设置，没有控制台。"""
        view = QWidget()
        view.setStyleSheet("background: transparent;")
        layout = QVBoxLayout(view)
        layout.setContentsMargins(24, 0, 24, 20)
        layout.setSpacing(14)

        layout.addStretch(1)

        # --- 一键启动大按钮 ---
        btn_row = QHBoxLayout()
        btn_row.addStretch()
        self.start_btn = QPushButton("▶  一键启动")
        self.start_btn.setCursor(Qt.PointingHandCursor)
        self.start_btn.setFixedSize(210, 48)
        self.start_btn.setStyleSheet(_launch_btn_style())
        self.start_btn.clicked.connect(self._on_start_clicked)
        btn_row.addWidget(self.start_btn)
        btn_row.addStretch()
        layout.addLayout(btn_row)

        caption = QLabel("同时启动 MaiBot 与 SnowLuma 两个服务")
        caption.setAlignment(Qt.AlignCenter)
        caption.setStyleSheet("color: #756B65; font-size: 12px;")
        layout.addWidget(caption)

        # 启动失败原因（前置检查失败时显示）
        self._idle_error = QLabel("")
        self._idle_error.setWordWrap(True)
        self._idle_error.setAlignment(Qt.AlignCenter)
        self._idle_error.setStyleSheet("color: #D9434A; font-size: 12px;")
        self._idle_error.hide()
        layout.addWidget(self._idle_error)

        layout.addStretch(1)

        # --- 启动设置卡片：三个独立启动选项 ---
        settings_card = QFrame()
        settings_card.setStyleSheet(_card_style())
        card_layout = QVBoxLayout(settings_card)
        card_layout.setContentsMargins(16, 12, 16, 14)
        card_layout.setSpacing(10)

        card_title = QLabel("启动设置")
        card_title.setStyleSheet("color: #2E2A27; font-size: 13px; font-weight: bold;")
        card_layout.addWidget(card_title)

        def add_option_row(switch: Switch):
            row = QHBoxLayout()
            row.addWidget(switch)
            row.addStretch()
            card_layout.addLayout(row)

        self.autostart_switch = Switch("以后随着邻舍自动启动")
        self.autostart_switch.setToolTip("点击一键启动邻舍时同时启动 MaiBot 与 SnowLuma")
        self.autostart_switch.toggled.connect(
            lambda checked: self.setting_changed.emit("maibot_autostart", checked)
        )
        add_option_row(self.autostart_switch)

        self.browser_maibot_switch = Switch("自动打开MaiBot后台")
        self.browser_maibot_switch.setToolTip("MaiBot 服务就绪后自动打开后台页面 http://127.0.0.1:8001/")
        self.browser_maibot_switch.toggled.connect(
            lambda checked: self.setting_changed.emit("maibot_browser_maibot", checked)
        )
        add_option_row(self.browser_maibot_switch)

        self.browser_snowluma_switch = Switch("自动打开SnowLuma后台")
        self.browser_snowluma_switch.setToolTip("SnowLuma 服务就绪后自动打开后台页面 http://127.0.0.1:5099/")
        self.browser_snowluma_switch.toggled.connect(
            lambda checked: self.setting_changed.emit("maibot_browser_snowluma", checked)
        )
        add_option_row(self.browser_snowluma_switch)

        layout.addWidget(settings_card)
        return view

    # ------------------------------------------------------------------
    # 启动后视图
    # ------------------------------------------------------------------

    def _build_run_view(self) -> QWidget:
        """启动后视图：服务状态卡片（含各自后台入口）+ 停止/返回 + 双标签控制台。"""
        view = QWidget()
        view.setStyleSheet("background: transparent;")
        layout = QVBoxLayout(view)
        layout.setContentsMargins(16, 44, 16, 0)
        layout.setSpacing(10)

        # --- 顶部行：服务卡片 + 停止/返回按钮（同一行） ---
        self.maibot_indicator = ServiceIndicator("MaiBot", 8001, show_port=False)
        self.snowluma_indicator = ServiceIndicator("SnowLuma", 5099, show_port=False)

        top_row = QHBoxLayout()
        top_row.setSpacing(10)
        top_row.addWidget(
            self._build_service_card(
                self.maibot_indicator, "maibot",
                "MaiBot 后台 http://127.0.0.1:8001/（端口 8001）",
            ),
        )
        top_row.addWidget(
            self._build_service_card(
                self.snowluma_indicator, "snowluma",
                "SnowLuma 后台 http://127.0.0.1:5099/（端口 5099）",
            ),
        )
        top_row.addStretch()

        self.stop_btn = QPushButton("■ 停止服务")
        self.stop_btn.setCursor(Qt.PointingHandCursor)
        self.stop_btn.setStyleSheet(_primary_btn_style())
        self.stop_btn.clicked.connect(self._on_stop_clicked)
        top_row.addWidget(self.stop_btn)

        self.back_btn = QPushButton("⟲ 返回启动")
        self.back_btn.setCursor(Qt.PointingHandCursor)
        self.back_btn.setStyleSheet(_outline_btn_style())
        self.back_btn.clicked.connect(self._on_back_clicked)
        top_row.addWidget(self.back_btn)

        layout.addLayout(top_row)

        # --- 控制台：MaiBot / SnowLuma 双标签页 ---
        self.tab_widget = QTabWidget()
        self.tab_widget.setStyleSheet(_tab_style())

        self.maibot_log = LogWidget(self)
        self.snowluma_log = LogWidget(self)
        # 嵌在 Tab 面板内，去掉 LogWidget 自带边框避免双重描边
        for log_widget in (self.maibot_log, self.snowluma_log):
            log_widget.setStyleSheet("""
                QPlainTextEdit {
                    background: #FCFAF8;
                    color: #2E2A27;
                    border: none;
                    padding: 8px;
                    selection-background: #F7D7D1;
                    selection-color: #2E2A27;
                }
            """)
        self.tab_widget.addTab(self.maibot_log, "MaiBot")
        self.tab_widget.addTab(self.snowluma_log, "SnowLuma")

        layout.addWidget(self.tab_widget, stretch=1)
        return view

    def _build_service_card(self, indicator: ServiceIndicator, service_key: str,
                            tooltip: str) -> QWidget:
        """服务卡片：左侧状态指示，右侧该服务的后台入口按钮。"""
        card = QFrame()
        card.setStyleSheet(_card_style())

        row = QHBoxLayout(card)
        row.setContentsMargins(14, 9, 10, 9)
        row.setSpacing(8)
        row.addWidget(indicator)

        open_btn = QPushButton("打开后台")
        open_btn.setCursor(Qt.PointingHandCursor)
        open_btn.setToolTip(tooltip)
        open_btn.setStyleSheet(_outline_btn_style())
        open_btn.clicked.connect(
            lambda: self.open_admin_requested.emit(service_key)
        )
        row.addWidget(open_btn)
        return card

    # ==================================================================
    # Public API
    # ==================================================================

    def is_installed(self) -> bool:
        return self._installed

    def detect(self) -> bool:
        """检测根目录是否存在 MaiBot 文件夹，切换教程/控制面板。"""
        self._installed = os.path.isdir(os.path.join(self._project_path, "MaiBot"))
        self._stack.setCurrentWidget(
            self._control_panel if self._installed else self._tutorial_panel
        )
        self._apply_view()
        self.installed_changed.emit(self._installed)
        return self._installed

    def set_values(self, autostart: bool, browser_maibot: bool,
                   browser_snowluma: bool):
        """启动时从配置回填勾选状态（阻断信号防止触发自动保存）。"""
        widgets = [
            (self.autostart_switch, autostart),
            (self.browser_maibot_switch, browser_maibot),
            (self.browser_snowluma_switch, browser_snowluma),
        ]
        for w, value in widgets:
            w.blockSignals(True)
            w.setChecked(value)
            w.blockSignals(False)

    def append_log(self, service_key: str, text: str):
        """写入控制台。service_key 为 maibot/snowluma/system（system 写入两个标签页）。"""
        if service_key == "system":
            self.maibot_log.append_line(text)
            self.snowluma_log.append_line(text)
        elif service_key == "snowluma":
            self.snowluma_log.append_line(text)
        else:
            self.maibot_log.append_line(text)

    def update_status(self, service_key: str, status: str, pid=None):
        running = status == "running"
        if service_key == "snowluma":
            self.snowluma_indicator.set_running(running, pid)
        else:
            self.maibot_indicator.set_running(running, pid)
        self._statuses[service_key] = status

        if self._any_active_status():
            self._saw_activity = True
        elif self._stop_requested:
            # 用户主动停止且已全部停下 → 回到启动前视图
            self._stop_requested = False
            self._launch_requested = False

        self._apply_view()
        self._refresh_buttons()

    def mark_launch_failed(self, errors: list[str]):
        """前置检查失败：回到启动前视图并展示原因。"""
        self._launch_requested = False
        self._stop_requested = False
        self._idle_error.setText("启动失败：" + "；".join(errors))
        self._idle_error.show()
        self._apply_view()
        self._refresh_buttons()

    # ==================================================================
    # Internal
    # ==================================================================

    def _on_redetect(self):
        if self.detect():
            self._detect_hint.hide()
            self.append_log("system", "[系统] ✓ 已检测到 MaiBot 文件夹")
        else:
            self._detect_hint.show()

    # ------------------------------------------------------------------
    # 视图状态机
    # ------------------------------------------------------------------

    def _on_start_clicked(self):
        self._launch_requested = True
        self._stop_requested = False
        self._saw_activity = False
        self._idle_error.hide()
        self.append_log("system", "[系统] 正在准备启动（清理端口中）...")
        self._apply_view()
        self._refresh_buttons()
        self.start_clicked.emit()

    def _on_stop_clicked(self):
        self._stop_requested = True
        self.stop_clicked.emit()

    def _on_back_clicked(self):
        self._launch_requested = False
        self._apply_view()
        self._refresh_buttons()

    def _apply_view(self):
        """启动前(0) / 启动后(1) 视图切换：有活动进程或已请求启动 → 启动后视图。"""
        if not self._installed or not hasattr(self, "_mode_stack"):
            return
        running_mode = self._launch_requested or self._any_active_status()
        self._mode_stack.setCurrentIndex(1 if running_mode else 0)

    def _any_active_status(self) -> bool:
        return any(
            s in ("starting", "running", "stopping")
            for s in self._statuses.values()
        )

    def _refresh_buttons(self):
        any_active = self._any_active_status()
        in_run_view = self._mode_stack.currentIndex() == 1
        # 停止按钮：有进程活动时可用；返回按钮：进程已全部退出（异常退出）时供回到启动前
        self.stop_btn.setVisible(any_active)
        self.stop_btn.setEnabled(any_active)
        self.back_btn.setVisible(
            not any_active and self._saw_activity and in_run_view
        )


# ==================================================================
# 样式
# ==================================================================


def _card_style() -> str:
    # 注意用 .QFrame 精确匹配：QLabel 是 QFrame 子类，若写成 QFrame{}
    # 会给卡片内所有文字加上边框
    return """
        .QFrame {
            background: #FCFAF8;
            border: 1px solid #E5D9D2;
            border-radius: 8px;
        }
    """


def _launch_btn_style() -> str:
    return """
        QPushButton {
            background: #E07B6C; color: #FCFAF8; font-size: 16px;
            font-weight: bold; border: none; border-radius: 10px;
        }
        QPushButton:hover { background: #D96D5D; }
        QPushButton:pressed { background: #C95F4F; }
        QPushButton:disabled {
            background: #E5D9D2; color: #C9C0BB;
        }
    """


def _primary_btn_style() -> str:
    return """
        QPushButton {
            background: #E07B6C; color: #FCFAF8; font-size: 12px;
            padding: 6px 14px; border-radius: 6px; border: none;
        }
        QPushButton:hover { background: #D96D5D; }
        QPushButton:pressed { background: #C95F4F; }
        QPushButton:disabled {
            background: #E5D9D2; color: #C9C0BB;
        }
    """


def _outline_btn_style() -> str:
    return """
        QPushButton {
            background: #FCFAF8; color: #E07B6C; font-size: 12px;
            padding: 6px 14px; border-radius: 6px;
            border: 1px solid #E07B6C;
        }
        QPushButton:hover { background: #F7D7D1; }
        QPushButton:pressed { background: #F0C2BA; }
    """


def _tab_style() -> str:
    return """
        QTabWidget::pane {
            border: 1px solid #E5D9D2;
            border-radius: 6px;
            background: #FCFAF8;
        }
        QTabBar::tab {
            background: #E5D9D2;
            color: #756B65;
            font-size: 12px;
            padding: 5px 18px;
            margin-right: 4px;
            border-top-left-radius: 6px;
            border-top-right-radius: 6px;
        }
        QTabBar::tab:selected {
            background: #E07B6C;
            color: #FCFAF8;
            font-weight: bold;
        }
    """
