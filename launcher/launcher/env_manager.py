"""
系统环境管理器 —— 检测 + 通过 winget 自动安装缺失的系统依赖。
"""
import os
import subprocess
import shutil
from PySide6.QtCore import QObject, Signal


# 已知的 winget 默认安装路径（安装后 PATH 可能未刷新，需要直接找磁盘）
_WINGET_INSTALL_PATHS: dict[str, list[str]] = {
    "node": [
        os.path.expandvars(r"%ProgramFiles%\nodejs"),
        os.path.expandvars(r"%ProgramFiles(x86)%\nodejs"),
    ],
    "python": [
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python312"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Python\Python313"),
        os.path.expandvars(r"%ProgramFiles%\Python312"),
        os.path.expandvars(r"%ProgramFiles%\Python313"),
    ],
    "git": [
        os.path.expandvars(r"%ProgramFiles%\Git\bin"),
        os.path.expandvars(r"%ProgramFiles%\Git\cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Git\bin"),
    ],
}

# 每个工具对应的二进制文件名，用于在安装目录中定位
_TOOL_BINARIES: dict[str, list[str]] = {
    "node": ["npm.cmd", "node.exe"],
    "python": ["python.exe"],
    "git": ["git.exe"],
}

TOOLS: dict[str, dict] = {
    "node": {
        "display": "Node.js",
        "winget_id": "OpenJS.NodeJS.LTS",
        "check_cmd": "node",
    },
    "python": {
        "display": "Python 3.12",
        "winget_id": "Python.Python.3.12",
        "check_cmd": "python",
    },
    "git": {
        "display": "Git",
        "winget_id": "Git.Git",
        "check_cmd": "git",
    },
}


class EnvManager(QObject):
    """检测系统环境，自动安装缺失的工具。"""

    output = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)

    # ------------------------------------------------------------------
    # 同步检测
    # ------------------------------------------------------------------

    def is_tool_available(self, tool_key: str) -> bool:
        """检查某个工具是否可在 PATH 上找到并可执行。"""
        try:
            # 用 shutil.which 查 PATH
            cmd = TOOLS[tool_key]["check_cmd"]
            path = shutil.which(cmd)
            if path:
                return True

            # 也可能在已知安装路径里（刚装的，PATH 没刷新）
            return self.find_tool_dir(tool_key) is not None
        except Exception:
            return False

    def is_winget_available(self) -> bool:
        """检查 winget 是否可用。"""
        try:
            result = subprocess.run(
                ["winget", "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.returncode == 0
        except Exception:
            return False

    def find_tool_dir(self, tool_key: str) -> str | None:
        """
        在磁盘上搜索工具的安装目录。
        返回包含二进制文件的目录路径，找不到返回 None。
        """
        binaries = _TOOL_BINARIES.get(tool_key, [])

        # 1) 先试 shutil.which（PATH 里可能已经有了）
        for binary in binaries:
            found = shutil.which(binary)
            if found:
                return os.path.dirname(found)

        # 2) 搜已知的 winget 安装路径
        for candidate_dir in _WINGET_INSTALL_PATHS.get(tool_key, []):
            if os.path.isdir(candidate_dir):
                for binary in binaries:
                    if os.path.isfile(os.path.join(candidate_dir, binary)):
                        return candidate_dir

        return None

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
