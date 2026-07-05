"""
邻舍.EXE 启动器入口。
"""
import sys
import os

# 确保 launcher 包可导入（支持开发模式和 PyInstaller 模式）
if getattr(sys, "frozen", False):
    _base = os.path.dirname(sys.executable)
else:
    _base = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _base)

from PySide6.QtWidgets import QApplication, QProxyStyle, QStyleFactory
from PySide6.QtGui import QIcon, QFontDatabase, QFont
from PySide6.QtCore import QTimer
from launcher.app import MainWindow


# ==================================================================
# 字体代理样式 — 拦截 Qt 样式引擎最底层的 polish() 调用
# ==================================================================

class _FontStyle(QProxyStyle):
    """包装 Fusion 样式，在 polish() 中强制注入目标字体。

    polish() 是 Qt 样式系统对每个 widget 的初始化回调，在 stylesheet
    计算完成后调用。这里直接 setFont() 可以覆盖一切上游来源（包括
    stylesheet 回退到系统默认字体的场景）。

    使用 QProxyStyle 而非事件过滤器，因为它是 Qt 样式管线的一环，
    优先级高于任何 CSS/stylesheet 解析结果。
    """

    def __init__(self, family: str):
        super().__init__(QStyleFactory.create("Fusion"))
        self._family = family
        # 预建字体模板，避免在 polish 热路径中反复构造
        self._font = QFont(family)
        self._font.setPixelSize(13)

    def polish(self, widget):
        """Qt 样式系统回调：每次 widget 被样式化时调用。"""
        super().polish(widget)
        if not hasattr(widget, "font") or not hasattr(widget, "setFont"):
            return
        cur = widget.font()
        if cur.family() == self._family:
            return  # 已正确，跳过
        # 保留原字号（尊重局部放大/缩小），仅替换族名
        size = cur.pixelSize()
        if size <= 0:
            size = 13
        f = QFont(self._family)
        f.setPixelSize(size)
        widget.setFont(f)


# ==================================================================
# 入口
# ==================================================================

def main():
    app = QApplication(sys.argv)
    app.setApplicationName("邻舍")
    app.setApplicationDisplayName("邻舍.EXE")

    # 加载字体 → 构建代理样式 → 设为应用样式
    family = _load_font(app)
    if family:
        app.setStyle(_FontStyle(family))

    # 图标
    icon_path = _find_icon()
    if icon_path:
        app.setWindowIcon(QIcon(icon_path))

    window = MainWindow()
    window.show()

    # 控件树递归注入 + 延迟兜底（覆盖窗口构建期的时序窗口）
    if family:
        _inject_tree(window, family)
        QTimer.singleShot(50, lambda: _inject_tree(window, family))
        QTimer.singleShot(200, lambda: _inject_tree(window, family))

    sys.exit(app.exec())


# ==================================================================
# Helpers
# ==================================================================

def _assets_path(filename: str) -> str | None:
    candidates = [
        os.path.join(sys._MEIPASS, "assets", filename) if getattr(sys, "frozen", False) else None,
        os.path.join(os.path.dirname(__file__), "assets", filename),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def _find_icon() -> str | None:
    return _assets_path("icon.ico")


def _load_font(app: QApplication) -> str | None:
    """加载 MiSans 字体，返回字体族名。"""
    font_path = _assets_path("MiSans-Regular.ttf")
    if not font_path:
        print("[WARN] 未找到 MiSans-Regular.ttf")
        return None

    font_id = QFontDatabase.addApplicationFont(font_path)
    if font_id < 0:
        print(f"[WARN] 字体加载失败: {font_path}")
        return None

    families = QFontDatabase.applicationFontFamilies(font_id)
    if not families:
        print(f"[WARN] 无法获取字体族名: {font_path}")
        return None

    family = families[0]

    # app.setFont() 作为基线默认值
    font = QFont(family)
    font.setPixelSize(13)
    app.setFont(font)

    # 全局 stylesheet 级联层
    app.setStyleSheet(
        f'QWidget {{ font-family: "{family}", "Microsoft YaHei", sans-serif; }}'
    )

    print(f"[OK] 字体就绪: {family} ({os.path.basename(font_path)}, 13px)")
    return family


def _inject_tree(root, family: str):
    """递归遍历控件树，用全新 QFont 强制覆盖每个 widget。

    作为 polish() 的补充：覆盖那些在 polish 之后又被 stylesheet
    异步重置的极端情况。
    """
    def _walk(w):
        if hasattr(w, "font") and hasattr(w, "setFont"):
            cur = w.font()
            if cur.family() != family:
                size = cur.pixelSize()
                if size <= 0:
                    size = 13
                f = QFont(family)
                f.setPixelSize(size)
                w.setFont(f)
        for child in w.children():
            _walk(child)

    _walk(root)


if __name__ == "__main__":
    main()
