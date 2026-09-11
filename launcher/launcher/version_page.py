"""
版本管理页 —— Git tags 列表 + 版本切换 + 强制构建。
"""
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QScroller,
)
from PySide6.QtCore import Qt, Signal, QPropertyAnimation, QEasingCurve
from .log_widget import LogWidget

# 补丁条目挂在 QListWidgetItem 上的附加数据：补丁本体 / 是否适用于当前版本
_ROLE_PATCH = Qt.ItemDataRole.UserRole
_ROLE_APPLICABLE = int(Qt.ItemDataRole.UserRole) + 1


class SmoothListWidget(QListWidget):
    """带平滑滚动动画的 QListWidget。"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._anim: QPropertyAnimation | None = None

    def wheelEvent(self, event):
        """滚轮事件：使用动画平滑滚动。"""
        scrollbar = self.verticalScrollBar()
        # 每次滚轮步进像素数，currentTick 可获取高精度触控板增量
        delta = event.angleDelta().y()
        if event.pixelDelta().y() != 0:
            delta = event.pixelDelta().y()
        target = scrollbar.value() - delta
        target = max(scrollbar.minimum(), min(scrollbar.maximum(), target))
        self._animate_to(target)
        event.accept()

    def scroll_to_item(self, index: int):
        """平滑滚动到指定索引的项（目标项显示在可视区偏上位置）。"""
        item = self.item(index)
        if item is None:
            return
        target = self.visualItemRect(item).top() + self.verticalScrollBar().value()
        target -= self.viewport().height() // 3
        target = max(
            self.verticalScrollBar().minimum(),
            min(self.verticalScrollBar().maximum(), target),
        )
        self._animate_to(target)

    def _animate_to(self, target: int):
        """QPropertyAnimation 驱动滚动条到目标位置。"""
        scrollbar = self.verticalScrollBar()
        if target == scrollbar.value():
            return

        if self._anim and self._anim.state() == QPropertyAnimation.Running:
            self._anim.stop()

        self._anim = QPropertyAnimation(scrollbar, b"value", self)
        self._anim.setDuration(200)
        self._anim.setStartValue(scrollbar.value())
        self._anim.setEndValue(target)
        self._anim.setEasingCurve(QEasingCurve.OutCubic)
        self._anim.start()


class VersionPage(QWidget):
    """版本管理页面。"""
    # 信号
    check_update_clicked = Signal()
    switch_tag_clicked = Signal(str)  # tag
    force_rebuild_clicked = Signal()
    cancel_build_clicked = Signal()
    # --- 增量补丁 ---
    patch_source_saved = Signal(str)      # 补丁源地址
    patch_check_clicked = Signal()
    patch_apply_clicked = Signal(object)  # patch dict
    patch_rollback_clicked = Signal(str)  # patch id
    patch_import_clicked = Signal()       # 导入本地补丁包

    def __init__(self, parent=None):
        super().__init__(parent)
        self._current_tag: str | None = None
        self._building = False
        self._applied_patch_id = ""
        self._setup_ui()

    def _setup_ui(self):
        self.setStyleSheet("background: #F7F3F0;")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 44, 16, 12)
        layout.setSpacing(10)

        # --- 版本信息 ---
        info_layout = QHBoxLayout()
        self.version_info_label = QLabel("当前: ---   远程: --")
        self.version_info_label.setStyleSheet("color: #2E2A27; font-size: 14px;")
        info_layout.addWidget(self.version_info_label)
        info_layout.addStretch()

        self.check_update_btn = QPushButton("检查更新")
        self.check_update_btn.setStyleSheet(_btn_style())
        self.check_update_btn.clicked.connect(self.check_update_clicked.emit)
        info_layout.addWidget(self.check_update_btn)

        layout.addLayout(info_layout)

        # --- 版本列表 ---
        list_label = QLabel("可用版本:")
        list_label.setStyleSheet("color: #756B65; font-size: 12px;")
        layout.addWidget(list_label)

        self.tag_list = SmoothListWidget()
        self.tag_list.setVerticalScrollMode(QListWidget.ScrollPerPixel)
        self.tag_list.setStyleSheet("""
            QListWidget {
                background: #FCFAF8; color: #2E2A27; border: 1px solid #E5D9D2;
                border-radius: 6px; font-size: 13px;
            }
            QListWidget::item {
                border-bottom: 1px solid #F1ECE8;
            }
            QListWidget::item:hover {
                background: #F1ECE8;
            }
            QListWidget::item:selected {
                background: #F7D7D1;
            }
        """)
        # 平滑滚动：像素级滚动 + 触控惯性
        QScroller.grabGesture(
            self.tag_list.viewport(),
            QScroller.LeftMouseButtonGesture,
        )
        self.tag_list.itemDoubleClicked.connect(self._on_item_double_clicked)
        self.tag_list.currentItemChanged.connect(
            lambda: self.on_tag_selection_changed()
        )
        layout.addWidget(self.tag_list, stretch=1)
        layout.addSpacing(20)

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
                background: #E5D9D2; color: #756B65; font-size: 12px;
                padding: 8px 16px; border-radius: 6px; border: none;
            }
            QPushButton:hover { background: #DDD0C8; color: #2E2A27; }
        """)
        self.rebuild_btn.clicked.connect(self._on_rebuild_clicked)
        btn_layout.addWidget(self.rebuild_btn)

        layout.addLayout(btn_layout)

        # --- 警告 ---
        warn_label = QLabel("⚠ 切换版本后将自动重新构建项目")
        warn_label.setStyleSheet("color: #C88700; font-size: 12px;")
        layout.addWidget(warn_label)

        # --- 增量补丁 ---
        # 与「切换版本」互补：切版本要拉整包 + 全量构建，补丁只下发变更文件，
        # 现场网络差时不用反复从 GitHub 下整包。
        patch_header = QHBoxLayout()
        patch_title = QLabel("增量补丁")
        patch_title.setStyleSheet("color: #2E2A27; font-size: 12px; font-weight: 600;")
        patch_header.addWidget(patch_title)

        self.patch_status_label = QLabel("未检查")
        self.patch_status_label.setStyleSheet("color: #756B65; font-size: 11px;")
        patch_header.addWidget(self.patch_status_label)
        patch_header.addStretch()
        layout.addLayout(patch_header)

        source_row = QHBoxLayout()
        source_label = QLabel("补丁源")
        source_label.setStyleSheet("color: #756B65; font-size: 11px;")
        source_row.addWidget(source_label)

        self.patch_source_edit = QLineEdit()
        self.patch_source_edit.setPlaceholderText(
            "静态目录：http(s) 网址，或本机/共享目录（如 D:\\patches、\\\\nas\\patches）"
        )
        self.patch_source_edit.setStyleSheet(_input_style())
        source_row.addWidget(self.patch_source_edit, stretch=1)

        self.patch_save_btn = QPushButton("保存源")
        self.patch_save_btn.setStyleSheet(_small_btn_style())
        self.patch_save_btn.clicked.connect(
            lambda: self.patch_source_saved.emit(self.patch_source_edit.text().strip())
        )
        source_row.addWidget(self.patch_save_btn)
        layout.addLayout(source_row)

        self.patch_list = QListWidget()
        self.patch_list.setMaximumHeight(76)
        self.patch_list.setStyleSheet("""
            QListWidget {
                background: #FCFAF8; color: #2E2A27; border: 1px solid #E5D9D2;
                border-radius: 6px; font-size: 12px;
            }
            QListWidget::item { border-bottom: 1px solid #F1ECE8; padding: 3px 6px; }
            QListWidget::item:hover { background: #F1ECE8; }
            QListWidget::item:selected { background: #F7D7D1; }
        """)
        self.patch_list.itemDoubleClicked.connect(lambda _item: self._on_patch_apply())
        self.patch_list.currentItemChanged.connect(lambda *_: self._refresh_patch_buttons())
        layout.addWidget(self.patch_list)

        patch_btns = QHBoxLayout()

        self.patch_check_btn = QPushButton("检查补丁")
        self.patch_check_btn.setStyleSheet(_small_btn_style())
        self.patch_check_btn.clicked.connect(self.patch_check_clicked.emit)
        patch_btns.addWidget(self.patch_check_btn)

        self.patch_apply_btn = QPushButton("应用选中补丁")
        self.patch_apply_btn.setStyleSheet(_small_btn_style())
        self.patch_apply_btn.setEnabled(False)
        self.patch_apply_btn.clicked.connect(self._on_patch_apply)
        patch_btns.addWidget(self.patch_apply_btn)

        self.patch_rollback_btn = QPushButton("回滚已应用")
        self.patch_rollback_btn.setStyleSheet(_small_btn_style())
        self.patch_rollback_btn.setEnabled(False)
        self.patch_rollback_btn.clicked.connect(self._on_patch_rollback)
        patch_btns.addWidget(self.patch_rollback_btn)

        # 离线通道：拿到一个 .tar.gz 就能应用，完全不依赖任何托管
        self.patch_import_btn = QPushButton("导入补丁包…")
        self.patch_import_btn.setStyleSheet(_small_btn_style())
        self.patch_import_btn.clicked.connect(self.patch_import_clicked.emit)
        patch_btns.addWidget(self.patch_import_btn)

        patch_btns.addStretch()
        layout.addLayout(patch_btns)

        # --- 操作日志 ---
        self.log_widget = LogWidget(self, max_lines=2000)
        self.log_widget.setMaximumHeight(120)
        layout.addWidget(self.log_widget)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_current_tag(self, tag: str | None):
        self._current_tag = tag
        self._refresh_info_label()

    def _refresh_info_label(self):
        """根据当前 _current_tag 刷新顶部版本信息标签。"""
        tag = self._current_tag
        self.version_info_label.setText(f"当前: {tag or '--'}   远程: --")

    def set_tags(self, tags: list[dict]):
        self.tag_list.clear()
        current = self._current_tag
        if current and not current.startswith("v"):
            current = "v" + current

        for tag in tags:
            name = tag["name"]
            message = tag.get("message", "")
            date = tag.get("date", "")
            display = name if name.startswith("v") else f"v{name}"
            is_current = (name == self._current_tag) or (display == current)

            # 自定义 item widget：tag 名 + 注释 + 日期
            widget = _TagItemWidget(display, message, date, is_current)
            item = QListWidgetItem()
            item.setData(Qt.UserRole, name)
            item.setSizeHint(widget.sizeHint())
            self.tag_list.addItem(item)
            self.tag_list.setItemWidget(item, widget)

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

    def set_checking(self, checking: bool):
        self.check_update_btn.setEnabled(not checking)
        self.check_update_btn.setText("检查中..." if checking else "检查更新")

    def append_log(self, text: str):
        self.log_widget.append_line(text)

    # ------------------------------------------------------------------
    # 增量补丁
    # ------------------------------------------------------------------

    def set_patch_source(self, url: str):
        self.patch_source_edit.setText(url or "")

    def patch_source(self) -> str:
        return self.patch_source_edit.text().strip()

    def set_patch_status(self, text: str, *, ok: bool | None = None):
        self.patch_status_label.setText(text)
        color = "#4A9B4A" if ok else ("#D9434A" if ok is False else "#756B65")
        self.patch_status_label.setStyleSheet(f"color: {color}; font-size: 11px;")

    def set_patches(self, patches: list, current_version: str = ""):
        """填充补丁列表。``●`` = 适用于当前版本，``○`` = 需要先切到对应版本。"""
        self.patch_list.clear()
        current = (current_version or "").lstrip("v")
        for patch in patches or []:
            targets = [str(v) for v in (patch.get("from") or [])]
            applicable = bool(current) and any(v.lstrip("v") == current for v in targets)
            size_kb = (patch.get("size") or 0) / 1024
            label = "可应用" if applicable else f"需先切到 {'/'.join(targets) or '?'}"
            notes = f"　{patch['notes']}" if patch.get("notes") else ""
            item = QListWidgetItem(
                f"{'●' if applicable else '○'} {patch.get('to')}　{size_kb:.0f} KB　{label}{notes}"
            )
            item.setData(_ROLE_PATCH, patch)
            item.setData(_ROLE_APPLICABLE, applicable)
            self.patch_list.addItem(item)
        if self.patch_list.count():
            self.patch_list.setCurrentRow(0)
        self._refresh_patch_buttons()

    def set_patch_busy(self, busy: bool):
        self.patch_check_btn.setEnabled(not busy)
        self.patch_save_btn.setEnabled(not busy)
        self.patch_import_btn.setEnabled(not busy)
        self._refresh_patch_buttons()

    def set_patch_progress(self, received: int, total: int):
        if total > 0:
            self.set_patch_status(
                f"下载中 {received * 100 // total}%（{received // 1024}/{total // 1024} KB）"
            )
        else:
            self.set_patch_status(f"下载中 {received // 1024} KB")

    def set_applied_patch(self, patch_id: str | None):
        """记录最近应用的补丁，决定「回滚」按钮是否可用。"""
        self._applied_patch_id = patch_id or ""
        self.patch_rollback_btn.setEnabled(bool(self._applied_patch_id))

    def _selected_patch(self) -> dict | None:
        item = self.patch_list.currentItem()
        return item.data(_ROLE_PATCH) if item else None

    def _refresh_patch_buttons(self):
        """只有"选中 + 适用于当前版本 + 空闲"才允许点应用，避免误点导致失败。"""
        item = self.patch_list.currentItem()
        applicable = bool(item.data(_ROLE_APPLICABLE)) if item else False
        self.patch_apply_btn.setEnabled(
            item is not None and applicable and self.patch_check_btn.isEnabled()
        )

    def _on_patch_apply(self):
        patch = self._selected_patch()
        if not patch:
            self.patch_apply_btn.setEnabled(False)
            return
        reply = QMessageBox.question(
            self,
            "应用补丁",
            f"应用补丁 {patch.get('to')}？\n\n"
            f"{patch.get('notes') or '（无说明）'}\n\n"
            "变更文件会被覆盖，原文件先备份到 .patch-backup，随时可回滚；"
            "应用后需要强制重新构建才会生效。",
            QMessageBox.Yes | QMessageBox.No,
        )
        if reply == QMessageBox.Yes:
            self.patch_apply_clicked.emit(patch)

    def _on_patch_rollback(self):
        if not self._applied_patch_id:
            return
        reply = QMessageBox.question(
            self,
            "回滚补丁",
            f"回滚补丁 {self._applied_patch_id}？\n\n会还原被覆盖的文件，之后同样需要重新构建。",
            QMessageBox.Yes | QMessageBox.No,
        )
        if reply == QMessageBox.Yes:
            self.patch_rollback_clicked.emit(self._applied_patch_id)

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
            f"确定切换到 {tag}？\n\n切换后将自动重新构建项目，请耐心等待。",
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
# Tag 列表项控件
# ------------------------------------------------------------------


class _TagItemWidget(QWidget):
    """单个 tag 项：左侧名称 + 注释，右侧日期。"""

    def __init__(self, tag_name: str, message: str, date: str, is_current: bool, parent=None):
        super().__init__(parent)

        # 主布局：水平，左右分布
        root = QHBoxLayout(self)
        root.setContentsMargins(20, 6, 16, 6)
        root.setSpacing(12)

        # ── 左侧：名称 + 注释 ──
        left = QVBoxLayout()
        left.setSpacing(2)

        name_color = "#E07B6C" if is_current else "#2E2A27"
        name_weight = "bold" if is_current else "normal"
        self._name_label = QLabel(tag_name)
        self._name_label.setStyleSheet(
            f"color: {name_color}; font-size: 13px; font-weight: {name_weight};"
            "background: transparent; border: none;"
        )
        left.addWidget(self._name_label)

        if message:
            msg_label = QLabel(message)
            msg_label.setStyleSheet(
                "color: #756B65; font-size: 11px; background: transparent; border: none;"
            )
            msg_label.setWordWrap(True)
            left.addWidget(msg_label)

        root.addLayout(left, 1)

        # ── 右侧：日期 ──
        if date:
            date_label = QLabel(date)
            date_label.setStyleSheet(
                "color: #B09890; font-size: 11px; background: transparent; border: none;"
            )
            date_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
            root.addWidget(date_label)


# ------------------------------------------------------------------
# Style
# ------------------------------------------------------------------


def _btn_style() -> str:
    return """
        QPushButton {
            background: #E5D9D2; color: #756B65; font-size: 12px;
            padding: 8px 16px; border-radius: 6px; border: none;
        }
        QPushButton:hover { background: #DDD0C8; color: #2E2A27; }
        QPushButton:disabled { background: #F1ECE8; color: #C9C0BB; }
    """


def _small_btn_style() -> str:
    return """
        QPushButton {
            background: #E5D9D2; color: #756B65; font-size: 11px;
            padding: 4px 10px; border-radius: 5px; border: none;
        }
        QPushButton:hover { background: #DDD0C8; color: #2E2A27; }
        QPushButton:disabled { background: #F1ECE8; color: #C9C0BB; }
    """


def _input_style() -> str:
    return """
        QLineEdit {
            background: #FCFAF8; color: #2E2A27;
            border: 1px solid #E5D9D2; border-radius: 5px;
            padding: 4px 8px; font-size: 11px;
        }
        QLineEdit:focus { border-color: #E07B6C; }
    """
