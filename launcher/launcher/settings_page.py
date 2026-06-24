"""
设置页 —— ComfyUI 路径、开关、镜像源、仓库信息。
"""
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QFileDialog,
    QFrame,
)
from PySide6.QtCore import Qt, Signal
from .switch import Switch


class SettingsPage(QWidget):
    """设置页面。"""

    # 信号
    setting_changed = Signal(str, object)  # key, value — 实时自动保存
    open_comfyui_clicked = Signal()
    browse_comfyui_clicked = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()

    def _setup_ui(self):
        self.setStyleSheet("background: #F7F3F0;")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 44, 24, 12)
        layout.setSpacing(14)

        # --- ComfyUI 路径 ---
        comfy_label = QLabel("ComfyUI 启动器路径:")
        comfy_label.setStyleSheet("color: #2E2A27; font-size: 13px;")
        layout.addWidget(comfy_label)

        comfy_row = QHBoxLayout()
        self.comfy_path_input = QLineEdit()
        self.comfy_path_input.setStyleSheet(_input_style())
        self.comfy_path_input.setPlaceholderText("例如: D:\\AI\\ComfyUI-aki-v3\\绘世启动器.exe")
        comfy_row.addWidget(self.comfy_path_input)

        browse_btn = QPushButton("浏览...")
        browse_btn.setStyleSheet(_secondary_btn_style())
        browse_btn.clicked.connect(self._on_browse_comfyui)
        comfy_row.addWidget(browse_btn)

        open_btn = QPushButton("▸ 打开启动器")
        open_btn.setStyleSheet(_secondary_btn_style())
        open_btn.clicked.connect(self.open_comfyui_clicked.emit)
        comfy_row.addWidget(open_btn)

        layout.addLayout(comfy_row)

        # ComfyUI 状态
        self.comfy_status_label = QLabel("")
        self.comfy_status_label.setStyleSheet("color: #756B65; font-size: 12px;")
        layout.addWidget(self.comfy_status_label)

        # ComfyUI 引导（使用富文本 + wordWrap 保证完整显示）
        self.guide_label = QLabel(
            '<span style="color: #756B65; font-size: 12px;">'
            '• ComfyUI运行之后就可以把弹出的工作台关闭，并不刚需，邻舍.EXE会自动连接ComfyUI<br>'
            '• 新手请直接下载@秋叶aaaki的ComfyUI整合包+Anima模型，'
            '并在版本管理的内核页面升级到<span style="color: #ff4444; font-weight: bold;">v0.23.0</span>以上<br>'
            '下载地址 '
            '<a href="https://pan.quark.cn/s/8ee40c22ccc6?pwd=SWwE" style="color: #E07B6C; text-decoration: none;">'
            'https://pan.quark.cn/s/8ee40c22ccc6?pwd=SWwE</a>'
            '<br>'
            '• 老司机请确认已经放置了Anima模型发布页面的anima_baseV10、qwen_image_vae、anima_baseV10_txt，<br>'
            '并且内核升级到支持Anima的<span style="color: #ff4444; font-weight: bold;">v0.23.0</span>以上，'
            '<a href="https://pan.quark.cn/s/8ee40c22ccc6?pwd=SWwE" style="color: #E07B6C; text-decoration: none;">'
            'https://pan.quark.cn/s/8ee40c22ccc6?pwd=SWwE</a>'
            ' 也有单独Anima模型包下载'
            '<br>'
            '• 老司机也可以直接更改 <code style="color: #756B65; background: #F1ECE8; padding: 1px 4px; border-radius: 2px;">'
            'workflow\\制图工作流.json</code>，例如lora、模型、后处理，重启服务刷新'
            '</span>'
        )
        self.guide_label.setOpenExternalLinks(True)
        self.guide_label.setWordWrap(True)
        self.guide_label.setTextFormat(Qt.RichText)
        self.guide_label.setMinimumHeight(1)
        self.guide_label.setStyleSheet(
            "color: #756B65; font-size: 12px; background: transparent; border: none;"
        )
        layout.addWidget(self.guide_label)

        # --- 分隔线 ---
        layout.addWidget(_separator())

        # --- 开关 ---
        self.auto_browser_check = Switch("启动后自动打开浏览器 (http://localhost:3099)")
        layout.addWidget(self.auto_browser_check)

        self.toast_check = Switch("启动前提示确认 ComfyUI 已运行")
        layout.addWidget(self.toast_check)

        self.mirror_check = Switch("使用国内镜像源加速依赖下载 (npm+pip)")
        layout.addWidget(self.mirror_check)

        # 弹性空间把仓库地址推到底部
        layout.addStretch()

        # --- 仓库地址（右下角） ---
        repo_row = QHBoxLayout()
        repo_row.addStretch()
        repo_label = QLabel(
            '<a href="https://github.com/icecranberry/galgame-with-comfyUI"'
            ' style="color: #B09890; text-decoration: none; font-size: 11px;">'
            'github.com/icecranberry/galgame-with-comfyUI</a>'
        )
        repo_label.setOpenExternalLinks(True)
        repo_row.addWidget(repo_label)
        layout.addLayout(repo_row)

        # --- 实时自动保存：任何改动立即持久化 ---
        self.comfy_path_input.textChanged.connect(
            lambda text: self.setting_changed.emit("comfyui_exe", text)
        )
        self.auto_browser_check.toggled.connect(
            lambda checked: self.setting_changed.emit("auto_open_browser", checked)
        )
        self.toast_check.toggled.connect(
            lambda checked: self.setting_changed.emit("check_comfyui_before_start", checked)
        )
        self.mirror_check.toggled.connect(
            lambda checked: self.setting_changed.emit("use_mirror", checked)
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_values(self, comfyui_exe: str, auto_browser: bool, check_comfyui: bool,
                   use_mirror: bool = True):
        # 阻断信号防止初始化时触发自动保存
        self.comfy_path_input.blockSignals(True)
        self.auto_browser_check.blockSignals(True)
        self.toast_check.blockSignals(True)
        self.mirror_check.blockSignals(True)

        self.comfy_path_input.setText(comfyui_exe)
        self.auto_browser_check.setChecked(auto_browser)
        self.toast_check.setChecked(check_comfyui)
        self.mirror_check.setChecked(use_mirror)

        self.comfy_path_input.blockSignals(False)
        self.auto_browser_check.blockSignals(False)
        self.toast_check.blockSignals(False)
        self.mirror_check.blockSignals(False)

    def set_comfy_status(self, connected: bool):
        if connected:
            self.comfy_status_label.setText("● 已检测到 ComfyUI (:8188)")
            self.comfy_status_label.setStyleSheet("color: #4A9B4A; font-size: 12px;")
        else:
            self.comfy_status_label.setText("○ 未检测到 ComfyUI (:8188)")
            self.comfy_status_label.setStyleSheet("color: #C9C0BB; font-size: 12px;")

    # ------------------------------------------------------------------
    # Slots
    # ------------------------------------------------------------------

    def _on_browse_comfyui(self):
        path, _ = QFileDialog.getOpenFileName(
            self,
            "选择 ComfyUI 启动器",
            "",
            "可执行文件 (*.exe);;所有文件 (*.*)",
        )
        if path:
            self.comfy_path_input.setText(path)


# ------------------------------------------------------------------
# Style Helpers
# ------------------------------------------------------------------


def _input_style() -> str:
    return """
        QLineEdit {
            background: #FCFAF8; color: #2E2A27; border: 1px solid #E5D9D2;
            border-radius: 6px; padding: 8px 12px; font-size: 13px;
        }
        QLineEdit:focus { border-color: #E07B6C; }
    """


def _secondary_btn_style() -> str:
    return """
        QPushButton {
            background: #E5D9D2; color: #756B65; font-size: 12px;
            padding: 8px 14px; border-radius: 6px; border: none;
        }
        QPushButton:hover { background: #DDD0C8; color: #2E2A27; }
    """


def _separator() -> QFrame:
    line = QFrame()
    line.setFrameShape(QFrame.HLine)
    line.setStyleSheet("background: #E5D9D2; max-height: 1px; border: none;")
    return line
