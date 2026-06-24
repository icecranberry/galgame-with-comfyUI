"""
主窗口 —— 无边框 + 左侧导航 + QStackedWidget 页面切换 + Toast。
"""
import os
import sys
import socket
import subprocess
import webbrowser
from PySide6.QtWidgets import (
    QMainWindow,
    QWidget,
    QStackedWidget,
    QPushButton,
    QLabel,
    QHBoxLayout,
    QVBoxLayout,
    QGraphicsOpacityEffect,
    QGraphicsDropShadowEffect,
    QSizeGrip,
    QApplication,
)
from PySide6.QtCore import Qt, QTimer, QPropertyAnimation, QEasingCurve, Signal, QRect, QPoint
from PySide6.QtGui import QColor, QPixmap, QPainterPath, QRegion

from .config_manager import ConfigManager
from .git_manager import GitManager
from .build_manager import BuildManager
from .service_runner import ServiceRunner, ServiceWorker
from .home_page import HomePage
from .log_page import LogPage
from .version_page import VersionPage
from .settings_page import SettingsPage
from .qa_page import QAPage


# 窗口尺寸
WINDOW_W = 900
WINDOW_H = 600
NAV_W = 72  # 左侧导航宽度
SHADOW_MARGIN = 12  # 窗口投影留白


def _exe_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _assets_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.join(sys._MEIPASS, "assets")  # type: ignore
    return os.path.join(os.path.dirname(__file__), "..", "assets")


class Toast(QWidget):
    """半透明浮层通知，淡入 → 停留 → 淡出。"""

    def __init__(self, parent, text: str):
        super().__init__(parent)
        self.setAttribute(Qt.WA_TransparentForMouseEvents)
        self.setStyleSheet(
            "background: rgba(46,42,39,0.92); color: #FCFAF8; font-size: 14px; "
            "padding: 16px 28px; border-radius: 10px;"
        )
        label = QLabel(text, self)
        label.setAlignment(Qt.AlignCenter)
        layout = QVBoxLayout(self)
        layout.addWidget(label)
        layout.setContentsMargins(0, 0, 0, 0)

        self._opacity_effect = QGraphicsOpacityEffect(self)
        self._opacity_effect.setOpacity(0.0)
        self.setGraphicsEffect(self._opacity_effect)

    def show_toast(self, duration_ms: int = 3000):
        self.show()
        self.raise_()
        toast_w = min(self.parent().width() - 100, 600)
        self.resize(toast_w, 50)
        self.move(
            (self.parent().width() - toast_w) // 2,
            self.parent().height() - 130,
        )

        self._fade_in = QPropertyAnimation(self._opacity_effect, b"opacity")
        self._fade_in.setDuration(300)
        self._fade_in.setStartValue(0.0)
        self._fade_in.setEndValue(1.0)
        self._fade_in.setEasingCurve(QEasingCurve.OutCubic)

        self._fade_out = QPropertyAnimation(self._opacity_effect, b"opacity")
        self._fade_out.setDuration(400)
        self._fade_out.setStartValue(1.0)
        self._fade_out.setEndValue(0.0)
        self._fade_out.setEasingCurve(QEasingCurve.InCubic)
        self._fade_out.finished.connect(self.hide)

        self._fade_in.finished.connect(
            lambda: QTimer.singleShot(duration_ms, self._fade_out.start)
        )
        self._fade_in.start()


class MainWindow(QMainWindow):
    """邻舍.EXE 启动器主窗口。"""

    PAGE_HOME = 0
    PAGE_LOG = 1
    PAGE_VERSION = 2
    PAGE_SETTINGS = 3
    PAGE_QA = 4

    def __init__(self):
        super().__init__()

        self._exe_dir = _exe_dir()
        self._assets_dir = _assets_dir()

        self._config = ConfigManager(self._exe_dir)
        self._project_path = self._exe_dir
        self._git = GitManager(self._project_path)
        self._build = BuildManager(self._project_path)
        self._runner = ServiceRunner(self._project_path)

        self._is_built = False
        self._switching_version = False
        self._closing = False
        self._cached_tags: list[str] = []
        self._cached_current_tag: str | None = None
        self._cached_has_updates: bool | None = None
        self._git_ready = False
        self._slide_anim: QPropertyAnimation | None = None
        self._animating = False
        self._cached_ip: str | None = None

        self._setup_window()
        self._setup_title_bar()
        self._setup_pages()
        self._setup_nav()
        self._setup_shutdown_overlay()
        self._connect_signals()

        self._load_settings_to_form()
        saved_version = self._config.get("version_display")
        if saved_version:
            self._home_page.update_version_info(saved_version, "", self._cached_has_updates)
        QTimer.singleShot(1000, self._lazy_git_init)

    # ==================================================================
    # 窗口
    # ==================================================================

    def _setup_window(self):
        self.setWindowTitle("邻舍.EXE")
        self.setMinimumSize(700, 500)
        self.resize(WINDOW_W + SHADOW_MARGIN * 2, WINDOW_H + SHADOW_MARGIN * 2)
        # FramelessWindowHint 去掉边框；WindowMinimizeButtonHint 告诉
        # Windows 此窗口支持最小化，恢复任务栏点击切换最小化/还原的行为。
        self.setWindowFlags(
            Qt.FramelessWindowHint
            | Qt.WindowSystemMenuHint
            | Qt.WindowMinimizeButtonHint
        )
        self.setAttribute(Qt.WA_TranslucentBackground)

        # central: 透明背景，承载投影
        central = QWidget()
        central.setStyleSheet("background: transparent;")
        self.setCentralWidget(central)
        self._central = central

        # 窗口投影（暖色浅色主题用更柔和的阴影）
        self._window_shadow = QGraphicsDropShadowEffect(central)
        self._window_shadow.setBlurRadius(28)
        self._window_shadow.setOffset(0, 8)
        self._window_shadow.setColor(QColor(0, 0, 0, 50))
        central.setGraphicsEffect(self._window_shadow)

        # 内容容器：圆角遮罩 + 暖色奶油风背景，偏移 SHADOW_MARGIN 给投影留白
        self._content = QWidget(central)
        self._content.setObjectName("content")
        self._content.setStyleSheet("""
            #content {
                background: #F7F3F0;
                border-radius: 12px;
            }
        """)
        self._update_content_geometry()

        # 右下角拖拽调整大小
        self._grip = QSizeGrip(self._content)
        self._grip.setFixedSize(16, 16)
        self._grip.setStyleSheet("background: transparent;")

    # ==================================================================
    # 标题栏按钮（右上角）
    # ==================================================================

    def _setup_title_bar(self):
        content = self._content

        # 给文字加阴影的按钮
        self._min_btn = QPushButton("—", content)
        self._min_btn.setStyleSheet(_title_btn_style())
        self._min_btn.clicked.connect(self.showMinimized)
        self._min_btn.setFixedSize(36, 28)
        _add_text_shadow(self._min_btn)

        self._close_btn = QPushButton("✕", content)
        self._close_btn.setStyleSheet(_title_btn_style())
        self._close_btn.clicked.connect(self.close)
        self._close_btn.setFixedSize(36, 28)
        _add_text_shadow(self._close_btn)

        self._update_title_buttons_position()

    def _update_title_buttons_position(self):
        w = self._content.width()
        self._min_btn.move(w - 76, 10)
        self._close_btn.move(w - 46, 10)

    # ==================================================================
    # 页面栈
    # ==================================================================

    def _setup_pages(self):
        content = self._content
        self._stack = QStackedWidget(content)
        self._stack.setStyleSheet("""
            QStackedWidget {
                background: transparent;
                border-top-right-radius: 12px;
                border-bottom-right-radius: 12px;
            }
        """)
        self._update_stack_geometry()

        self._home_page = HomePage(self._assets_dir, self._exe_dir)
        self._stack.addWidget(self._home_page)

        self._log_page = LogPage()
        self._stack.addWidget(self._log_page)

        self._version_page = VersionPage()
        self._stack.addWidget(self._version_page)

        self._settings_page = SettingsPage()
        self._stack.addWidget(self._settings_page)

        self._qa_page = QAPage()
        self._stack.addWidget(self._qa_page)

        self._stack.setCurrentIndex(self.PAGE_HOME)

        # 标题栏按钮浮在页面之上
        self._min_btn.raise_()
        self._close_btn.raise_()

    # ==================================================================
    # 左侧导航
    # ==================================================================

    def _setup_nav(self):
        content = self._content
        self._nav = QWidget(content)
        self._nav.setObjectName("nav")
        self._nav.setStyleSheet("""
            #nav {
                background: #E07B6C;
                border-top-left-radius: 12px;
                border-bottom-left-radius: 12px;
            }
        """)
        self._update_nav_geometry()

        layout = QVBoxLayout(self._nav)
        layout.setContentsMargins(10, 10, 10, 24)
        layout.setSpacing(4)

        # --- Navbar 顶部标题图片 ---
        nav_title_path = os.path.join(self._assets_dir, "navbar-title.png")
        nav_title_pixmap = QPixmap(nav_title_path)
        img_max_w = NAV_W - 20  # 左右各 10px 留空
        if nav_title_pixmap.width() > img_max_w:
            nav_title_pixmap = nav_title_pixmap.scaledToWidth(img_max_w, Qt.SmoothTransformation)
        self._nav_title_img = QLabel(self._nav)
        self._nav_title_img.setPixmap(nav_title_pixmap)
        self._nav_title_img.setAlignment(Qt.AlignCenter)
        self._nav_title_img.setStyleSheet("background: transparent;")
        layout.addWidget(self._nav_title_img)
        layout.addSpacing(8)

        layout.addStretch()  # 把按钮推到底部

        self._nav_btns: list[QPushButton] = []
        labels = ["首页", "日志", "版本", "设置", "Q&A"]

        for i, label in enumerate(labels):
            btn = QPushButton(label, self._nav)
            btn.setStyleSheet(_nav_btn_style(active=False))
            btn.setCursor(Qt.PointingHandCursor)
            btn.setFixedSize(NAV_W - 16, 40)
            idx = i
            btn.clicked.connect(lambda checked=False, p=idx: self._switch_page(p))
            layout.addWidget(btn)
            self._nav_btns.append(btn)

        self._update_nav_highlight(self.PAGE_HOME)

    # ==================================================================
    # 关闭遮罩
    # ==================================================================

    def _setup_shutdown_overlay(self):
        """全屏半透明遮罩，在关闭服务时显示「正在关闭服务...」。"""
        content = self._content
        self._shutdown_overlay = QWidget(content)
        self._shutdown_overlay.setObjectName("shutdownOverlay")
        self._shutdown_overlay.setStyleSheet("""
            #shutdownOverlay {
                background: rgba(46, 42, 39, 0.78);
                border-radius: 12px;
            }
        """)
        self._shutdown_overlay.hide()

        layout = QVBoxLayout(self._shutdown_overlay)
        layout.setAlignment(Qt.AlignCenter)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(16)

        # 加载动画点（模拟转圈）
        self._spinner_label = QLabel("⠋", self._shutdown_overlay)
        self._spinner_label.setStyleSheet(
            "color: #E07B6C; font-size: 32px; background: transparent;"
        )
        self._spinner_label.setAlignment(Qt.AlignCenter)

        text_label = QLabel("正在安全关闭服务...", self._shutdown_overlay)
        text_label.setStyleSheet(
            "color: white; font-size: 16px; font-weight: bold; background: transparent;"
        )
        text_label.setAlignment(Qt.AlignCenter)

        sub_label = QLabel("请稍候，正在停止邻舍后端进程", self._shutdown_overlay)
        sub_label.setStyleSheet(
            "color: rgba(255,255,255,0.5); font-size: 12px; background: transparent;"
        )
        sub_label.setAlignment(Qt.AlignCenter)

        layout.addStretch()
        layout.addWidget(self._spinner_label)
        layout.addWidget(text_label)
        layout.addWidget(sub_label)
        layout.addStretch()

    # ==================================================================
    # 信号连接
    # ==================================================================

    def _connect_signals(self):
        self._home_page.launch_clicked.connect(self._on_launch)
        self._home_page.open_comfyui_clicked.connect(self._on_open_comfyui_from_home)
        self._home_page.open_directory.connect(self._on_open_directory)

        self._log_page.stop_all_clicked.connect(self._on_stop_all)
        self._log_page.start_clicked.connect(self._start_services)

        self._version_page.check_update_clicked.connect(self._on_check_update)
        self._version_page.switch_tag_clicked.connect(self._on_switch_tag)
        self._version_page.force_rebuild_clicked.connect(self._on_force_rebuild)
        self._version_page.cancel_build_clicked.connect(self._on_cancel_build)
        self._version_page.tag_list.itemClicked.connect(
            lambda: self._version_page.on_tag_selection_changed()
        )

        self._settings_page.setting_changed.connect(
            lambda key, value: self._config.set(key, value)
        )
        self._settings_page.open_comfyui_clicked.connect(self._on_open_comfyui)

        self._git.output.connect(self._on_git_output)
        self._git.operation_done.connect(self._on_git_operation_done)

        self._build.step_changed.connect(self._on_build_step)
        self._build.output.connect(self._on_build_output)
        self._build.build_done.connect(self._on_build_done)

        self._runner.output.connect(self._on_service_output)
        self._runner.status_summary.connect(self._on_service_status)

    # ==================================================================
    # 页面切换
    # ==================================================================

    def _switch_page(self, index: int):
        if index == self._stack.currentIndex():
            return

        # 打断正在进行的动画，恢复位置
        if self._slide_anim is not None:
            self._slide_anim.stop()
            self._slide_anim = None
        self._animating = False
        self._stack.move(NAV_W, 0)

        self._update_nav_highlight(index)

        # 页面区域下移 20px → 切换 → 从下往上滑入 (20px → 0px, 200ms)
        self._stack.move(NAV_W, 20)
        self._stack.setCurrentIndex(index)
        self._min_btn.raise_()
        self._close_btn.raise_()

        self._animating = True
        self._slide_anim = QPropertyAnimation(self._stack, b"pos")
        self._slide_anim.setDuration(200)
        self._slide_anim.setStartValue(QPoint(NAV_W, 20))
        self._slide_anim.setEndValue(QPoint(NAV_W, 0))
        self._slide_anim.setEasingCurve(QEasingCurve.OutCubic)
        self._slide_anim.finished.connect(self._on_slide_done)
        self._slide_anim.start()

        if index == self.PAGE_VERSION:
            self._version_page.set_current_tag(self._cached_current_tag)
            self._version_page.set_tags(self._cached_tags)
            self._version_page.set_remote_status(self._cached_has_updates)

    def _on_slide_done(self):
        """动画结束，确保位置精确归位。"""
        self._stack.move(NAV_W, 0)
        self._animating = False
        self._slide_anim = None

    def _update_nav_highlight(self, active: int):
        for i, btn in enumerate(self._nav_btns):
            btn.setStyleSheet(_nav_btn_style(active=(i == active)))

    # ==================================================================
    # 一键启动
    # ==================================================================

    def _on_launch(self):
        # 检查是否配置了 ComfyUI 启动器路径
        comfyui_path = self._config.get("comfyui_exe")
        if not comfyui_path:
            toast = Toast(self._content, "请先配置 ComfyUI 启动器路径")
            toast.show_toast(3000)
            self._switch_page(self.PAGE_SETTINGS)
            return

        self._switch_page(self.PAGE_LOG)

        if not self._build.is_built():
            self._log_page.append_log("[系统] 检测到未构建，开始自动构建...")
            self._home_page.set_launch_state("building")
            self._log_page.set_busy_state(True, "⏳ 构建中...")
            self._build.use_mirror = self._config.get("use_mirror")
            self._build.start_build(force=True)
        else:
            self._home_page.set_launch_state("starting")
            self._log_page.set_busy_state(True, "⏳ 启动中...")
            self._start_services()

    def _on_stop_all(self):
        self._log_page.append_log("[系统] 正在停止所有服务...")
        self._runner.stop_all()

    def _start_services(self):
        if self._config.get("check_comfyui_before_start"):
            toast = Toast(self._content, "⚠ 请确认已经启动 ComfyUI")
            toast.show_toast(3000)
        self._log_page.append_log("[系统] 正在启动服务...")
        self._home_page.set_launch_state("starting")
        self._log_page.set_busy_state(True, "⏳ 启动中...")
        self._runner.start_all()

    # ==================================================================
    # 版本管理
    # ==================================================================

    def _on_check_update(self):
        self._version_page.append_log("正在检查更新...")
        err = self._git.fetch_remote()
        if err:
            self._version_page.append_log(f"[ERROR] {err}")

    def _on_switch_tag(self, tag: str):
        self._switching_version = True
        self._version_page.set_building(True)
        self._version_page.append_log(f"正在切换到 {tag}...")
        err = self._git.checkout_tag(tag)
        if err:
            self._version_page.append_log(f"[ERROR] {err}")
            self._version_page.set_building(False)
            self._switching_version = False

    def _on_force_rebuild(self):
        self._switch_page(self.PAGE_VERSION)
        self._version_page.set_building(True)
        self._version_page.append_log("开始强制重新构建...")
        self._home_page.set_launch_state("building")
        self._build.use_mirror = self._config.get("use_mirror")
        self._build.start_build(force=True)

    def _on_cancel_build(self):
        self._build.cancel()

    # ==================================================================
    # Git 信号
    # ==================================================================

    def _on_git_output(self, text: str):
        self._version_page.append_log(text)

    def _on_git_operation_done(self, operation: str, success: bool, message: str):
        if operation == "fetch":
            if success:
                self._init_git_cache()
                try:
                    self._cached_has_updates = self._git.has_updates()
                except Exception:
                    pass
                self._version_page.set_current_tag(self._cached_current_tag)
                self._version_page.set_tags(self._cached_tags)
                self._version_page.set_remote_status(self._cached_has_updates)
                self._version_page.append_log("检查完成")
                self._home_page.update_version_info(
                    self._cached_current_tag, "main", self._cached_has_updates
                )
            else:
                self._version_page.append_log(f"[ERROR] fetch 失败: {message}")

        elif operation == "checkout":
            if success:
                self._version_page.append_log("✓ 已切换到目标版本")
                self._init_git_cache()
                self._config.set("current_tag", self._cached_current_tag or "")
                self._version_page.set_current_tag(self._cached_current_tag)
                self._version_page.set_tags(self._cached_tags)
                self._version_page.append_log("开始构建新版本...")
                self._build.start_build(force=True)
            else:
                self._version_page.append_log(f"[ERROR] checkout 失败: {message}")
                self._version_page.set_building(False)
                self._switching_version = False

    # ==================================================================
    # Build 信号
    # ==================================================================

    def _on_build_step(self, step_name: str):
        self._log_page.append_log(f"[构建] --- {step_name} ---")
        self._version_page.append_log(f"--- {step_name} ---")

    def _on_build_output(self, text: str):
        self._log_page.append_log(f"[构建] {text}")
        self._version_page.append_log(text)

    def _on_build_done(self, success: bool, message: str):
        self._version_page.set_building(False)
        self._is_built = success
        if success:
            self._log_page.append_log(f"[构建] ✓ {message}")
            self._version_page.append_log(f"✓ {message}")
            if self._switching_version:
                self._switching_version = False
                self._version_page.append_log("版本切换完成，可以启动项目")
            if self._stack.currentIndex() == self.PAGE_LOG:
                self._start_services()
        else:
            self._log_page.append_log(f"[ERROR] 构建失败: {message}")
            self._version_page.append_log(f"[ERROR] {message}")
            self._switching_version = False
            self._home_page.set_launch_state(False)
            self._log_page.set_busy_state(False)

    # ==================================================================
    # 服务信号
    # ==================================================================

    def _on_service_output(self, service_name: str, text: str):
        self._log_page.append_log(text)

    def _on_service_status(self, v_status: str, a_status: str, overall: str):
        self._log_page.update_service_status(
            "vector", v_status,
            self._runner.vector_worker.pid if v_status == "running" else None,
        )
        self._log_page.update_service_status(
            "agent_core", a_status,
            self._runner.agent_worker.pid if a_status == "running" else None,
        )

        # 同步首页启动按钮状态
        is_running = v_status == "running" or a_status == "running"
        if is_running:
            self._home_page.set_launch_state(True)
            self._log_page.set_busy_state(False)
        elif overall == "all_stopped":
            self._home_page.set_launch_state(False)
            self._log_page.set_busy_state(False)

        # 手机端访问条幅：agent_core 运行即常驻显示（仅日志页）
        if a_status == "running":
            self._log_page.show_mobile_banner()
        else:
            self._log_page.hide_mobile_banner()

        if overall == "all_running" and self._config.get("auto_open_browser"):
            ip = self._get_local_ip()
            url = f"http://localhost:3099?mobile_ip={ip}" if ip else "http://localhost:3099"
            webbrowser.open(url)
            self._log_page.append_log(f"[系统] 🌐 浏览器已打开 {url}")

    # ==================================================================
    # 设置
    # ==================================================================

    def _on_save_settings(self, data: dict):
        for key, value in data.items():
            self._config.set(key, value)
        self._log_page.append_log("[系统] 设置已保存")

    def _on_open_directory(self, dir_path: str):
        """打开目录：不存在则自动创建，失败时 Toast 提示。"""
        try:
            os.makedirs(dir_path, exist_ok=True)
            os.startfile(dir_path)
        except Exception as e:
            toast = Toast(self._content, f"无法打开目录: {e}")
            toast.show_toast(3000)

    def _on_open_comfyui_from_home(self):
        path = self._config.get("comfyui_exe")
        if path and os.path.exists(path):
            self._open_in_own_dir(path)
        else:
            self._switch_page(self.PAGE_SETTINGS)

    def _on_open_comfyui(self):
        path = self._config.get("comfyui_exe")
        if path and os.path.exists(path):
            self._open_in_own_dir(path)
        else:
            toast = Toast(self._content, "ComfyUI 启动器路径无效，请先配置")
            toast.show_toast(3000)

    @staticmethod
    def _open_in_own_dir(path: str):
        """用 subprocess 打开文件，工作目录设为文件所在目录。"""
        subprocess.Popen([path], cwd=os.path.dirname(path), shell=False)

    def _get_local_ip(self) -> str | None:
        """获取本机局域网 IP 地址（带缓存）。失败时返回 None。"""
        if self._cached_ip is not None:
            return self._cached_ip
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(1)
            s.connect(("8.8.8.8", 80))
            self._cached_ip = s.getsockname()[0]
            s.close()
        except Exception:
            self._cached_ip = None
        return self._cached_ip

    def _load_settings_to_form(self):
        self._settings_page.set_values(
            comfyui_exe=self._config.get("comfyui_exe"),
            auto_browser=self._config.get("auto_open_browser"),
            check_comfyui=self._config.get("check_comfyui_before_start"),
            use_mirror=self._config.get("use_mirror"),
        )

    # ==================================================================
    # 状态
    # ==================================================================

    def _lazy_git_init(self):
        # 仅检查 git 是否在已知安装路径中存在，不扫 PATH 防止卡死
        git_exe = os.path.join(os.path.expandvars(r"%ProgramFiles%\Git\bin"), "git.exe")
        git_cmd = os.path.join(os.path.expandvars(r"%ProgramFiles%\Git\cmd"), "git.exe")
        if not os.path.isfile(git_exe) and not os.path.isfile(git_cmd):
            self._home_page.update_version_info(None, "Git 未安装", None)
            self._git_ready = True
            return
        if not self._git.is_git_repo():
            self._home_page.update_version_info(None, "无 Git 仓库", None)
            self._git_ready = True
            return
        self._maybe_daily_fetch()

    def _init_git_cache(self):
        if not self._git.is_git_repo():
            return
        try:
            self._cached_current_tag = self._git.get_current_tag()
            self._cached_tags = self._git.get_tags()
        except Exception:
            pass
        branch = self._git.get_current_branch()
        version_display = self._cached_current_tag or branch
        self._home_page.update_version_info(
            self._cached_current_tag, branch, self._cached_has_updates,
        )
        self._config.set("current_tag", self._cached_current_tag or "")
        self._config.set("version_display", version_display)
        self._git_ready = True

    def _maybe_daily_fetch(self):
        import datetime

        today = datetime.date.today().isoformat()
        last_fetch = self._config.get("last_fetch_date")
        if last_fetch != today:
            self._config.set("last_fetch_date", today)
            self._git.fetch_remote()

    # ==================================================================
    # 窗口事件
    # ==================================================================

    def _update_content_geometry(self):
        """内容容器偏移 SHADOW_MARGIN，跟随窗口大小动态缩放。"""
        cw = self.width() - SHADOW_MARGIN * 2
        ch = self.height() - SHADOW_MARGIN * 2
        self._content.setGeometry(SHADOW_MARGIN, SHADOW_MARGIN, cw, ch)

    def _update_stack_geometry(self):
        w = self._content.width()
        h = self._content.height()
        if self._animating:
            self._stack.setGeometry(NAV_W, self._stack.y(), w - NAV_W, h)
        else:
            self._stack.setGeometry(NAV_W, 0, w - NAV_W, h)

    def _update_nav_geometry(self):
        h = self._content.height()
        self._nav.setGeometry(0, 0, NAV_W, h)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._update_content_geometry()
        self._update_title_buttons_position()
        self._update_stack_geometry()
        self._update_nav_geometry()
        self._min_btn.raise_()
        self._close_btn.raise_()
        # 右下角拖拽手柄
        cw, ch = self._content.width(), self._content.height()
        self._grip.move(cw - 20, ch - 20)
        self._grip.raise_()
        self._apply_rounded_mask()
        # 关闭遮罩跟随窗口
        if hasattr(self, "_shutdown_overlay") and self._shutdown_overlay.isVisible():
            self._shutdown_overlay.setGeometry(self._content.rect())

    def _apply_rounded_mask(self):
        """用 QPainterPath 生成 12px 圆角区域，裁剪内容容器。"""
        r = 12
        w, h = self._content.width(), self._content.height()
        path = QPainterPath()
        path.addRoundedRect(0, 0, w, h, r, r)
        self._content.setMask(QRegion(path.toFillPolygon().toPolygon()))

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            pos = event.position().toPoint()
            if pos.y() < 40:
                self._drag_pos = event.globalPosition().toPoint()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if hasattr(self, "_drag_pos") and self._drag_pos is not None:
            if event.buttons() == Qt.LeftButton:
                delta = event.globalPosition().toPoint() - self._drag_pos
                self.move(self.pos() + delta)
                self._drag_pos = event.globalPosition().toPoint()
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self._drag_pos = None
        super().mouseReleaseEvent(event)

    def closeEvent(self, event):
        """窗口关闭时安全停止所有服务（完全非阻塞，由信号驱动关闭）。"""
        if not self._runner.is_any_running():
            event.accept()
            return

        # 第二轮进入：关闭流程已触发，直接接受
        if self._closing:
            event.accept()
            return

        # 第一轮：启动异步关闭流程
        self._closing = True
        event.ignore()

        # 显示遮罩 + 启动转圈动画
        self._shutdown_overlay.setGeometry(self._content.rect())
        self._shutdown_overlay.show()
        self._shutdown_overlay.raise_()
        self._start_spinner()

        self._log_page.append_log("[系统] 窗口关闭，正在安全停止服务...")
        self._runner.stop_all()

        # 服务全部停止后自动关闭窗口
        def on_all_stopped(vs, acs, overall):
            if overall == "all_stopped":
                try:
                    self._runner.status_summary.disconnect(on_all_stopped)
                except RuntimeError:
                    pass
                self._stop_spinner()
                self.close()

        self._runner.status_summary.connect(on_all_stopped)

        # 硬超时兜底：12 秒后强制退出
        QTimer.singleShot(12000, self._force_close)

    def _force_close(self):
        """硬超时：断开所有状态监听，强制清理并关闭窗口。"""
        self._log_page.append_log("[系统] 关闭超时，强制退出...")
        try:
            self._runner.status_summary.disconnect()
        except RuntimeError:
            pass
        self._runner._force_kill_all()
        self._stop_spinner()
        self._closing = False
        self.close()

    # ------------------------------------------------------------------
    # 转圈动画
    # ------------------------------------------------------------------

    _SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

    def _start_spinner(self):
        """启动关闭遮罩上的 braille 转圈动画。"""
        self._spinner_idx = 0
        self._spinner_label.setText(self._SPINNER_FRAMES[0])
        self._spinner_timer = QTimer(self)
        self._spinner_timer.timeout.connect(self._tick_spinner)
        self._spinner_timer.start(80)

    def _tick_spinner(self):
        self._spinner_idx = (self._spinner_idx + 1) % len(self._SPINNER_FRAMES)
        self._spinner_label.setText(self._SPINNER_FRAMES[self._spinner_idx])

    def _stop_spinner(self):
        if hasattr(self, "_spinner_timer") and self._spinner_timer:
            self._spinner_timer.stop()
            self._spinner_timer.deleteLater()
            self._spinner_timer = None


# ==================================================================
# 样式
# ==================================================================


def _add_text_shadow(btn: QPushButton):
    """给按钮文字添加阴影（浅色主题下极淡）。"""
    shadow = QGraphicsDropShadowEffect(btn)
    shadow.setBlurRadius(4)
    shadow.setOffset(0, 1)
    shadow.setColor(QColor(0, 0, 0, 30))
    btn.setGraphicsEffect(shadow)


def _title_btn_style() -> str:
    return """
        QPushButton {
            background: transparent;
            color: #756B65;
            font-size: 14px;
            font-weight: bold;
            border: none;
            border-radius: 4px;
            padding: 4px 8px;
        }
        QPushButton:hover {
            background: rgba(224,123,108,0.12);
            color: #E07B6C;
        }
    """


def _nav_btn_style(active: bool = False) -> str:
    if active:
        return """
            QPushButton {
                background: rgba(255,255,255,0.22);
                color: #FCFAF8;
                font-size: 13px;
                font-weight: bold;
                border: none;
                border-radius: 6px;
                text-align: left;
                padding-left: 12px;
            }
        """
    return """
        QPushButton {
            background: transparent;
            color: rgba(255,255,255,0.72);
            font-size: 13px;
            border: none;
            border-radius: 6px;
            text-align: left;
            padding-left: 12px;
        }
        QPushButton:hover {
            background: rgba(255,255,255,0.12);
            color: #FCFAF8;
        }
    """
