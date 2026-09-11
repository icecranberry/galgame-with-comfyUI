"""
全局日志环形缓冲 —— 所有 LogWidget 的输出都汇聚到这里。

存在的理由：反馈页需要「系统自动生成的简要日志」，用户不应该自己去别的标签页
复制粘贴。启动器里有多个互不相干的日志区（运行日志页、版本页、MaiBot 页），
让每个调用点都手动再喂一份容易漏；改为在 LogWidget.append_line 这一个入口
统一汇入，任何新增日志区都自动被覆盖。

纯内存、进程内、有上限，不落盘（日志里可能有用户对话内容，不主动持久化）。
"""
from collections import deque
from threading import Lock

# 反馈只需要「最近发生了什么」，800 行足够覆盖一次故障的现场，也避免报告过大。
MAX_LINES = 800

_lock = Lock()
_buffer: deque[str] = deque(maxlen=MAX_LINES)


def append(text: str) -> None:
    """记录一行日志（多行文本会按行拆开）。空行忽略。"""
    if not text:
        return
    with _lock:
        for raw in str(text).splitlines():
            line = raw.rstrip()
            if line:
                _buffer.append(line)


def snapshot(limit: int | None = None) -> list[str]:
    """取最近若干行（时间正序）。limit 为 None 时取全部缓冲。"""
    with _lock:
        items = list(_buffer)
    if limit is not None and limit > 0:
        return items[-limit:]
    return items


def clear() -> None:
    with _lock:
        _buffer.clear()
