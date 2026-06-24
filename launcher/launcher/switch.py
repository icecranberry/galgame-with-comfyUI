"""
仿 Element UI Switch 开关 —— 自定义 QWidget，支持滑动动画。
"""
from PySide6.QtWidgets import QWidget
from PySide6.QtCore import Qt, Signal, QPropertyAnimation, QEasingCurve, Property
from PySide6.QtGui import QPainter, QColor, QBrush, QPen, QFont, QFontMetrics


class Switch(QWidget):
    """滑动开关。API 与 QCheckBox 兼容（toggled / isChecked / setChecked）。"""

    toggled = Signal(bool)

    def __init__(self, text: str = "", parent=None):
        super().__init__(parent)
        self._checked = False
        self._text = text
        self._anim_value = 0.0  # 0.0=off, 1.0=on

        # 配色
        self._track_on = QColor("#E07B6C")
        self._track_off = QColor("#C9C0BB")
        self._thumb_color = QColor("#FCFAF8")

        # 尺寸（匹配 Element UI 比例）
        self._track_w = 44
        self._track_h = 24
        self._thumb_d = 20  # 圆点直径
        self._thumb_pad = 2  # 轨道内边距

        self.setCursor(Qt.PointingHandCursor)
        self.setFixedHeight(max(self._track_h, 22))

        # 根据文字计算最小宽度
        fm = QFontMetrics(self.font())
        text_w = fm.horizontalAdvance(text) if text else 0
        self.setMinimumWidth(self._track_w + (text_w + 10 if text else 0))

    # ------------------------------------------------------------------
    # QPropertyAnimation 需要的 property
    # ------------------------------------------------------------------

    def _get_anim_value(self) -> float:
        return self._anim_value

    def _set_anim_value(self, value: float):
        self._anim_value = value
        self.update()

    anim_value = Property(float, _get_anim_value, _set_anim_value)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def isChecked(self) -> bool:
        return self._checked

    def setChecked(self, checked: bool):
        """程序设置状态（不播放动画，信号受 blockSignals 控制）。"""
        if self._checked != checked:
            self._checked = checked
            self._anim_value = 1.0 if checked else 0.0
            self.update()
            self.toggled.emit(checked)

    # ------------------------------------------------------------------
    # Paint
    # ------------------------------------------------------------------

    def paintEvent(self, event):
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)

        # 轨道
        track_color = _lerp_color(self._track_off, self._track_on, self._anim_value)
        p.setPen(Qt.NoPen)
        p.setBrush(QBrush(track_color))
        track_y = (self.height() - self._track_h) // 2
        p.drawRoundedRect(
            0, track_y, self._track_w, self._track_h,
            self._track_h // 2, self._track_h // 2,
        )

        # 滑块圆点
        thumb_range = self._track_w - self._thumb_d - self._thumb_pad * 2
        thumb_x = self._thumb_pad + int(thumb_range * self._anim_value)
        thumb_y = (self.height() - self._thumb_d) // 2
        p.setBrush(QBrush(self._thumb_color))
        p.drawEllipse(thumb_x, thumb_y, self._thumb_d, self._thumb_d)

        # 文字标签
        if self._text:
            p.setPen(QColor("#2E2A27"))
            p.setFont(self.font())
            text_x = self._track_w + 10
            p.drawText(
                text_x, 0, self.width() - text_x, self.height(),
                Qt.AlignVCenter | Qt.AlignLeft, self._text,
            )

        p.end()

    # ------------------------------------------------------------------
    # Interaction
    # ------------------------------------------------------------------

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.setChecked(not self._checked)
            self._animate()
        super().mousePressEvent(event)

    # ------------------------------------------------------------------
    # Animation
    # ------------------------------------------------------------------

    def _animate(self):
        self._anim = QPropertyAnimation(self, b"anim_value")
        self._anim.setDuration(220)
        self._anim.setEasingCurve(QEasingCurve.OutCubic)
        self._anim.setStartValue(0.0 if self._checked else 1.0)
        self._anim.setEndValue(1.0 if self._checked else 0.0)
        self._anim.start()


# ------------------------------------------------------------------
# Helper
# ------------------------------------------------------------------

def _lerp_color(a: QColor, b: QColor, t: float) -> QColor:
    """线性插值两个 QColor。"""
    return QColor(
        int(a.red() + (b.red() - a.red()) * t),
        int(a.green() + (b.green() - a.green()) * t),
        int(a.blue() + (b.blue() - a.blue()) * t),
    )
