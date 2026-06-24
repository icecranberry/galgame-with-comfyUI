"""
版本管理页 —— Git tags 列表 + 版本切换 + 强制构建。
"""
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
)
from PySide6.QtCore import Qt, Signal
from .log_widget import LogWidget


class VersionPage(QWidget):
    """版本管理页面。"""

    # 信号
    check_update_clicked = Signal()
    switch_tag_clicked = Signal(str)  # tag
    force_rebuild_clicked = Signal()
    cancel_build_clicked = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._current_tag: str | None = None
        self._building = False
        self._setup_ui()

    def _setup_ui(self):
        self.setStyleSheet("background: #1a1a1a;")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 44, 16, 0)
        layout.setSpacing(10)

        # --- 版本信息 ---
        info_layout = QHBoxLayout()
        self.version_info_label = QLabel("当前: ---   远程: --")
        self.version_info_label.setStyleSheet("color: #e0e0e0; font-size: 14px;")
        info_layout.addWidget(self.version_info_label)
        info_layout.addStretch()

        self.check_update_btn = QPushButton("检查更新")
        self.check_update_btn.setStyleSheet(_btn_style())
        self.check_update_btn.clicked.connect(self.check_update_clicked.emit)
        info_layout.addWidget(self.check_update_btn)

        layout.addLayout(info_layout)

        # --- 版本列表 ---
        list_label = QLabel("可用版本:")
        list_label.setStyleSheet("color: #999; font-size: 12px;")
        layout.addWidget(list_label)

        self.tag_list = QListWidget()
        self.tag_list.setStyleSheet("""
            QListWidget {
                background: #121212; color: #ccc; border: 1px solid #333;
                border-radius: 4px; font-size: 13px;
            }
            QListWidget::item {
                padding: 8px 12px;
                border-bottom: 1px solid #222;
            }
            QListWidget::item:hover {
                background: #252525;
            }
            QListWidget::item:selected {
                background: #2a3a4a;
            }
        """)
        self.tag_list.itemDoubleClicked.connect(self._on_item_double_clicked)
        layout.addWidget(self.tag_list, stretch=1)

        # --- 操作按钮 ---
        btn_layout = QHBoxLayout()

        self.switch_btn = QPushButton("切换到选中版本")
        self.switch_btn.setStyleSheet(_btn_style())
        self.switch_btn.clicked.connect(self._on_switch_clicked)
        self.switch_btn.setEnabled(False)
        btn_layout.addWidget(self.switch_btn)

        btn_layout.addStretch()

        self.rebuild_btn = QPushButton("强制重新构建" if not self._building else "取消构建")
        self.rebuild_btn.setStyleSheet("""
            QPushButton {
                background: #555; color: #ccc; font-size: 12px;
                padding: 8px 16px; border-radius: 6px; border: none;
            }
            QPushButton:hover { background: #666; }
        """)
        self.rebuild_btn.clicked.connect(self._on_rebuild_clicked)
        btn_layout.addWidget(self.rebuild_btn)

        layout.addLayout(btn_layout)

        # --- 警告 ---
        warn_label = QLabel("⚠ 切换版本后将自动重新构建项目")
        warn_label.setStyleSheet("color: #aa8800; font-size: 12px;")
        layout.addWidget(warn_label)

        # --- 操作日志 ---
        self.log_widget = LogWidget(self, max_lines=2000)
        self.log_widget.setMaximumHeight(120)
        layout.addWidget(self.log_widget)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_current_tag(self, tag: str | None):
        self._current_tag = tag

    def set_tags(self, tags: list[str]):
        self.tag_list.clear()
        current = self._current_tag
        if current and not current.startswith("v"):
            current = "v" + current

        for tag in tags:
            display = tag if tag.startswith("v") else f"v{tag}"
            is_current = (tag == self._current_tag) or (display == current)
            item = QListWidgetItem(f"{display}  [当前]" if is_current else display)
            item.setData(Qt.UserRole, tag)
            if is_current:
                item.setForeground(Qt.green)
                font = item.font()
                font.setBold(True)
                item.setFont(font)
            self.tag_list.addItem(item)

    def set_remote_status(self, has_updates: bool | None):
        if has_updates is True:
            self.version_info_label.setText(
                f"当前: {self._current_tag or '--'}   远程: ○ 有新版本"
            )
        elif has_updates is False:
            self.version_info_label.setText(
                f"当前: {self._current_tag or '--'}   远程: ● 已是最新"
            )
        else:
            self.version_info_label.setText(
                f"当前: {self._current_tag or '--'}   远程: -- (离线)"
            )

    def set_building(self, building: bool):
        self._building = building
        self.rebuild_btn.setText("取消构建" if building else "强制重新构建")
        self.switch_btn.setEnabled(not building and self.tag_list.currentItem() is not None)

    def append_log(self, text: str):
        self.log_widget.append_line(text)

    # ------------------------------------------------------------------
    # Slots
    # ------------------------------------------------------------------

    def _on_item_double_clicked(self, item):
        tag = item.data(Qt.UserRole)
        if tag == self._current_tag:
            return
        reply = QMessageBox.question(
            self,
            "切换版本",
            f"确定切换到 {tag}？\n\n切换后将自动重新构建项目，请确保没有未提交的更改。",
            QMessageBox.Yes | QMessageBox.No,
        )
        if reply == QMessageBox.Yes:
            self.switch_tag_clicked.emit(tag)

    def _on_switch_clicked(self):
        item = self.tag_list.currentItem()
        if item:
            self._on_item_double_clicked(item)

    def _on_rebuild_clicked(self):
        if self._building:
            self.cancel_build_clicked.emit()
        else:
            self.force_rebuild_clicked.emit()

    def on_tag_selection_changed(self):
        """list 选中变更时启用切换按钮。"""
        item = self.tag_list.currentItem()
        if item:
            tag = item.data(Qt.UserRole)
            self.switch_btn.setEnabled(not self._building and tag != self._current_tag)


# ------------------------------------------------------------------
# Style
# ------------------------------------------------------------------


def _btn_style() -> str:
    return """
        QPushButton {
            background: #333; color: #ccc; font-size: 12px;
            padding: 8px 16px; border-radius: 6px; border: none;
        }
        QPushButton:hover { background: #444; }
        QPushButton:disabled { background: #222; color: #555; }
    """
