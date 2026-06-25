"""
邻舍.EXE 启动器入口。
"""
import sys
import os

# 确保 launcher 包可导入（支持开发模式和 PyInstaller 模式）
if getattr(sys, "frozen", False):
    # PyInstaller 打包后
    _base = os.path.dirname(sys.executable)
else:
    _base = os.path.dirname(os.path.abspath(__file__))

# 将 _base 加入 path，以便 Python 找到其下的 launcher 包
# 目录结构: _base/launcher/__init__.py, _base/launcher/app.py, ...
sys.path.insert(0, _base)

from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QIcon, QFontDatabase, QFont
from launcher.app import MainWindow


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("邻舍")
    app.setApplicationDisplayName("邻舍.EXE")

    # 加载 HarmonyOS Sans SC 字体
    _load_fonts()

    # 高 DPI
    app.setStyle("Fusion")

    # 图标
    icon_path = _find_icon()
    if icon_path:
        app.setWindowIcon(QIcon(icon_path))

    window = MainWindow()
    window.show()

    sys.exit(app.exec())


def _assets_path(filename: str) -> str | None:
    """查找 assets 目录下的文件。"""
    candidates = [
        # PyInstaller
        os.path.join(sys._MEIPASS, "assets", filename) if getattr(sys, "frozen", False) else None,
        # 开发模式
        os.path.join(os.path.dirname(__file__), "assets", filename),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def _find_icon() -> str | None:
    """查找 icon.ico。"""
    return _assets_path("icon.ico")


def _load_fonts():
    """加载 HarmonyOS Sans SC Regular 字体并设为全局默认。"""
    font_path = _assets_path("HarmonyOS_Sans_SC_Regular.ttf")
    if font_path:
        font_id = QFontDatabase.addApplicationFont(font_path)
        if font_id >= 0:
            families = QFontDatabase.applicationFontFamilies(font_id)
            # 设为默认字体
            if families:
                app = QApplication.instance()
                if app:
                    font = QFont(families[0])
                    font.setPixelSize(13)
                    app.setFont(font)


if __name__ == "__main__":
    main()
