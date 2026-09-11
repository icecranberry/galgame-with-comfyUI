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
    "use_mirror": True,  # 使用国内镜像源加速 npm/pip 依赖下载
    "extra_lora_folders": "",  # 额外 LoRA 文件夹路径，多个用;分隔；留空则仅从 ComfyUI/models/loras 读取
    # --- 增量补丁 ---
    # 补丁源：存放 index.json 与 *.tar.gz 的静态目录（对象存储 / 自建站 / 本地或共享目录都行）。
    # 留空则按 repo_url 自动推导为「同仓库的 patches 分支」——本地程序无法被推送，只能主动去拉，
    # 而代码仓库本来就得能访问，所以默认复用它，零新增托管。
    "patch_base_url": "",
    # --- 问题反馈 ---
    # 提交地址模板，支持 {slug} {issue_id} {title} {body} 占位符；默认是 GitHub issue 预填链接
    #（客户端因此不需要内置任何 token）。
    "feedback_issue_template": "https://github.com/{slug}/issues/new?title={title}&body={body}",
    # 备用反馈渠道：主渠道直连不通时自动改开这个链接（QQ 群 / 问卷 / B站视频页）。
    # 无论走哪条路，报告都会先复制到剪贴板，用户粘贴即可。
    "feedback_channel_url": "",
    # --- MaiBot ---
    "maibot_autostart": False,  # 点击一键启动邻舍时同时启动 MaiBot
    "maibot_browser_maibot": True,  # MaiBot 就绪后自动打开后台 (8001)
    "maibot_browser_snowluma": True,  # SnowLuma 就绪后自动打开后台 (5099)
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
