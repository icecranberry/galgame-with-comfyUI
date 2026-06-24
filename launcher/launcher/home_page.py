"""
首页 —— 全屏背景图 + 标题阴影 + 启动邻舍/ComfyUI 并排按钮 + 快捷入口卡片 + 版本号。
"""
import os
from PySide6.QtWidgets import (
    QWidget,
    QLabel,
    QPushButton,
    QGraphicsDropShadowEffect,
    QHBoxLayout,
    QVBoxLayout,
)
from PySide6.QtGui import QPixmap, QColor, QPainter, QPen, QBrush, QPainterPath
from PySide6.QtCore import Qt, Signal, QRectF


class ShortcutCard(QWidget):
    """快捷入口卡片：paintEvent 绘制毛玻璃背景 + 蓝色左 accent，点击打开目录。"""

    clicked = Signal()

    def __init__(self, title: str, description: str, parent=None):
        super().__init__(parent)
        self.setCursor(Qt.PointingHandCursor)
        self.setFixedSize(175, 56)
        self._hovered = False

        # box-shadow 投影
        card_shadow = QGraphicsDropShadowEffect(self)
        card_shadow.setBlurRadius(16)
        card_shadow.setOffset(0, 4)
        card_shadow.setColor(QColor(0, 0, 0, 100))
        self.setGraphicsEffect(card_shadow)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(18, 8, 10, 8)
        layout.setSpacing(10)

        # 文件夹图标
        icon_label = QLabel("📁", self)
        icon_label.setStyleSheet("font-size: 18px; background: transparent;")
        icon_label.setFixedWidth(26)
        icon_label.setAlignment(Qt.AlignCenter)

        # 标题 + 说明
        text_layout = QVBoxLayout()
        text_layout.setSpacing(1)

        title_label = QLabel(title, self)
        title_label.setStyleSheet(
            "color: #1b3a5c; font-size: 12px; font-weight: bold; background: transparent;"
        )
        desc_label = QLabel(description, self)
        desc_label.setStyleSheet(
            "color: #2e5a85; font-size: 10px; background: transparent;"
        )

        text_layout.addWidget(title_label)
        text_layout.addWidget(desc_label)

        layout.addWidget(icon_label)
        layout.addLayout(text_layout, 1)

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        w, h = self.width(), self.height()
        r = 8

        # 毛玻璃背景
        bg_alpha = 122 if self._hovered else 102  # ~48% / ~40% white
        painter.setBrush(QBrush(QColor(255, 255, 255, bg_alpha)))

        # 边框
        border_alpha = 56 if self._hovered else 38  # ~22% / ~15% white
        painter.setPen(QPen(QColor(255, 255, 255, border_alpha), 1))

        painter.drawRoundedRect(QRectF(0.5, 0.5, w - 1, h - 1), r, r)

        # 蓝色左边 accent (4px)
        accent_path = QPainterPath()
        accent_path.addRoundedRect(QRectF(0.5, 4, 4, h - 8), 2, 2)
        # clip 到只在卡片左边缘矩形内
        clip_path = QPainterPath()
        clip_path.addRect(QRectF(0, 0, 5, h))
        accent_path = accent_path.intersected(clip_path)
        painter.setPen(Qt.NoPen)
        painter.setBrush(QBrush(QColor(86, 152, 214)))  # #5698D6
        painter.drawPath(accent_path)

        painter.end()

    def enterEvent(self, event):
        self._hovered = True
        self.update()
        super().enterEvent(event)

    def leaveEvent(self, event):
        self._hovered = False
        self.update()
        super().leaveEvent(event)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.clicked.emit()
        super().mousePressEvent(event)


class HomePage(QWidget):
    """首页：背景图 + 标题/副标题 + 快捷入口 + 版本信息 + 启动按钮。"""

    launch_clicked = Signal()
    open_comfyui_clicked = Signal()
    open_directory = Signal(str)  # 请求打开指定目录

    def __init__(self, assets_dir: str, project_dir: str, parent=None):
        super().__init__(parent)
        self._assets_dir = assets_dir
        self._project_dir = project_dir
        self._setup_ui()

    def _setup_ui(self):
        self.setStyleSheet("background: transparent;")

        # --- 背景图 ---
        bg_path = os.path.join(self._assets_dir, "launchHeader.png")
        self._bg_pixmap = QPixmap(bg_path)
        self._bg_label = QLabel(self)
        self._bg_label.setScaledContents(False)
        self._bg_label.setAttribute(Qt.WA_TransparentForMouseEvents)
        self._bg_label.lower()

        # --- 标题 (左上) ---
        self.title_label = QLabel("邻舍.EXE", self)
        self.title_label.setStyleSheet(
            "color: white; font-size: 28px; font-weight: bold; background: transparent;"
        )
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(20)
        shadow.setOffset(2, 2)
        shadow.setColor(QColor(0, 0, 0, 180))
        self.title_label.setGraphicsEffect(shadow)

        # --- 副标题 (标题下方 20px) ---
        self.subtitle_label = QLabel("把想象拖进现实。", self)
        self.subtitle_label.setStyleSheet(
            "color: rgba(255,255,255,0.75); font-size: 16px; background: transparent;"
        )
        sub_shadow = QGraphicsDropShadowEffect(self)
        sub_shadow.setBlurRadius(8)
        sub_shadow.setOffset(1, 1)
        sub_shadow.setColor(QColor(0, 0, 0, 140))
        self.subtitle_label.setGraphicsEffect(sub_shadow)

        # --- 快捷入口卡片 + 阴影 (左下区域) ---
        images_path = os.path.join(self._project_dir, "agent-core", "data", "images")
        workflow_path = os.path.join(self._project_dir, "workflow")

        # 卡片（投影由 QGraphicsDropShadowEffect 实现）
        self._card_images = ShortcutCard("生成图片", "agent-core/data/images", self)
        self._card_images.clicked.connect(lambda: self.open_directory.emit(images_path))

        self._card_workflow = ShortcutCard("工作流", "workflow", self)
        self._card_workflow.clicked.connect(lambda: self.open_directory.emit(workflow_path))

        # --- 版本号 (左下) ---
        self.version_label = QLabel("", self)
        self.version_label.setStyleSheet(
            "color: rgba(255,255,255,0.7); font-size: 13px; background: transparent;"
        )

        # --- 按钮容器 (右下，并排) ---
        btn_container = QWidget(self)
        btn_layout = QHBoxLayout(btn_container)
        btn_layout.setContentsMargins(0, 0, 0, 0)
        btn_layout.setSpacing(20)

        # ComfyUI 按钮（紫色）
        self.comfyui_btn = QPushButton("▸ 启动 ComfyUI")
        self.comfyui_btn.setFixedHeight(44)
        self.comfyui_btn.setStyleSheet("""
            QPushButton {
                background: #4A90D9;
                color: white;
                font-size: 13px;
                font-weight: bold;
                padding: 0 22px;
                border-radius: 10px;
                border: none;
            }
            QPushButton:hover { background: #5BA0E9; }
            QPushButton:pressed { background: #3A80C9; }
        """)
        self.comfyui_btn.setCursor(Qt.PointingHandCursor)
        self.comfyui_btn.clicked.connect(self.open_comfyui_clicked.emit)

        # 启动邻舍按钮（绿色）
        self.launch_btn = QPushButton("▶  启动邻舍")
        self.launch_btn.setFixedHeight(44)
        self.launch_btn.setStyleSheet("""
            QPushButton {
                background: #4CAF50;
                color: white;
                font-size: 16px;
                font-weight: bold;
                padding: 0 28px;
                border-radius: 10px;
                border: none;
            }
            QPushButton:hover { background: #45a049; }
            QPushButton:pressed { background: #3d8b40; }
        """)
        self.launch_btn.setCursor(Qt.PointingHandCursor)
        self.launch_btn.clicked.connect(self.launch_clicked.emit)

        btn_layout.addWidget(self.comfyui_btn)
        btn_layout.addWidget(self.launch_btn)
        self._btn_container = btn_container

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def set_launch_state(self, running: bool):
        """根据服务运行状态更新启动按钮的外观和文字。"""
        if running:
            self.launch_btn.setText("●  运行中")
            self.launch_btn.setStyleSheet("""
                QPushButton {
                    background: #2E7D32;
                    color: #a5d6a7;
                    font-size: 16px;
                    font-weight: bold;
                    padding: 0 28px;
                    border-radius: 10px;
                    border: 2px solid #4CAF50;
                }
                QPushButton:hover { background: #3d8b40; }
                QPushButton:pressed { background: #2E7D32; }
            """)
        else:
            self.launch_btn.setText("▶  启动邻舍")
            self.launch_btn.setStyleSheet("""
                QPushButton {
                    background: #4CAF50;
                    color: white;
                    font-size: 16px;
                    font-weight: bold;
                    padding: 0 28px;
                    border-radius: 10px;
                    border: none;
                }
                QPushButton:hover { background: #45a049; }
                QPushButton:pressed { background: #3d8b40; }
            """)

    def update_version_info(self, tag: str | None, branch: str, has_updates: bool | None):
        if tag:
            text = f"v{tag}" if not tag.startswith("v") else tag
        else:
            text = branch if branch else ""
        self.version_label.setText(text)

    # ------------------------------------------------------------------
    # Layout
    # ------------------------------------------------------------------

    def resizeEvent(self, event):
        super().resizeEvent(event)
        w, h = self.width(), self.height()

        # 背景图 cover（+2px 出血防边缘缝隙）
        bleed = 2
        if self._bg_pixmap and not self._bg_pixmap.isNull():
            pw, ph = self._bg_pixmap.width(), self._bg_pixmap.height()
            if pw > 0 and ph > 0:
                scale = max((w + bleed * 2) / pw, (h + bleed * 2) / ph)
                new_w, new_h = int(pw * scale), int(ph * scale)
                scaled = self._bg_pixmap.scaled(
                    new_w, new_h, Qt.KeepAspectRatio, Qt.SmoothTransformation
                )
                x, y = (new_w - (w + bleed * 2)) // 2, (new_h - (h + bleed * 2)) // 2
                cropped = scaled.copy(x, y, w + bleed * 2, h + bleed * 2)
                self._bg_label.setPixmap(cropped)
        self._bg_label.setGeometry(-bleed, -bleed, w + bleed * 2, h + bleed * 2)

        # 标题 (左上)
        self.title_label.move(30, 44)
        # 副标题
        self.subtitle_label.move(34, 94)

        # 快捷入口卡片 (左下)
        card_x = 24
        card_gap = 12
        card_y = h - 110

        self._card_images.move(card_x, card_y)
        self._card_workflow.move(card_x + 175 + card_gap, card_y)

        # 版本号 (左下)
        self.version_label.move(24, h - 28)

        # 按钮并排 (右下)
        self._btn_container.adjustSize()
        bw = self._btn_container.width()
        self._btn_container.move(w - bw - 24, h - 72)

    def showEvent(self, event):
        super().showEvent(event)
        self.resizeEvent(None)
