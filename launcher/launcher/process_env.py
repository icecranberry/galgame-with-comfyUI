"""子进程环境补全。

GUI 启动器交给子进程的环境可能被收窄：实测用户机器上的 Node 进程只剩 19 个变量，
PATHEXT、SystemDrive、windir、ComSpec 都不在。缺 PATHEXT 时 PowerShell 可能拒绝
把 .exe 当命令执行——静默无输出、$LASTEXITCODE 为 $null，本地语音就会报
「无法迁移」。

所有 QProcess 在 setProcessEnvironment 之前都经过这里，补齐这些系统变量。
"""
import os

# 收窄环境里可能缺失、但子进程（尤其是 PowerShell / cmd / npm 包装脚本）需要的变量
SYSTEM_ENV_KEYS = (
    "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP",
    "SystemRoot", "PATH", "APPDATA", "LOCALAPPDATA",
    "PATHEXT", "ComSpec", "SystemDrive", "windir",
)

DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC"


def ensure_system_env(env):
    """从 os.environ 补全缺失的系统变量，并给关键项兜底默认值。"""
    for key in SYSTEM_ENV_KEYS:
        if key in os.environ and key not in env.keys():
            env.insert(key, os.environ[key])

    if not env.value("PATHEXT"):
        env.insert("PATHEXT", DEFAULT_PATHEXT)
    system_root = env.value("SystemRoot") or os.environ.get("SystemRoot", r"C:\Windows")
    if not env.value("SystemRoot"):
        env.insert("SystemRoot", system_root)
    if not env.value("ComSpec"):
        env.insert("ComSpec", os.path.join(system_root, "System32", "cmd.exe"))
    if not env.value("SystemDrive"):
        env.insert("SystemDrive", os.path.splitdrive(system_root)[0] or "C:")
    if not env.value("windir"):
        env.insert("windir", system_root)
    return env
