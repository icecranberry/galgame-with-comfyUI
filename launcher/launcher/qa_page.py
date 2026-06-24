"""
Q&A 页面 —— 常见问题与解答。
"""
from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QLabel,
    QScrollArea,
)
from PySide6.QtCore import Qt


QA_DATA = [
    {
        "q": "下载下来的Anima模型包怎么用？",
        "a": (
            "找到ComfyUI整合包安装目录里的的ComfyUI-aki-v3\ComfyUI"
            "粘贴同名文件夹就行了"
        ),
    },
    {
        "q": "出图慢，卡顿怎么办？",
        "a": (
            "显存 ≤ 8G 可以考虑ComfyUI启动器高级选项页面打开使用共享显存，"
            "内存 ≥ 32G 可以打开智能显存优化"
        ),
    },
    {
        "q": "ComfyUI 跑图的时候卡到晃鼠标都卡怎么办？",
        "a": (
            "主包也不知道为什么，主包也会偶发，但是等它一分钟关闭再启动 ComfyUI 就好了，"
            "正常来说系统自动调度，一边跑图一边打游戏都没事"
        ),
    },
    {
        "q": "ComfyUI 出图失败怎么办？",
        "a": (
            "原因比较多，可以把 workflow\\制图工作流.json "
            "直接拖到打开的 ComfyUI 界面点击运行精准报错"
            "再次检查内核版本，主包自己测试了v0.23是可以跑Anima的"
        ),
    },
    {
        "q": "主包主包我有鬼点子怎么办？",
        "a": "欢迎来 B 站 @琪猫猫来了全秒了，视频底下畅所欲言",
    },
]


class QAPage(QWidget):
    """Q&A 页面。"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._setup_ui()

    def _setup_ui(self):
        self.setStyleSheet("background: #F7F3F0;")

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)

        # 滚动区域
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("""
            QScrollArea {
                background: transparent;
                border: none;
            }
            QScrollBar:vertical {
                background: #F1ECE8;
                width: 6px;
                margin: 0;
            }
            QScrollBar::handle:vertical {
                background: #C9C0BB;
                border-radius: 3px;
                min-height: 30px;
            }
            QScrollBar::handle:vertical:hover {
                background: #B0A8A3;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0;
            }
        """)

        container = QWidget()
        container.setStyleSheet("background: transparent;")
        layout = QVBoxLayout(container)
        layout.setContentsMargins(24, 44, 24, 24)
        layout.setSpacing(20)

        # 标题
        title = QLabel("常见问题 · Q&A")
        title.setStyleSheet("color: #2E2A27; font-size: 18px; font-weight: bold;")
        layout.addWidget(title)

        for item in QA_DATA:
            # Q — 主题色
            q_label = QLabel(f"Q：{item['q']}")
            q_label.setWordWrap(True)
            q_label.setStyleSheet(
                "color: #E07B6C; font-size: 14px; font-weight: bold;"
            )
            layout.addWidget(q_label)

            # A — 次文字色
            a_label = QLabel(f"A：{item['a']}")
            a_label.setWordWrap(True)
            a_label.setStyleSheet(
                "color: #756B65; font-size: 13px; line-height: 1.6;"
            )
            layout.addWidget(a_label)

        layout.addStretch()
        scroll.setWidget(container)
        outer.addWidget(scroll)
