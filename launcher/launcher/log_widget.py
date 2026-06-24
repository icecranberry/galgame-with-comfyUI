"""
彩色实时日志组件 —— QPlainTextEdit 子类，支持自动着色和行数上限。
"""
from PySide6.QtWidgets import QPlainTextEdit, QMenu
from PySide6.QtGui import QTextCursor, QColor, QFont, QAction
from PySide6.QtCore import Qt, Signal


class LogWidget(QPlainTextEdit):
    """只读日志区域。自动着色、自动滚动、行数上限。"""

    append_requested = Signal(str, str)  # (text, color_name)

    # 关键词着色规则：匹配到任意关键词 → 使用对应颜色
    COLOR_RULES = [
        (["error", "fail", "✗", "exception", "traceback"], "red"),
        (["warn", "[!]", "warning"], "yellow"),
        (["✓", "ok", "done", "ready", "healthy", "success", "🎉"], "green"),
        (["[向量服务]"], "cyan"),
        (["[主控后端]"], "lime"),
        (["[构建]"], "dodgerblue"),
    ]

    COLORS = {
        "red": QColor("#D9434A"),
        "yellow": QColor("#C88700"),
        "green": QColor("#4A9B4A"),
        "cyan": QColor("#008B8B"),
        "lime": QColor("#6BAA00"),
        "dodgerblue": QColor("#4A80CC"),
        "white": QColor("#2E2A27"),
        "grey": QColor("#756B65"),
    }

    def __init__(self, parent=None, max_lines: int = 5000):
        super().__init__(parent)
        self._max_lines = max_lines
        self._auto_scroll = True

        self.setReadOnly(True)
        self.setMaximumBlockCount(max_lines)
        font = QFont("Consolas", 10)
        font.setStyleHint(QFont.Monospace)
        self.setFont(font)
        self.setStyleSheet("""
            QPlainTextEdit {
                background: #FCFAF8;
                color: #2E2A27;
                border: 1px solid #E5D9D2;
                border-radius: 6px;
                padding: 8px;
                selection-background: #F7D7D1;
                selection-color: #2E2A27;
            }
        """)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOn)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def append_line(self, text: str, color: str | None = None):
        """追加一行。color 为 None 时自动检测关键词着色。

        智能滚动：仅当插入前用户在底部时才滚到新的底部，
        如果在上面看历史消息则不打扰。
        """
        color_name = color or self._detect_color(text)
        qcolor = self.COLORS.get(color_name, self.COLORS["white"])

        # 插入前记录滚动位置
        sb = self.verticalScrollBar()
        saved_value = sb.value()
        saved_max = sb.maximum()

        cursor = self.textCursor()
        cursor.movePosition(QTextCursor.End)

        fmt = cursor.charFormat()
        fmt.setForeground(qcolor)
        cursor.setCharFormat(fmt)
        cursor.insertText(text.strip() + "\n")

        # 插入前就在底部 → 自动滚到新的底部；否则不打扰
        if self._auto_scroll and saved_value >= saved_max - 4:
            sb.setValue(sb.maximum())

    def clear_log(self):
        self.clear()

    def set_auto_scroll(self, enabled: bool):
        self._auto_scroll = enabled

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _detect_color(self, text: str) -> str:
        lower = text.lower()
        for keywords, color_name in self.COLOR_RULES:
            if any(kw.lower() in lower for kw in keywords):
                return color_name
        return "white"

    # ------------------------------------------------------------------
    # Context menu
    # ------------------------------------------------------------------

    def contextMenuEvent(self, event):
        menu = QMenu(self)
        copy_action = QAction("复制全部", self)
        copy_action.triggered.connect(lambda: self._copy_all())
        menu.addAction(copy_action)
        clear_action = QAction("清空", self)
        clear_action.triggered.connect(self.clear_log)
        menu.addAction(clear_action)
        menu.exec(event.globalPos())

    def _copy_all(self):
        from PySide6.QtWidgets import QApplication

        QApplication.clipboard().setText(self.toPlainText())
