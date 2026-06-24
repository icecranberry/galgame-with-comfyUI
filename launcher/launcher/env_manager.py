"""
系统环境管理器 —— 检测 + 通过 winget 自动安装缺失的系统依赖。
所有检查仅扫描已知安装路径，不调用 shutil.which() 扫 PATH，
避免 Windows PATH 中的网络驱动器导致卡死。
"""
import os
from PySide6.QtCore import QObject, Signal


# 已知的安装路径（winget 默认路径 + 常见位置）
_INSTALL_PATHS: dict[str, list[str]] = {
    "node": [
        os.path.expandvars(r"%ProgramFiles%\nodejs"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs"),
    ],
    "python": [
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python313"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python312"),
        os.path.expandvars(r"%ProgramFiles%\Python313"),
        os.path.expandvars(r"%ProgramFiles%\Python312"),
    ],
    "git": [
        os.path.expandvars(r"%ProgramFiles%\Git\bin"),
        os.path.expandvars(r"%ProgramFiles%\Git\cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Git\bin"),
    ],
    "winget": [
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WindowsApps"),
    ],
}

# 每个工具对应的二进制文件名
_TOOL_BINARIES: dict[str, list[str]] = {
    "node": ["npm.cmd", "node.exe"],
    "python": ["python.exe"],
    "git": ["git.exe"],
    "winget": ["winget.exe"],
}

TOOLS: dict[str, dict] = {
    "node": {
        "display": "Node.js",
        "winget_id": "OpenJS.NodeJS.LTS",
    },
    "python": {
        "display": "Python 3.12",
        "winget_id": "Python.Python.3.12",
    },
    "git": {
        "display": "Git",
        "winget_id": "Git.Git",
    },
}


class EnvManager(QObject):
    """检测系统环境，自动安装缺失的工具。所有检查零阻塞。"""

    output = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)

    # ------------------------------------------------------------------
    # 同步检测（仅扫描已知路径，绝不扫 PATH）
    # ------------------------------------------------------------------

    def is_tool_available(self, tool_key: str) -> bool:
        """检查工具是否在已知安装路径中存在。"""
        try:
            return self.find_tool_dir(tool_key) is not None
        except Exception:
            return False

    def is_winget_available(self) -> bool:
        """检查 winget 是否在已知路径中存在。"""
        return self._find_in_paths("winget") is not None

    def find_tool_dir(self, tool_key: str) -> str | None:
        """
        在已知安装路径中搜索工具的安装目录。
        返回包含二进制文件的目录路径，找不到返回 None。
        """
        return self._find_in_paths(tool_key)

    # ------------------------------------------------------------------
    # 安装步骤生成
    # ------------------------------------------------------------------

    def get_install_step(self, tool_key: str) -> dict:
        """
        返回一个与 BuildManager 步骤兼容的 winget 安装步骤字典。
        _tool_key 字段用于安装后的路径发现。
        """
        info = TOOLS[tool_key]
        return {
            "name": f"安装 {info['display']} (winget)",
            "cwd": os.getcwd(),
            "cmd": "winget",
            "args": [
                "install",
                info["winget_id"],
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ],
            "timeout": 300000,  # 5 分钟，winget 下载可能较慢
            "_tool_key": tool_key,
        }

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _find_in_paths(tool_key: str) -> str | None:
        """在已知安装路径中查找工具的二进制文件。"""
        binaries = _TOOL_BINARIES.get(tool_key, [])
        for candidate_dir in _INSTALL_PATHS.get(tool_key, []):
            if os.path.isdir(candidate_dir):
                for binary in binaries:
                    if os.path.isfile(os.path.join(candidate_dir, binary)):
                        return candidate_dir
        return None
