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
from PySide6.QtGui import QIcon
from launcher.app import MainWindow


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("邻舍.EXE")
    app.setApplicationDisplayName("邻舍启动器")

    # 高 DPI
    app.setStyle("Fusion")

    # 图标
    icon_path = _find_icon()
    if icon_path:
        app.setWindowIcon(QIcon(icon_path))

    window = MainWindow()
    window.show()

    sys.exit(app.exec())


def _find_icon() -> str | None:
    """查找 icon.ico。"""
    candidates = [
        # PyInstaller
        os.path.join(sys._MEIPASS, "assets", "icon.ico") if getattr(sys, "frozen", False) else None,
        # 开发模式
        os.path.join(os.path.dirname(__file__), "assets", "icon.ico"),
        os.path.join(os.path.dirname(__file__), "launcher", "assets", "icon.ico"),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


if __name__ == "__main__":
    main()
