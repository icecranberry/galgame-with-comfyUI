"""
首页 —— 全屏背景图 + 标题阴影 + 启动邻舍/ComfyUI 并排按钮 + 快捷入口卡片 + 版本号。
"""
import os
import socket
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

        # box-shadow 投影（浅色主题用柔和阴影）
        card_shadow = QGraphicsDropShadowEffect(self)
        card_shadow.setBlurRadius(12)
        card_shadow.setOffset(0, 2)
        card_shadow.setColor(QColor(0, 0, 0, 30))
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
            "color: #2E2A27; font-size: 12px; font-weight: bold; background: transparent;"
        )
        desc_label = QLabel(description, self)
        desc_label.setStyleSheet(
            "color: #756B65; font-size: 10px; background: transparent;"
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

        # 暖色卡片背景 #FCFAF8
        bg_alpha = 255 if self._hovered else 240
        painter.setBrush(QBrush(QColor(252, 250, 248, bg_alpha)))

        # 边框 #E5D9D2
        border_color = QColor(224, 123, 108, 80) if self._hovered else QColor(229, 217, 210)
        painter.setPen(QPen(border_color, 1))

        painter.drawRoundedRect(QRectF(0.5, 0.5, w - 1, h - 1), r, r)

        # 主题色左边 accent (4px) — #E07B6C
        accent_path = QPainterPath()
        accent_path.addRoundedRect(QRectF(0.5, 4, 4, h - 8), 2, 2)
        # clip 到只在卡片左边缘矩形内
        clip_path = QPainterPath()
        clip_path.addRect(QRectF(0, 0, 5, h))
        accent_path = accent_path.intersected(clip_path)
        painter.setPen(Qt.NoPen)
        painter.setBrush(QBrush(QColor(224, 123, 108)))  # #E07B6C
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
        bg_path = os.path.join(self._assets_dir, "launchHeader.jpg")
        self._bg_pixmap = QPixmap(bg_path)
        self._bg_label = QLabel(self)
        self._bg_label.setScaledContents(False)
        self._bg_label.setAttribute(Qt.WA_TransparentForMouseEvents)
        self._bg_label.lower()

        # --- 手机端访问条幅 (服务启动后显示，常驻提醒) ---
        self._mobile_banner = QWidget(self)
        self._mobile_banner.setObjectName("mobileBanner")
        self._mobile_banner.setStyleSheet("""
            #mobileBanner {
                background: rgba(252, 250, 248, 0.94);
                border: 1px solid rgba(224, 123, 108, 0.25);
                border-radius: 10px;
            }
        """)
        self._mobile_banner.hide()

        banner_shadow = QGraphicsDropShadowEffect(self._mobile_banner)
        banner_shadow.setBlurRadius(14)
        banner_shadow.setOffset(0, 3)
        banner_shadow.setColor(QColor(0, 0, 0, 30))
        self._mobile_banner.setGraphicsEffect(banner_shadow)

        banner_layout = QHBoxLayout(self._mobile_banner)
        banner_layout.setContentsMargins(16, 12, 18, 12)
        banner_layout.setSpacing(10)

        banner_icon = QLabel("📱", self._mobile_banner)
        banner_icon.setStyleSheet("font-size: 20px; background: transparent;")
        banner_icon.setFixedWidth(28)
        banner_icon.setAlignment(Qt.AlignCenter)

        self._banner_text = QLabel("", self._mobile_banner)
        self._banner_text.setTextFormat(Qt.RichText)
        self._banner_text.setStyleSheet(
            "color: #2E2A27; font-size: 13px; background: transparent;"
        )
        self._banner_text.setWordWrap(True)

        banner_layout.addWidget(banner_icon)
        banner_layout.addWidget(self._banner_text, 1)

        # --- 快捷入口卡片 + 阴影 (左下区域) ---
        images_path = os.path.join(self._project_dir, "agent-core", "data", "images")
        workflow_path = os.path.join(self._project_dir, "workflow")

        # 卡片（投影由 QGraphicsDropShadowEffect 实现）
        self._card_images = ShortcutCard("生成图片", "agent-core/data/images", self)
        self._card_images.clicked.connect(lambda: self.open_directory.emit(images_path))

        self._card_workflow = ShortcutCard("工作流", "workflow", self)
        self._card_workflow.clicked.connect(lambda: self.open_directory.emit(workflow_path))

        # --- 版本号 (左下) ---
        self.version_label = QLabel("邻舍.EXE v1.0.0", self)
        self.version_label.setStyleSheet(
            "color: #B09890; font-size: 12px; background: transparent;"
        )

        # --- 按钮容器 (右下，并排) ---
        btn_container = QWidget(self)
        btn_layout = QHBoxLayout(btn_container)
        btn_layout.setContentsMargins(0, 0, 0, 0)
        btn_layout.setSpacing(20)

        # ComfyUI 按钮（次要按钮 — 暖色边框风格）
        self.comfyui_btn = QPushButton("▸ 启动 ComfyUI")
        self.comfyui_btn.setFixedHeight(44)
        self.comfyui_btn.setStyleSheet("""
            QPushButton {
                background: #FCFAF8;
                color: #E07B6C;
                font-size: 13px;
                font-weight: bold;
                padding: 0 22px;
                border-radius: 10px;
                border: 1.5px solid #E5D9D2;
            }
            QPushButton:hover {
                background: #F7D7D1;
                border-color: #E07B6C;
            }
            QPushButton:pressed {
                background: #F0C8C0;
                color: #C95F4F;
            }
        """)
        self.comfyui_btn.setCursor(Qt.PointingHandCursor)
        self.comfyui_btn.clicked.connect(self.open_comfyui_clicked.emit)

        # 启动邻舍按钮（主按钮 — 主题色填充）
        self.launch_btn = QPushButton("▶  启动邻舍")
        self.launch_btn.setFixedHeight(44)
        self.launch_btn.setStyleSheet("""
            QPushButton {
                background: #E07B6C;
                color: #FCFAF8;
                font-size: 16px;
                font-weight: bold;
                padding: 0 28px;
                border-radius: 10px;
                border: none;
            }
            QPushButton:hover { background: #D96D5D; }
            QPushButton:pressed { background: #C95F4F; }
        """)
        self.launch_btn.setCursor(Qt.PointingHandCursor)
        self.launch_btn.clicked.connect(self.launch_clicked.emit)

        btn_layout.addWidget(self.comfyui_btn)
        btn_layout.addWidget(self.launch_btn)
        self._btn_container = btn_container

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def set_launch_state(self, state):
        """更新启动按钮的外观和文字。

        state:
            False / "stopped" — 待启动
            "building"        — 构建中
            "starting"        — 服务启动中
            True  / "running" — 运行中
        """
        if state in (True, "running"):
            self.launch_btn.setText("●  运行中")
            self.launch_btn.setEnabled(True)
            self.launch_btn.setStyleSheet("""
                QPushButton {
                    background: #C95F4F;
                    color: #F7D7D1;
                    font-size: 16px;
                    font-weight: bold;
                    padding: 0 28px;
                    border-radius: 10px;
                    border: 2px solid #E07B6C;
                }
                QPushButton:hover { background: #D96D5D; }
                QPushButton:pressed { background: #C95F4F; }
            """)
        elif state == "building":
            self.launch_btn.setText("⏳ 构建中...")
            self.launch_btn.setEnabled(False)
            self.launch_btn.setStyleSheet("""
                QPushButton {
                    background: #E5D9D2;
                    color: #756B65;
                    font-size: 16px;
                    font-weight: bold;
                    padding: 0 28px;
                    border-radius: 10px;
                    border: none;
                }
            """)
        elif state == "starting":
            self.launch_btn.setText("⏳ 启动中...")
            self.launch_btn.setEnabled(False)
            self.launch_btn.setStyleSheet("""
                QPushButton {
                    background: #E5D9D2;
                    color: #756B65;
                    font-size: 16px;
                    font-weight: bold;
                    padding: 0 28px;
                    border-radius: 10px;
                    border: none;
                }
            """)
        else:  # False / "stopped"
            self.launch_btn.setText("▶  启动邻舍")
            self.launch_btn.setEnabled(True)
            self.launch_btn.setStyleSheet("""
                QPushButton {
                    background: #E07B6C;
                    color: #FCFAF8;
                    font-size: 16px;
                    font-weight: bold;
                    padding: 0 28px;
                    border-radius: 10px;
                    border: none;
                }
                QPushButton:hover { background: #D96D5D; }
                QPushButton:pressed { background: #C95F4F; }
            """)

    @staticmethod
    def _get_local_ip() -> str | None:
        """获取本机局域网 IP 地址。失败时返回 None。"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(1)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return None

    def show_mobile_banner(self) -> None:
        """显示手机端访问条幅（服务启动后常驻提醒）。IP 只获取一次并缓存。"""
        if not hasattr(self, '_cached_ip'):
            self._cached_ip = self._get_local_ip()
        if self._cached_ip:
            self._banner_text.setText(
                f'手机端可访问 '
                f'<span style="color:#E07B6C;font-weight:bold;">http://{self._cached_ip}:3099</span>'
                f' 打开邻舍'
            )
            self._mobile_banner.show()
        else:
            self._mobile_banner.hide()

    def hide_mobile_banner(self) -> None:
        """隐藏手机端访问条幅。不清除缓存 IP，避免下次显示时重复探测。"""
        self._mobile_banner.hide()

    def update_version_info(self, tag: str | None, branch: str, has_updates: bool | None):
        if tag:
            project_ver = f"v{tag}" if not tag.startswith("v") else tag
            text = f"邻舍.EXE v1.0.0  ·  内核 {project_ver}"
        elif branch and branch != "main":
            text = f"邻舍.EXE v1.0.0  ·  内核 {branch}"
        else:
            text = "邻舍.EXE v1.0.0"
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


        # 手机端访问条幅 (居中，副标题下方)
        banner_w = min(480, w - 60)
        self._mobile_banner.setGeometry(
            (w - banner_w) // 2, 140, banner_w, 48
        )

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
