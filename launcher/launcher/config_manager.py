"""
配置管理器 —— JSON 文件的读写和变更通知。
配置文件与 exe 同目录（项目根目录），名为 launcher_config.json。
"""
import json
import os
from PySide6.QtCore import QObject, Signal


DEFAULT_CONFIG = {
    "repo_url": "https://github.com/icecranberry/galgame-with-comfyUI.git",
    "comfyui_exe": "",
    "auto_open_browser": True,
    "check_comfyui_before_start": True,
    "current_tag": "",
    "last_fetch_date": "",
    "version_display": "",  # 持久化版本信息，启动即可显示
}


class ConfigManager(QObject):
    """JSON 配置读写，变更时发射 config_changed 信号。"""

    config_changed = Signal(str)  # key

    def __init__(self, exe_dir: str):
        super().__init__()
        self._path = os.path.join(exe_dir, "launcher_config.json")
        self._data = {}
        self._load()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, key: str):
        return self._data.get(key, DEFAULT_CONFIG.get(key))

    def set(self, key: str, value):
        """写入并自动保存，发射 config_changed 信号。"""
        if self._data.get(key) == value:
            return
        self._data[key] = value
        self._save()
        self.config_changed.emit(key)

    def get_all(self) -> dict:
        return {**DEFAULT_CONFIG, **self._data}

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _load(self):
        if os.path.exists(self._path):
            try:
                with open(self._path, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
            except (json.JSONDecodeError, OSError):
                self._data = {}
        else:
            self._data = {}
            self._save()  # 写默认配置

    def _save(self):
        try:
            with open(self._path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
        except OSError:
            pass  # 静默失败，下次启动会恢复
