"""
Git 管理器 —— 封装 git CLI 调用，所有耗时操作通过 QProcess 异步执行。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit
from PySide6.QtCore import QObject, Signal, QProcess

from .process_env import ensure_system_env

# Windows 下隐藏 subprocess 弹出的命令行窗口
_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000) if sys.platform == "win32" else 0
_CACHE_TTL = 2.0  # 同一次初始化链内去重，2 秒内复用缓存
# 部分 Windows 网络环境（防火墙/杀软/代理拦截）无法访问 CRL/OCSP 服务器，
# schannel 证书吊销检查失败会导致 TLS 握手报错 CRYPT_E_NO_REVOCATION_CHECK。
# 通过单次调用参数禁用该检查，不写入用户全局配置。
_TLS_NO_REVOKE_ARGS = ["-c", "http.schannelCheckRevoke=false"]
# 统一的 fetch 参数：--update-shallow 兼容 release 包的 shallow clone；
# --prune --prune-tags 清理远程已删除的旧 tag，避免用户切到废弃版本。
_FETCH_ARGS = ["fetch", "--update-shallow", "--prune", "--prune-tags",
               "origin", "--tags"]
_PROXY_ENV_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
                   "http_proxy", "https_proxy", "all_proxy", "no_proxy")


def _cached(ttl: float = _CACHE_TTL):
    """装饰器：短 TTL 内存缓存，消除启动时链式调用导致的重复 subprocess。"""

    def deco(func):
        def wrapper(self, *args, **kwargs):
            now = time.monotonic()
            key = func.__name__
            entry = self._git_cache.get(key)
            if entry and (now - entry["ts"]) < ttl:
                return entry["value"]
            value = func(self, *args, **kwargs)
            self._git_cache[key] = {"value": value, "ts": now}
            return value

        return wrapper

    return deco


def _is_proxy_connection_error(stderr_lines: list[str]) -> bool:
    """自动代理的传输失败可以在本次操作中降级为直连。"""
    joined = " ".join(stderr_lines).lower()
    return any(message in joined for message in (
        "failed to connect", "could not connect", "could not resolve proxy",
        "connection timed out", "connection was reset", "connect tunnel failed",
        "proxy connect aborted", "empty reply from server",
    ))


def _is_github_remote(url: str | None) -> bool:
    try:
        parsed = urlsplit(url or "")
        return parsed.scheme in ("http", "https") and parsed.hostname in ("github.com", "www.github.com")
    except ValueError:
        return False


def _read_github_proxy(project_path: str) -> tuple[str, str] | None:
    for mode, filename in (("manual", "github-proxy.json"), ("auto", "github-proxy-auto.json")):
        try:
            path = os.path.join(project_path, "agent-core", "data", filename)
            with open(path, encoding="utf-8") as file:
                url = json.load(file).get("proxyUrl")
            if isinstance(url, str) and (url or mode == "manual"):
                return mode, url
        except (OSError, ValueError, AttributeError):
            continue
    return None


def _git_proxy_args(url: str) -> list[str]:
    return ["-c", f"http.proxy={url}", "-c", f"remote.origin.proxy={url}"]


def _is_schannel_revocation_error(stderr_lines: list[str]) -> bool:
    """检测是否为 Windows schannel 后端的证书吊销检查失败。

    典型 stderr:
      fatal: unable to access 'https://github.com/.../': schannel: next
      InitializeSecurityContext failed: CRYPT_E_NO_REVOCATION_CHECK (0x80092012)
    """
    joined = " ".join(stderr_lines).lower()
    return ("schannel" in joined or "revocation check" in joined
            or "no_revocation_check" in joined)


def _find_ca_bundle(git_exe: str) -> str:
    """定位随 Git 分发的 ca-bundle.crt（切换 OpenSSL 后端时依赖）。

    从 git.exe 位置向上探测常见布局，找不到返回空字符串
    （此时交给 git 使用其编译内置路径）。
    """
    base = os.path.dirname(os.path.abspath(git_exe))   # .../Git/cmd 或 .../Git/bin
    roots = [base, os.path.dirname(base)]              # cmd/、Git/
    rels = [
        ("mingw64", "etc", "ssl", "certs", "ca-bundle.crt"),
        ("mingw32", "etc", "ssl", "certs", "ca-bundle.crt"),
        ("usr", "ssl", "certs", "ca-bundle.crt"),
        ("etc", "ssl", "certs", "ca-bundle.crt"),
        ("mingw64", "share", "ca-bundle.crt"),
    ]
    for root in roots:
        for rel in rels:
            candidate = os.path.join(root, *rel)
            if os.path.isfile(candidate):
                return candidate
    return ""


class GitManager(QObject):
    """Git 操作：fetch、tags、checkout、检测更新。"""

    # 信号
    output = Signal(str)  # 操作输出（逐行）
    operation_done = Signal(str, bool, str)  # (operation_name, success, message)

    def __init__(self, project_path: str, repo_url: str = "", parent=None):
        super().__init__(parent)
        self._project_path = project_path
        self._repo_url = repo_url
        self._proc: QProcess | None = None
        self._proxy_probe: QProcess | None = None
        self._pending_op = ""
        self._fetch_gen = 0          # fetch 代际：递增以忽略被 kill 的 stale callback
        self._finished_fetch_gen = 0 # 当前完成的 fetch 代际
        self._git_cache: dict[str, dict] = {}  # key → {value, ts}
        self._stderr_lines: list[str] = []     # 累积当前操作的 stderr
        self._proxy_retried = False     # 当前网络操作是否已尝试过绕过代理重试
        self._auto_proxy_tried = False
        self._using_auto_proxy = False
        self._ssl_backend_retried = False  # 当前网络操作是否已尝试过切换 OpenSSL 后端

    @property
    def project_path(self) -> str:
        return self._project_path

    def set_project_path(self, path: str):
        self._project_path = path

    def set_repo_url(self, url: str):
        self._repo_url = url

    def clear_cache(self):
        """清除 _cached 装饰器的内存缓存。"""
        self._git_cache.clear()

    def is_busy(self) -> bool:
        """是否有正在进行的异步操作。"""
        return bool(self._pending_op)

    def _cleanup_locks(self):
        """清理残留的 git 锁文件（进程被 kill 后可能遗留）。"""
        for name in ("index.lock", "HEAD.lock", "config.lock",
                     "packed-refs.lock", "shallow.lock"):
            lock = os.path.join(self._project_path, ".git", name)
            try:
                if os.path.isfile(lock):
                    os.remove(lock)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # 同步方法（快速，不阻塞）
    # ------------------------------------------------------------------

    def is_git_repo(self) -> bool:
        """检查是否为 git 仓库。"""
        return os.path.isdir(os.path.join(self._project_path, ".git"))

    def get_remote_url(self) -> str | None:
        """获取当前 origin remote URL。"""
        try:
            git_exe = self._resolve_git()
            result = subprocess.run(
                [git_exe, "remote", "get-url", "origin"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=_CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return None

    def is_remote_local_path(self) -> bool:
        """检查 remote URL 是否为本地路径（构建机遗留）。"""
        url = self.get_remote_url()
        if not url:
            return False
        # 本地路径特征：盘符开头(Windows) 或 / 开头但不含 ://
        if sys.platform == "win32":
            if len(url) >= 2 and url[1] == ":":
                return True
        if url.startswith("/") and "://" not in url:
            return True
        return False

    def repair_remote(self) -> bool:
        """如果 origin URL 是本地路径（构建机遗留），修正为 GitHub URL。"""
        if not self._repo_url:
            return False
        if not self.is_git_repo():
            return False
        if not self.is_remote_local_path():
            return True  # 已经是正常 URL，无需修复

        try:
            git_exe = self._resolve_git()
            result = subprocess.run(
                [git_exe, "remote", "set-url", "origin", self._repo_url],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=_CREATE_NO_WINDOW,
            )
            return result.returncode == 0
        except Exception:
            return False

    @_cached()
    def get_tags(self) -> list[dict]:
        """获取所有 tags，按创建时间倒序。每条含 name / message / date。"""
        try:
            git_exe = self._resolve_git()
            result = subprocess.run(
                [git_exe, "for-each-ref", "--sort=-creatordate",
                 "--format=%(refname:short)%00%(subject)%00%(creatordate:short)", "refs/tags/"],
                cwd=self._project_path,
                capture_output=True,
                timeout=10,
                creationflags=_CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                tags = []
                # null-byte 分隔，先按换行拆条目，再按 \0 拆字段
                for line in result.stdout.decode("utf-8", errors="replace").splitlines():
                    if not line.strip():
                        continue
                    parts = line.split("\0")
                    name = parts[0].strip()
                    message = parts[1].strip() if len(parts) > 1 else ""
                    date = parts[2].strip() if len(parts) > 2 else ""
                    tags.append({"name": name, "message": message, "date": date})
                return tags
        except Exception:
            pass
        return []

    @_cached()
    def get_current_tag(self) -> str | None:
        """获取 HEAD 对应的 tag 名（精确匹配），不在 tag 上则返回 None。"""
        try:
            git_exe = self._resolve_git()
            result = subprocess.run(
                [git_exe, "describe", "--tags", "--exact-match", "--abbrev=0"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=_CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return None

    @_cached()
    def get_current_branch(self) -> str:
        """获取当前分支名。"""
        try:
            git_exe = self._resolve_git()
            result = subprocess.run(
                [git_exe, "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=self._project_path,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=_CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return "unknown"

    @_cached(ttl=5.0)  # ls-remote 走网络，缓存稍长
    def get_latest_remote_tag(self) -> str | None:
        """获取远程最新 tag，和异步 fetch 使用相同的 GitHub 代理。"""
        github = _is_github_remote(self.get_remote_url())
        mode, proxy_url = ("", None)
        env = os.environ.copy()
        if github:
            saved = _read_github_proxy(self._project_path)
            if saved is None and not self._auto_proxy_tried:
                command = self._proxy_probe_command()
                if command:
                    try:
                        subprocess.run(command, capture_output=True, timeout=6, creationflags=_CREATE_NO_WINDOW)
                    except (OSError, subprocess.TimeoutExpired):
                        pass
                saved = _read_github_proxy(self._project_path)
            mode, proxy_url = saved or ("direct", "")
            for key in _PROXY_ENV_KEYS:
                env.pop(key, None)
        use_openssl = False
        for _ in range(3):
            cmd = [self._resolve_git()] + _TLS_NO_REVOKE_ARGS
            if use_openssl:
                cmd += ["-c", "http.sslBackend=openssl"]
                ca_bundle = _find_ca_bundle(self._resolve_git())
                if ca_bundle:
                    cmd += ["-c", f"http.sslCAInfo={ca_bundle}"]
            if proxy_url is not None:
                cmd += _git_proxy_args(proxy_url)
            cmd += ["ls-remote", "--tags", "--sort=-creatordate", "origin"]

            try:
                result = subprocess.run(
                    cmd,
                    cwd=self._project_path,
                    capture_output=True,
                    text=True,
                    env=env,
                    timeout=15,
                    creationflags=_CREATE_NO_WINDOW,
                )
                if result.returncode == 0:
                    for line in result.stdout.splitlines():
                        m = re.search(r"refs/tags/(.+?)(?:\^\{\})?$", line.strip())
                        if m and not m.group(1).endswith("^{}"):
                            return m.group(1)
                    return None  # 命令成功但无 tag，无需重试

                errors = result.stderr.splitlines()
            except subprocess.TimeoutExpired:
                errors = ["connection timed out"]
            except (OSError, UnicodeError):
                return None
            if not use_openssl and _is_schannel_revocation_error(errors):
                use_openssl = True
                continue
            if mode == "auto" and proxy_url and _is_proxy_connection_error(errors):
                proxy_url = ""
                continue
            return None
        return None

    def has_updates(self) -> bool | None:
        """检查远程是否有更新的 tag（语义化版本比较）。返回 None 表示无法判断。

        fetch 成功后本地 refs/tags 已是最新，优先用本地 tag 比较（零网络，
        避免在 UI 主线程同步跑 ls-remote 造成最长约 30 秒卡顿）；
        本地无任何 tag 时才回退到 ls-remote 联网查询。
        """
        current = self.get_current_tag()
        if current is None:
            return None
        # fetch 后 get_tags 的 2 秒缓存可能还存着旧数据，强制失效重读
        self._git_cache.pop("get_tags", None)
        tags = self.get_tags()
        latest = tags[0]["name"] if tags else self.get_latest_remote_tag()
        if latest is None:
            return None
        return _version_greater(latest, current)

    # ------------------------------------------------------------------
    # 异步方法（通过 QProcess）
    # ------------------------------------------------------------------

    def _precheck(self) -> str | None:
        """执行 git 前的快速环境预检，返回错误信息或 None。"""
        # 1. Git 可执行文件是否存在
        git_exe = self._resolve_git()
        if not os.path.isfile(git_exe):
            return "没有找到 Git，请重新安装启动器后再试"
        # GitHub 的 DNS 可通过代理解析，预检只检查本地条件。
        try:
            usage = shutil.disk_usage(self._project_path)
            if usage.free < 300 * 1024 * 1024:
                return "磁盘空间不足（至少需要 300MB 剩余空间），请清理一些文件后重试"
        except Exception:
            pass
        return None

    def fetch_remote(self) -> str | None:
        """异步 fetch origin。返回 None 表示启动成功，否则返回错误信息。"""
        if not self.is_git_repo():
            return "不是有效的 git 仓库"
        if self.is_busy():
            return "上一个操作仍在进行中，请稍后再试"

        precheck_err = self._precheck()
        if precheck_err:
            return precheck_err

        self._cleanup_locks()
        self._fetch_gen += 1
        self._pending_op = "fetch"
        self._proxy_retried = False
        self._auto_proxy_tried = False
        self._ssl_backend_retried = False
        self._run_git(_FETCH_ARGS)
        return None

    def checkout_tag(self, tag: str) -> str | None:
        """异步 checkout 指定 tag。使用 --force 覆盖本地修改（预构建产物等）。"""
        if not self.is_git_repo():
            return "不是有效的 git 仓库"
        if self.is_busy():
            return "上一个操作仍在进行中，请稍后再试"

        self._cleanup_locks()
        self._pending_op = "checkout"
        self._run_git(["checkout", "--force", f"tags/{tag}"])
        return None

    def init_repo(self) -> str | None:
        """异步初始化 git 仓库（无 .git 目录时）。

        链式执行: git init → git remote add origin → git fetch origin --tags。
        返回 None 表示启动成功，否则返回错误信息。
        """
        if self.is_git_repo():
            return "已是有效的 git 仓库"
        if not self._repo_url:
            return "未配置远程仓库地址"
        if self.is_busy():
            return "上一个操作仍在进行中，请稍后再试"

        self._fetch_gen += 1
        self._pending_op = "init_repo"
        self._proxy_retried = False
        self._auto_proxy_tried = False
        self._ssl_backend_retried = False
        self._init_repo_steps = [
            (["init"], "git init"),
            (["remote", "add", "origin", self._repo_url], "git remote add"),
            (["fetch", "origin", "--tags"], "git fetch"),
        ]
        self._init_repo_step_idx = 0
        self._run_git(self._init_repo_steps[0][0])
        return None

    def cancel(self):
        """取消当前操作。"""
        if self._proxy_probe is not None:
            probe, self._proxy_probe = self._proxy_probe, None
            probe.finished.connect(probe.deleteLater)
            probe.kill()
            operation, self._pending_op = self._pending_op, ""
            self._init_repo_steps = []
            self.operation_done.emit(operation, False, "操作已取消")
            return
        if self._proc and self._proc.state() != QProcess.NotRunning:
            self._proc.kill()
        self._init_repo_steps = []

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _proxy_probe_command(self) -> list[str] | None:
        from .service_runner import find_bundled_node
        node = find_bundled_node(self._project_path) or shutil.which("node")
        script = os.path.join(self._project_path, "scripts", "github-proxy.mjs")
        return [node, script] if node and os.path.isfile(script) else None

    def _start_proxy_probe(self, args: list[str], ssl_backend: str) -> bool:
        command = self._proxy_probe_command()
        if not command:
            return False
        probe = QProcess(self)
        self._proxy_probe = probe

        def resume():
            if self._proxy_probe is not probe:
                return
            self._proxy_probe = None
            probe.deleteLater()
            self._run_git(args, ssl_backend=ssl_backend)

        probe.finished.connect(lambda *_: resume())
        probe.errorOccurred.connect(lambda error: resume() if error == QProcess.FailedToStart else None)
        self.output.emit("[proxy] 正在探测本机 GitHub 代理...")
        probe.start(command[0], command[1:])
        return True

    def _run_git(self, args: list[str], ssl_backend: str = ""):
        proxy_url = None
        self._using_auto_proxy = False
        if args[0] == "fetch" and _is_github_remote(self.get_remote_url()):
            saved = _read_github_proxy(self._project_path)
            if saved is None and not self._auto_proxy_tried:
                self._auto_proxy_tried = True
                if self._start_proxy_probe(args, ssl_backend):
                    return
            mode, proxy_url = saved or ("direct", "")
            if self._proxy_retried:
                proxy_url = ""
            self._using_auto_proxy = mode == "auto" and bool(proxy_url)
        if self._proc is not None:
            self._proc.kill()
            self._proc.deleteLater()

        self._stderr_lines.clear()
        self._current_git_args = args
        args = _TLS_NO_REVOKE_ARGS + args
        if ssl_backend:
            # 切换 TLS 后端（如 openssl）；显式指定 CA 包，兼容便携版 Git
            args = ["-c", f"http.sslBackend={ssl_backend}"] + args
            ca_bundle = _find_ca_bundle(self._resolve_git())
            if ca_bundle:
                args = ["-c", f"http.sslCAInfo={ca_bundle}"] + args

        self._proc = QProcess(self)
        self._proc.setWorkingDirectory(self._project_path)
        self._proc.setProcessChannelMode(QProcess.SeparateChannels)
        self._proc.readyReadStandardOutput.connect(self._on_stdout)
        self._proc.readyReadStandardError.connect(self._on_stderr)
        self._proc.finished.connect(self._on_finished)

        # 注入关键环境变量，避免 git 因找不到 HOME/.gitconfig 而崩溃
        env = self._proc.processEnvironment()
        ensure_system_env(env)
        if "SSH_AUTH_SOCK" in os.environ and "SSH_AUTH_SOCK" not in env.keys():
            env.insert("SSH_AUTH_SOCK", os.environ["SSH_AUTH_SOCK"])
        # 禁止 git 弹出交互式认证窗口（否则 QProcess 无法处理会导致挂死）
        env.insert("GIT_TERMINAL_PROMPT", "0")

        if proxy_url is not None:
            for proxy_key in _PROXY_ENV_KEYS:
                env.remove(proxy_key)
            args = _git_proxy_args(proxy_url) + args

        self._proc.setProcessEnvironment(env)

        # 记录当前 fetch 代际，用于 _on_finished 忽略 stale callback
        self._started_fetch_gen = self._fetch_gen

        git_exe = self._resolve_git()
        self._proc.start(git_exe, args)

    def _resolve_git(self) -> str:
        """解析 git.exe 路径: 捆绑 Git > 系统 Git。"""
        from .service_runner import find_bundled_git
        bundled = find_bundled_git(self._project_path)
        if bundled:
            return bundled
        return _find_git()

    def _on_stdout(self):
        data = self._proc.readAllStandardOutput()
        text = _decode_output(data.data())
        if text.strip():
            self.output.emit(text.strip())

    def _on_stderr(self):
        data = self._proc.readAllStandardError()
        text = _decode_output(data.data())
        if text.strip():
            self._stderr_lines.append(text.strip())
            self.output.emit(text.strip())

    def _on_finished(self, exit_code, exit_status):
        # 忽略被 kill 的旧 QProcess 的 stale callback
        finished_gen = getattr(self, '_started_fetch_gen', 0)
        if self._pending_op in ("fetch", "init_repo") and finished_gen != self._fetch_gen:
            # 这是上一个 fetch 进程的回调，已被新 fetch kill，忽略
            return

        ok = exit_code == 0 and exit_status == QProcess.NormalExit

        # init_repo 是多步链式操作
        if self._pending_op == "init_repo" and ok:
            self._init_repo_step_idx += 1
            steps = getattr(self, '_init_repo_steps', [])
            if self._init_repo_step_idx < len(steps):
                # 继续下一步
                step_label = steps[self._init_repo_step_idx][1]
                self.output.emit(f"[init] {step_label}...")
                self._run_git(steps[self._init_repo_step_idx][0])
                return
            # 全部完成
            self._init_repo_steps = []

        # TLS 错误沿用当前代理，先重试 OpenSSL。
        if (not ok and exit_status == QProcess.NormalExit and self._current_git_args[0] == "fetch"
                and not self._ssl_backend_retried
                and _is_schannel_revocation_error(self._stderr_lines)):
            self._ssl_backend_retried = True
            self.output.emit("[tls] 检测到 Windows 证书吊销检查失败，自动切换 OpenSSL 后端重试...")
            self._run_git(self._current_git_args, ssl_backend="openssl")
            return

        if (not ok and exit_status == QProcess.NormalExit and self._using_auto_proxy
                and _is_proxy_connection_error(self._stderr_lines)):
            self._proxy_retried = True
            self.output.emit("[proxy] 自动代理不可用，本次改用直连...")
            self._run_git(self._current_git_args, ssl_backend="openssl" if self._ssl_backend_retried else "")
            return

        if ok:
            msg = "操作成功"
        else:
            stderr_tail = ""
            if self._stderr_lines:
                joined = "; ".join(self._stderr_lines[-3:])
                stderr_tail = f" | stderr: {joined}"

            # 区分失败场景给出小白也能看懂的提示
            hint = ""
            stderr_lower = stderr_tail.lower()
            if "empty reply from server" in stderr_lower:
                hint = " — 无法连接 GitHub（可能被网络拦截），请尝试开启 VPN"
            elif "could not resolve host" in stderr_lower:
                hint = " — 域名解析失败，请检查网络是否正常，或开启 VPN"
            elif "connection timed out" in stderr_lower:
                if self._proxy_retried:
                    hint = " — 直连超时，请关闭代理后重试"
                else:
                    hint = " — 连接超时，请检查网络或开启 VPN"
            elif "rpc failed" in stderr_lower or "connection was reset" in stderr_lower:
                if self._proxy_retried:
                    hint = " — 直连被断开（可能网络不稳定），请开启 VPN 后重试"
                else:
                    hint = " — 连接被断开（可能是网络干扰），请开启 VPN"
            # 证书/TLS 拦截类错误必须排在通用 "unable to access" 之前：
            # 所有 HTTPS 错误都含该字符串，放后面会导致专属提示永远匹配不到
            elif ("revocation check" in stderr_lower or "no_revocation_check" in stderr_lower
                  or "schannel" in stderr_lower):
                hint = (" — 加密连接被安全软件或网络设备扫描拦截，"
                        "请关闭杀毒软件的「加密连接扫描 / HTTPS 检查」功能后重试，"
                        "也可用手机热点对照测试")
            elif ("peer certificate" in stderr_lower or "remote key was not ok" in stderr_lower
                  or "ssl certificate" in stderr_lower or "certificate verify" in stderr_lower
                  or "unable to get local issuer certificate" in stderr_lower
                  or "self signed certificate" in stderr_lower):
                hint = (" — GitHub 安全证书校验未通过（网络中存在解密拦截设备，"
                        "常见于杀毒软件的 HTTPS 扫描），"
                        "请关闭相关扫描功能，或改用手机热点重试")
            elif "unable to access" in stderr_lower:
                if self._proxy_retried:
                    hint = " — 直连不上 GitHub，请检查网络或开启 VPN"
                else:
                    hint = " — 无法连接 GitHub，请检查网络或开启 VPN"
            elif "gnutls_handshake" in stderr_lower:
                hint = " — 连接方式不兼容，请将 Git 更新到最新版本"
            elif "the remote end hung up" in stderr_lower or "early eof" in stderr_lower or "transfer closed" in stderr_lower:
                hint = " — 网络不稳定导致下载中断，请尝试开启 VPN 后重试"
            elif "repository not found" in stderr_lower or "could not read from remote repository" in stderr_lower:
                hint = " — 远程仓库不存在或无访问权限，请联系开发者"
            elif "unable to create file" in stderr_lower or "filename too long" in stderr_lower:
                hint = " — 文件写入失败，请尝试用管理员身份运行启动器"
            elif "bad object" in stderr_lower or "object file is" in stderr_lower:
                hint = " — 本地数据异常，可能需要重新下载完整版本"
            elif "unable to update" in stderr_lower:
                hint = " — 文件被占用无法更新，请先关闭其他程序后重试"
            crash_hint = ""
            if exit_status != QProcess.NormalExit:
                crash_hint = "（程序意外崩溃）"
            msg = f"操作失败{crash_hint}: {stderr_tail}{hint}"
        self.operation_done.emit(self._pending_op, ok, msg)
        self._pending_op = ""


# ------------------------------------------------------------------
# Helper
# ------------------------------------------------------------------


def _decode_output(data: bytes) -> str:
    """Windows 兼容解码：UTF-8 → GBK → 替换模式。"""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return data.decode("gbk")
        except UnicodeDecodeError:
            return data.decode("utf-8", errors="replace")


def _version_greater(a: str, b: str) -> bool:
    """语义化版本比较。返回 a > b。

    例如: _version_greater("v1.0.22", "v1.0.21") → True
          _version_greater("v1.0.9", "v1.0.21")  → False

    预发布版本规则（避免给用户推送 rc/beta 更新提示）:
      a 为预发布、b 为正式版  → 永远不算更新（等正式版再推）
      a 为正式版、b 为预发布  → 数字相同也算更新（正式版覆盖同号 rc）
    """
    import re

    def parse(v: str):
        # 只取主版本号部分，避免 "-rc1" 等预发布后缀的数字污染比较
        core = v.split("-", 1)[0]
        nums = re.findall(r"\d+", core.lstrip("vV"))
        return tuple(int(n) for n in nums)

    def is_prerelease(v: str) -> bool:
        # v1.0.2-rc1 / v1.0.2-beta.1 等带连字符后缀的视为预发布
        return "-" in v

    try:
        pa = parse(a)
        pb = parse(b)
        if not pa or not pb:
            return a != b
        if pa != pb:
            if is_prerelease(a) and not is_prerelease(b):
                return False  # 预发布不作为正式更新推送
            return pa > pb
        # 数字部分相同：正式版 > 预发布
        return not is_prerelease(a) and is_prerelease(b)
    except Exception:
        return a != b


def _find_git() -> str:
    """查找 git.exe 的完整路径。QProcess 不像 subprocess 那样自动搜索 PATH。

    优先级: 捆绑 Git (runtime/git/) > PATH > 已知安装路径
    """
    import shutil

    # 0. 捆绑 Git（预构建 release）
    # 从调用栈推断 project_path —— 遍历 _project_path 属性
    # 但这里没有 project_path，所以检查常见相对路径
    # _find_git 被 GitManager 调用，GitManager 有 self._project_path
    # 我们改为在 GitManager 实例方法中处理

    # 1. shutil.which 搜索系统 PATH
    found = shutil.which("git")
    if found:
        return found

    # 2. Windows 已知安装路径
    for base in [
        os.path.expandvars(r"%ProgramFiles%\Git\bin"),
        os.path.expandvars(r"%ProgramFiles%\Git\cmd"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Git\bin"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Git\cmd"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\bin"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Git\cmd"),
    ]:
        candidate = os.path.join(base, "git.exe")
        if os.path.isfile(candidate):
            return candidate

    # 3. 兜底
    return "git"
