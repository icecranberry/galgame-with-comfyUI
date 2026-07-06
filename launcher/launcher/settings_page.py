"""
设置页 —— ComfyUI 路径、开关、镜像源、仓库信息、数据迁移。
"""
import os
import shutil
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QFileDialog,
    QFrame,
    QMessageBox,
    QProgressBar,
)
from PySide6.QtCore import Qt, Signal, QThread
from PySide6.QtGui import QFont, QFontDatabase
from .switch import Switch

# 需要迁移的数据项（相对于项目根目录）
# type: "dir" 递归复制整个目录, "file" 复制单个文件
MIGRATE_ITEMS = [
    ("dir",  "agent-core/data"),
    ("dir",  "vector-service/chroma_data"),
    ("file", "agent-core/.env"),
]


# ==================================================================
# 后台迁移线程
# ==================================================================

class MigrateWorker(QThread):
    """在后台线程中执行数据迁移，通过信号报告进度。"""

    progress = Signal(int, int)        # (current, total) 文件计数
    current_item = Signal(str)         # 正在复制的项目名称
    item_done = Signal(str, bool, str) # (item_path, success, error_message)
    all_done = Signal(list, list)      # (success_items, failed_items)

    def __init__(self, source_root: str, target_root: str, items: list[tuple[str, str]]):
        super().__init__()
        self._source = source_root
        self._target = target_root
        self._items = items

    def run(self):
        # 第一步：统计所有待复制文件总数
        total_files = 0
        file_list: list[tuple[str, str, str]] = []  # (item_label, src, dst)

        for item_type, rel_path in self._items:
            src = os.path.join(self._source, rel_path)
            if item_type == "file":
                if os.path.isfile(src):
                    file_list.append((rel_path, src, os.path.join(self._target, rel_path)))
                    total_files += 1
            elif item_type == "dir":
                if os.path.isdir(src):
                    for root, _, files in os.walk(src):
                        for f in files:
                            src_file = os.path.join(root, f)
                            rel_file = os.path.relpath(src_file, self._source)
                            dst_file = os.path.join(self._target, rel_file)
                            file_list.append((rel_path, src_file, dst_file))
                            total_files += 1

        if total_files == 0:
            self.all_done.emit([], ["未找到任何可迁移的文件"])
            return

        # 第二步：逐文件复制，发射进度
        success_items: set[str] = set()
        failed_items: list[str] = []
        copied = 0
        last_reported_item = ""

        for item_label, src_file, dst_file in file_list:
            # 报告当前正在处理的项目
            if item_label != last_reported_item:
                last_reported_item = item_label
                self.current_item.emit(item_label)

            try:
                os.makedirs(os.path.dirname(dst_file), exist_ok=True)
                shutil.copy2(src_file, dst_file)
                success_items.add(item_label)
            except Exception as e:
                failed_items.append(f"{os.path.relpath(src_file, self._source)} ({e})")

            copied += 1
            self.progress.emit(copied, total_files)

        # 区分成功和失败的项目
        all_items = [rel for _, rel in self._items]
        ok = [it for it in all_items if it in success_items and it not in [f.split(" ")[0] for f in failed_items]]
        # 重新检测：检查目标是否确实存在
        final_ok = []
        final_fail = []
        for item_type, rel_path in self._items:
            src = os.path.join(self._source, rel_path)
            dst = os.path.join(self._target, rel_path)
            src_exists = os.path.isfile(src) if item_type == "file" else os.path.isdir(src)
            dst_exists = os.path.isfile(dst) if item_type == "file" else os.path.isdir(dst)
            if not src_exists:
                continue  # 源不存在，跳过（不视为失败）
            if dst_exists:
                final_ok.append(rel_path)
            else:
                # 查找对应的错误信息
                err_detail = next((f for f in failed_items if f.startswith(rel_path)), "未知错误")
                final_fail.append(err_detail)

        self.all_done.emit(final_ok, final_fail)


# ==================================================================
# 设置页
# ==================================================================

class SettingsPage(QWidget):
    """设置页面。"""

    # 信号
    setting_changed = Signal(str, object)  # key, value — 实时自动保存
    open_comfyui_clicked = Signal()
    browse_comfyui_clicked = Signal()
    migrate_panel_toggled = Signal(bool)  # True=展开, False=折叠

    def __init__(self, parent=None):
        super().__init__(parent)
        self._target_project_path = ""  # 当前安装根目录（由 MainWindow 注入）
        self._migrate_source_path = ""  # 用户选择的旧版本目录
        self._migrate_worker: MigrateWorker | None = None
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
            '<span style="color: #756B65; font-size: 13px;">'
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
            "color: #756B65; font-size: 13px; background: transparent; border: none;"
        )
        # ★ 显式加载 MiSans 字体并直接设到此标签
        _label_font = _load_misans_font()
        if _label_font:
            self.guide_label.setFont(_label_font)
        layout.addWidget(self.guide_label)

        # --- 分隔线 ---
        layout.addWidget(_separator())

        # --- 开关 ---
        self.auto_browser_check = Switch("启动后自动打开浏览器 (http://localhost:3099)")
        layout.addWidget(self.auto_browser_check)

        self.toast_check = Switch("启动前提示确认 ComfyUI 已运行")
        layout.addWidget(self.toast_check)

        self.mirror_check = Switch("使用国内镜像源加速依赖下载 (npm+uv)")
        layout.addWidget(self.mirror_check)

        # --- 分隔线 ---
        layout.addWidget(_separator())

        # --- 数据迁移（可折叠） ---
        self.migrate_header_btn = QPushButton("▶ 数据迁移")
        self.migrate_header_btn.setStyleSheet(_collapsible_header_style())
        self.migrate_header_btn.setCursor(Qt.PointingHandCursor)
        self.migrate_header_btn.clicked.connect(self._on_toggle_migrate)
        layout.addWidget(self.migrate_header_btn)

        # 折叠内容区域
        self.migrate_content = QWidget()
        self.migrate_content.setStyleSheet("background: transparent;")
        self.migrate_content.hide()
        migrate_content_layout = QVBoxLayout(self.migrate_content)
        migrate_content_layout.setContentsMargins(0, 4, 0, 0)
        migrate_content_layout.setSpacing(10)

        migrate_desc = QLabel(
            "如果无法通过版本管理拉取新版本，可以下载最新版本安装包后，"
            "使用此功能将旧版本中的对话记录、角色数据、生成图片、记忆数据、API Key 等迁移到新版本。"
        )
        migrate_desc.setWordWrap(True)
        migrate_desc.setStyleSheet("color: #756B65; font-size: 12px; background: transparent; border: none;")
        migrate_content_layout.addWidget(migrate_desc)

        # 迁移内容说明
        migrate_items_label = QLabel(
            "迁移内容：agent-core/data（数据库/图片/头像）、"
            "vector-service/chroma_data（向量记忆库）、agent-core/.env（API Key 等配置）"
        )
        migrate_items_label.setWordWrap(True)
        migrate_items_label.setStyleSheet(
            "color: #B09890; font-size: 11px; background: transparent; border: none;"
        )
        migrate_content_layout.addWidget(migrate_items_label)

        # 选择旧版本文件夹
        select_row = QHBoxLayout()
        select_row.setSpacing(10)
        self.migrate_select_btn = QPushButton("选择旧版本文件夹")
        self.migrate_select_btn.setStyleSheet(_secondary_btn_style())
        self.migrate_select_btn.clicked.connect(self._on_select_migrate_source)
        select_row.addWidget(self.migrate_select_btn)

        self.migrate_path_label = QLabel("未选择")
        self.migrate_path_label.setStyleSheet(
            "color: #B09890; font-size: 12px; background: transparent; border: none;"
        )
        self.migrate_path_label.setWordWrap(True)
        select_row.addWidget(self.migrate_path_label, 1)
        migrate_content_layout.addLayout(select_row)

        # 迁移按钮
        migrate_btn_row = QHBoxLayout()
        migrate_btn_row.setSpacing(10)
        self.migrate_start_btn = QPushButton("开始迁移")
        self.migrate_start_btn.setStyleSheet(_primary_btn_style())
        self.migrate_start_btn.clicked.connect(self._on_start_migrate)
        self.migrate_start_btn.setEnabled(False)
        migrate_btn_row.addWidget(self.migrate_start_btn)

        self.migrate_status_label = QLabel("")
        self.migrate_status_label.setStyleSheet(
            "color: #756B65; font-size: 12px; background: transparent; border: none;"
        )
        self.migrate_status_label.setWordWrap(True)
        migrate_btn_row.addWidget(self.migrate_status_label, 1)
        migrate_content_layout.addLayout(migrate_btn_row)

        # 进度条（迁移进行中显示）
        self.migrate_progress = QProgressBar()
        self.migrate_progress.setMinimum(0)
        self.migrate_progress.setMaximum(100)
        self.migrate_progress.setValue(0)
        self.migrate_progress.setTextVisible(True)
        self.migrate_progress.setFormat("")
        self.migrate_progress.setFixedHeight(18)
        self.migrate_progress.setStyleSheet(_progress_bar_style())
        self.migrate_progress.hide()
        migrate_content_layout.addWidget(self.migrate_progress)

        layout.addWidget(self.migrate_content)

        # 弹性空间把仓库地址推到底部
        layout.addStretch()

        # --- 外部链接（右下角） ---
        repo_row = QHBoxLayout()
        repo_row.addStretch()
        bili_label = QLabel(
            '<a href="https://space.bilibili.com/632137"'
            ' style="color: #B09890; text-decoration: none; font-size: 11px;">'
            'B站 @琪猫猫来了全秒了</a>'
        )
        bili_label.setOpenExternalLinks(True)
        repo_row.addWidget(bili_label)
        repo_row.addWidget(QLabel(
            '<span style="color: #C9C0BB; font-size: 11px;"> · </span>'
        ))
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

    def set_project_path(self, path: str):
        """设置当前安装根目录（用于数据迁移的目标路径）。"""
        self._target_project_path = path

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
    # 数据迁移
    # ------------------------------------------------------------------

    def _on_toggle_migrate(self):
        """展开/折叠数据迁移面板。"""
        if self.migrate_content.isVisible():
            self.migrate_content.hide()
            self.migrate_header_btn.setText("▶ 数据迁移")
            self.migrate_panel_toggled.emit(False)
        else:
            self.migrate_content.show()
            self.migrate_header_btn.setText("▼ 数据迁移")
            self.migrate_panel_toggled.emit(True)

    def _on_select_migrate_source(self):
        """用户选择旧版本文件夹。"""
        path = QFileDialog.getExistingDirectory(
            self,
            "选择旧版本的邻舍根目录",
            "",
        )
        if not path:
            return

        # 智能检测：用户可能选了旧版本根目录，也可能选了外层目录
        detected = self._detect_source_root(path)
        if detected is None:
            self.migrate_path_label.setText("❌ 未找到有效数据")
            self.migrate_path_label.setStyleSheet(
                "color: #C95F4F; font-size: 12px; background: transparent; border: none;"
            )
            self.migrate_start_btn.setEnabled(False)
            self._migrate_source_path = ""
            return

        self._migrate_source_path = detected
        display = detected
        if len(display) > 60:
            display = "..." + display[-57:]
        self.migrate_path_label.setText(f"✓ {display}")
        self.migrate_path_label.setStyleSheet(
            "color: #4A9B4A; font-size: 12px; background: transparent; border: none;"
        )
        self.migrate_start_btn.setEnabled(True)
        self.migrate_status_label.setText("")
        self.migrate_progress.hide()

    def _detect_source_root(self, selected_path: str) -> str | None:
        """智能检测旧版本根目录。

        用户可能：
        1. 直接选了旧版本根目录（如 D:\\邻舍-v1.0\\）
        2. 选了外层目录，旧版本在里面（如选了 D:\\，里面有邻舍-v1.0\\）

        检测逻辑：
        1. 先检查 selected_path 自身是否包含需要的数据
        2. 否则扫描 selected_path 下的一级子目录，找到第一个匹配的
        """
        if self._is_valid_source(selected_path):
            return selected_path

        try:
            candidates = []
            for name in os.listdir(selected_path):
                sub = os.path.join(selected_path, name)
                if os.path.isdir(sub) and self._is_valid_source(sub):
                    candidates.append(sub)
            if candidates:
                return candidates[0]
        except OSError:
            pass

        return None

    def _is_valid_source(self, path: str) -> bool:
        """检查路径是否包含需要迁移的数据（至少有一项存在即视为有效）。"""
        for item_type, rel_path in MIGRATE_ITEMS:
            full = os.path.join(path, rel_path)
            if item_type == "dir" and os.path.isdir(full):
                return True
            if item_type == "file" and os.path.isfile(full):
                return True
        return False

    def _on_start_migrate(self):
        """启动后台迁移线程。"""
        if not self._migrate_source_path:
            return

        target = self._target_project_path
        if not target:
            self._set_migrate_status("❌ 无法确定当前安装目录", error=True)
            return

        source = self._migrate_source_path

        # 安全检查：源和目标不能相同
        if os.path.normpath(source) == os.path.normpath(target):
            self._set_migrate_status("❌ 源目录和目标目录相同，无需迁移", error=True)
            return

        # 确认对话框
        item_lines = "\n".join(
            f"  • {rel}" for _, rel in MIGRATE_ITEMS
        )
        reply = QMessageBox.question(
            self,
            "确认数据迁移",
            f"即将从以下路径复制数据：\n\n"
            f"源 (旧版本):\n  {source}\n\n"
            f"目标 (当前版本):\n  {target}\n\n"
            f"将复制以下内容：\n"
            f"{item_lines}"
            f"\n\n目标目录中已有的文件将被覆盖。\n\n确定要执行迁移吗？",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No,
        )
        if reply != QMessageBox.Yes:
            return

        # 禁用按钮，显示进度条
        self.migrate_start_btn.setEnabled(False)
        self.migrate_select_btn.setEnabled(False)
        self.migrate_status_label.setText("⏳ 正在统计文件...")
        self.migrate_status_label.setStyleSheet(
            "color: #756B65; font-size: 12px; background: transparent; border: none;"
        )
        self.migrate_progress.setValue(0)
        self.migrate_progress.setFormat("")
        self.migrate_progress.show()

        # 启动后台线程
        self._migrate_worker = MigrateWorker(source, target, MIGRATE_ITEMS)
        self._migrate_worker.progress.connect(self._on_migrate_progress)
        self._migrate_worker.current_item.connect(self._on_migrate_current_item)
        self._migrate_worker.all_done.connect(self._on_migrate_done)
        self._migrate_worker.start()

    # ------------------------------------------------------------------
    # 迁移线程回调（主线程）
    # ------------------------------------------------------------------

    def _on_migrate_progress(self, current: int, total: int):
        """更新进度条。"""
        pct = int(current / total * 100) if total > 0 else 0
        self.migrate_progress.setValue(pct)
        self.migrate_progress.setFormat(f"{current}/{total} 个文件  ({pct}%)")

    def _on_migrate_current_item(self, item_name: str):
        """更新当前正在复制的项目名。"""
        self.migrate_status_label.setText(f"⏳ 正在迁移: {item_name} ...")
        self.migrate_status_label.setStyleSheet(
            "color: #756B65; font-size: 12px; background: transparent; border: none;"
        )

    def _on_migrate_done(self, success_items: list[str], failed_items: list[str]):
        """迁移完成。"""
        self._migrate_worker = None
        self.migrate_select_btn.setEnabled(True)
        self.migrate_start_btn.setEnabled(True)

        if failed_items:
            msg_parts = []
            if success_items:
                msg_parts.append(f"✓ 成功: {', '.join(success_items)}")
            msg_parts.append(f"❌ 失败: {', '.join(failed_items)}")
            self._set_migrate_status("\n".join(msg_parts), error=True)
            self.migrate_progress.setFormat("⚠ 部分失败")
            self.migrate_progress.setStyleSheet(_progress_bar_style(error=True))
        else:
            self._set_migrate_status(
                f"✓ 迁移完成! 已复制 {len(success_items)} 项数据。\n"
                f"旧版本数据已保留，您可以在确认新版本正常后手动删除旧版本。",
                error=False,
            )
            self.migrate_progress.setFormat("✓ 完成")
            self.migrate_progress.setStyleSheet(_progress_bar_style(done=True))

    def _set_migrate_status(self, text: str, error: bool = False):
        self.migrate_status_label.setText(text)
        if error:
            self.migrate_status_label.setStyleSheet(
                "color: #C95F4F; font-size: 12px; background: transparent; border: none;"
            )
        else:
            self.migrate_status_label.setStyleSheet(
                "color: #4A9B4A; font-size: 12px; background: transparent; border: none;"
            )


# ==================================================================
# Style Helpers
# ==================================================================


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


def _collapsible_header_style() -> str:
    return """
        QPushButton {
            background: transparent;
            color: #2E2A27;
            font-size: 14px;
            font-weight: bold;
            border: none;
            text-align: left;
            padding: 6px 0px;
        }
        QPushButton:hover {
            color: #E07B6C;
        }
    """


def _primary_btn_style() -> str:
    return """
        QPushButton {
            background: #E07B6C; color: #FCFAF8; font-size: 12px;
            font-weight: bold; padding: 8px 18px; border-radius: 6px; border: none;
        }
        QPushButton:hover { background: #D96D5D; }
        QPushButton:pressed { background: #C95F4F; }
    """


def _progress_bar_style(error: bool = False, done: bool = False) -> str:
    """进度条样式，支持正常/完成/错误三种状态的颜色。"""
    if error:
        bar_color = "#C95F4F"
        bg_color = "#F5E0DC"
    elif done:
        bar_color = "#4A9B4A"
        bg_color = "#E0F0E0"
    else:
        bar_color = "#E07B6C"
        bg_color = "#F1ECE8"

    return f"""
        QProgressBar {{
            background: {bg_color};
            border: 1px solid #E5D9D2;
            border-radius: 6px;
            text-align: center;
            color: #756B65;
            font-size: 11px;
        }}
        QProgressBar::chunk {{
            background: {bar_color};
            border-radius: 5px;
        }}
    """


def _separator() -> QFrame:
    line = QFrame()
    line.setFrameShape(QFrame.HLine)
    line.setStyleSheet("background: #E5D9D2; max-height: 1px; border: none;")
    return line


def _load_misans_font() -> QFont | None:
    """加载 MiSans 字体并返回 QFont 对象。"""
    import sys

    if getattr(sys, "frozen", False):
        candidates = [os.path.join(sys._MEIPASS, "assets", "MiSans-Regular.ttf")]
    else:
        candidates = [
            os.path.join(os.path.dirname(__file__), "..", "assets", "MiSans-Regular.ttf"),
            os.path.join(os.path.dirname(__file__), "assets", "MiSans-Regular.ttf"),
        ]

    font_path = None
    for p in candidates:
        if os.path.exists(p):
            font_path = p
            break

    if not font_path:
        return None

    font_id = QFontDatabase.addApplicationFont(font_path)
    if font_id < 0:
        return None

    families = QFontDatabase.applicationFontFamilies(font_id)
    if not families:
        return None

    font = QFont(families[0])
    font.setPixelSize(13)
    return font
