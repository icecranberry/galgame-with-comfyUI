"""在 Windows 系统 DLL 优先的环境中打包启动器。"""
import os
import subprocess
import sys


def prepare_build_environment():
    if os.name != "nt":
        return
    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    # PyInstaller 按 PATH 顺序解析 DLL。开发工具可能提前放入 Poppler、
    # Git 等程序的同名 ICU DLL；Qt 依赖的是 Windows 的无版本后缀接口。
    # 仅调整本次构建进程，避免把第三方 icuuc.dll 错收进发布包。
    os.environ["PATH"] = os.pathsep.join([
        os.path.join(system_root, "System32"),
        system_root,
        os.environ.get("PATH", ""),
    ])


def normalize_executable_integrity(executable):
    if os.name != "nt":
        return
    # 构建目录可能带可继承的 Low 标签；只修正最终 EXE，不改项目目录权限。
    subprocess.run(
        [os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "icacls.exe"),
         os.path.abspath(executable), "/setintegritylevel", "M"],
        check=True,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )


def main():
    if sys.argv[1:2] == ["--normalize-integrity"]:
        if len(sys.argv) != 3:
            raise SystemExit("用法: build_launcher.py --normalize-integrity <exe>")
        normalize_executable_integrity(sys.argv[2])
        return
    prepare_build_environment()
    from PyInstaller.__main__ import run
    run()


if __name__ == "__main__":
    main()
