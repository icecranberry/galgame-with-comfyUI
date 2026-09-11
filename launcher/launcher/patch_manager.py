"""
增量补丁 —— 在线清单 / 下载 / 校验 / 应用 / 回滚。

为什么不用「每次重新 git pull 整包」：
  1. 现场网络差，整包反复下载失败率高，用户反复重试；
  2. 每次都要走 GitHub，速度不受控；清单与补丁可以放到任意静态源
     （对象存储 / 自建站 / 内网镜像），只要改 ``patch_base_url`` 即可。

补丁是 tar.gz（Python 与 Node 双方标准库都能读写，不引入任何第三方依赖），
结构固定：

    patch.json          # 元信息：id / from / to / files[{path,sha256,size}] / deleted[]
    files/<相对路径>    # 变更后文件的完整内容

安全约束：解包时拒绝绝对路径、``..`` 穿越、符号链接与硬链接；并且一定会先解到
临时目录、逐个校验 sha256 之后再落到项目里，失败自动回滚。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tarfile
import tempfile
from urllib.parse import urljoin

from PySide6.QtCore import QObject, QUrl, Signal
from PySide6.QtNetwork import (
    QNetworkAccessManager,
    QNetworkProxy,
    QNetworkReply,
    QNetworkRequest,
)

# 补丁包与备份都放在项目根下的隐藏目录：不污染 git status（已在 .gitignore 中）
CACHE_DIR_NAME = ".patch-cache"
BACKUP_DIR_NAME = ".patch-backup"
MANIFEST_NAME = "index.json"

_SCHEMA = 1


class PatchError(Exception):
    """补丁相关的可预期失败（网络、校验、格式、应用），消息可直接给用户看。"""


def sanitize_id(patch_id: str) -> str:
    """补丁 ID 会被用作目录名，剔除一切路径相关字符。"""
    keep = [ch for ch in str(patch_id) if ch.isalnum() or ch in "._-"]
    return "".join(keep) or "patch"


# 静态 raw 地址模板：把「代码仓库」直接当「补丁源」，不必再找托管。
# 约定补丁放在同名仓库的 patches 分支根目录（二进制文件不污染主分支历史）。
_RAW_TEMPLATES = {
    "github.com": "https://raw.githubusercontent.com/{owner}/{repo}/patches/",
    "gitee.com": "https://gitee.com/{owner}/{repo}/raw/patches/",
}


def derive_patch_base(repo_url: str) -> str:
    """由更新源推导默认补丁源；认不出的托管返回空（让用户手填）。

    本地程序无法被推送，只能主动去某个固定落点拉清单——而"代码仓库"本来就是
    它必须能访问的那个落点。所以默认把 patches 分支当补丁源：零新增基础设施，
    可达性与既有的版本更新完全一致。
    """
    match = re.search(r"([\w.-]+)[:/]+([^/\s]+)/([^/\s]+?)(?:\.git)?/?$", repo_url or "")
    if not match:
        return ""
    host, owner, repo = match.group(1).lower(), match.group(2), match.group(3)
    for suffix, template in _RAW_TEMPLATES.items():
        if host.endswith(suffix):
            return template.format(owner=owner, repo=repo)
    return ""


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_unsafe_member(name: str) -> bool:
    """判断 tar 成员名是否有路径穿越风险。"""
    if not name or name.startswith(("/", "\\")):
        return True
    if len(name) > 1 and name[1] == ":":  # C:\...
        return True
    parts = name.replace("\\", "/").split("/")
    return any(part == ".." for part in parts)


class PatchManager(QObject):
    """补丁清单拉取、下载、校验、应用。所有网络动作走 Qt 事件循环，不阻塞 UI。"""

    manifest_ready = Signal(dict)
    manifest_failed = Signal(str)
    download_progress = Signal(int, int)   # received, total
    download_done = Signal(str, dict)      # local_path, patch_entry
    apply_done = Signal(str)               # 人类可读的结果摘要
    rollback_done = Signal(str)
    failed = Signal(str)
    status = Signal(str)

    def __init__(self, project_path: str, base_url: str = "", parent=None):
        super().__init__(parent)
        self._project_path = project_path
        self._base_url = self.normalize_base(base_url)
        self._manager = QNetworkAccessManager(self)
        self._reply: QNetworkReply | None = None
        self._current: dict | None = None
        self._dest_path = ""
        # 直连失败后是否已经尝试过本地代理（只重试一次，避免反复探测）
        self._proxy_tried = False

    # ------------------------------------------------------------------
    # 配置
    # ------------------------------------------------------------------

    @property
    def base_url(self) -> str:
        return self._base_url

    @staticmethod
    def normalize_base(raw: str) -> str:
        """把用户填的补丁源规整成可用的基址。

        补丁源本质上只是「一个能取到 index.json 的静态目录」，所以三种写法都收：
          · HTTP(S) 目录   —— 对象存储 / 自建站 / Gitee raw / GitHub raw 都可以；
          · 本地或共享目录 —— 本机文件夹、U 盘、``\\\\服务器\\共享`` 都行，
                             自动转成 file:// （QNetworkAccessManager 原生支持 file 协议）；
          · 留空           —— 关闭在线检查（仍可用「导入补丁包…」离线应用）。
        """
        text = (raw or "").strip()
        if not text:
            return ""
        if text.startswith(("http://", "https://", "file://")):
            return text.rstrip("/") + "/"
        if re.match(r"^[A-Za-z]:[\\/]", text) or text.startswith("\\\\") or text.startswith("/"):
            return QUrl.fromLocalFile(text.rstrip("\\/")).toString().rstrip("/") + "/"
        return text.rstrip("/") + "/"

    def set_base_url(self, base_url: str):
        self._base_url = self.normalize_base(base_url)

    def set_project_path(self, path: str):
        self._project_path = path

    def _retry_with_local_proxy(self) -> bool:
        """直连失败时，复用 git 更新那套本地代理探测（只重试一次）。

        这一点很关键：git_manager 在 fetch 时会自动探测本地代理端口（Clash 之类），
        但 Qt 网络只认系统代理。如果不补这一步，就会出现"版本能更新、补丁下不动"
        这种看起来毫无道理的现象 —— 明明同一个网络同一个仓库。
        """
        if self._proxy_tried:
            return False
        self._proxy_tried = True
        try:
            from .git_manager import _find_local_proxy
            port = _find_local_proxy()
        except Exception:  # noqa: BLE001 - 探测失败就当没代理
            return False
        if not port:
            return False
        self._manager.setProxy(
            QNetworkProxy(QNetworkProxy.ProxyType.HttpProxy, "127.0.0.1", int(port))
        )
        self.status.emit(f"直连失败，已自动改用本地代理 127.0.0.1:{port}")
        return True

    def is_busy(self) -> bool:
        return self._reply is not None

    def cancel(self):
        if self._reply is not None:
            self._reply.abort()

    # ------------------------------------------------------------------
    # 清单
    # ------------------------------------------------------------------

    def manifest_url(self) -> str:
        return urljoin(self._base_url, MANIFEST_NAME) if self._base_url else ""

    def fetch_manifest(self):
        """拉取 ``<base>/index.json``。"""
        if self.is_busy():
            return
        if not self._base_url:
            self.manifest_failed.emit("未配置补丁源地址（设置 → 补丁源）")
            return

        self.status.emit("正在获取补丁清单…")
        self._reply = self._get(self.manifest_url())
        self._reply.finished.connect(self._on_manifest_finished)

    def _on_manifest_finished(self):
        reply, self._reply = self._reply, None
        if reply is None:
            return
        try:
            if reply.error() != QNetworkReply.NetworkError.NoError:
                if reply.error() == QNetworkReply.NetworkError.OperationCanceledError:
                    self.manifest_failed.emit("已取消")
                    return
                if self._retry_with_local_proxy():
                    self.fetch_manifest()
                    return
                self.manifest_failed.emit(self._network_error_text(reply))
                return
            raw = bytes(reply.readAll().data())
        finally:
            reply.deleteLater()

        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self.manifest_failed.emit(f"补丁清单格式不正确：{exc}")
            return

        patches = data.get("patches")
        if not isinstance(patches, list):
            self.manifest_failed.emit("补丁清单缺少 patches 数组")
            return

        self.status.emit(f"清单已就绪（{len(patches)} 个补丁）")
        self.manifest_ready.emit(data)

    # ------------------------------------------------------------------
    # 下载
    # ------------------------------------------------------------------

    def download_patch(self, patch: dict):
        """下载并校验单个补丁包。"""
        if self.is_busy():
            return
        rel = str(patch.get("file") or patch.get("url") or "").strip()
        if not rel:
            self.failed.emit("补丁条目缺少 file 字段")
            return

        url = urljoin(self._base_url, rel)
        patch_id = sanitize_id(patch.get("id") or os.path.basename(rel))
        cache_dir = os.path.join(self._project_path, CACHE_DIR_NAME)
        os.makedirs(cache_dir, exist_ok=True)
        self._dest_path = os.path.join(cache_dir, f"{patch_id}.tar.gz.part")
        self._current = patch

        self.status.emit(f"正在下载补丁 {patch.get('id') or rel} …")
        self._reply = self._get(url)
        self._reply.downloadProgress.connect(self._on_download_progress)
        self._reply.finished.connect(self._on_download_finished)

    def _on_download_progress(self, received: int, total: int):
        self.download_progress.emit(received, total)

    def _on_download_finished(self):
        reply, self._reply = self._reply, None
        patch, self._current = self._current, None
        if reply is None:
            return
        try:
            if reply.error() != QNetworkReply.NetworkError.NoError:
                self._cleanup_partial()
                if reply.error() == QNetworkReply.NetworkError.OperationCanceledError:
                    self.failed.emit("已取消")
                    return
                if patch and self._retry_with_local_proxy():
                    self.download_patch(patch)
                    return
                self.failed.emit(self._network_error_text(reply))
                return
            data = bytes(reply.readAll().data())
        finally:
            reply.deleteLater()

        expected = str((patch or {}).get("sha256") or "").strip().lower()
        with open(self._dest_path, "wb") as handle:
            handle.write(data)

        actual = sha256_file(self._dest_path)
        if expected and actual != expected:
            self._cleanup_partial()
            self.failed.emit(
                f"补丁校验失败：期望 {expected[:12]}…，实际 {actual[:12]}…（下载可能被截断，请重试）"
            )
            return

        final_path = self._dest_path[: -len(".part")]
        os.replace(self._dest_path, final_path)
        self.status.emit("下载完成，校验通过")
        self.download_done.emit(final_path, patch or {})

    def _cleanup_partial(self):
        try:
            if self._dest_path and os.path.exists(self._dest_path):
                os.remove(self._dest_path)
        except OSError:
            pass

    # ------------------------------------------------------------------
    # 应用
    # ------------------------------------------------------------------

    @staticmethod
    def read_meta(tar_path: str) -> dict:
        """只读补丁包里的 patch.json。

        给「导入本地补丁包…」用：先拿到 from/to 与说明，才能做版本校验与确认弹窗，
        而不是先解包落到磁盘上再后悔。
        """
        try:
            with tarfile.open(tar_path, "r:gz") as tar:
                member = tar.getmember("patch.json")
                handle = tar.extractfile(member)
                if handle is None:
                    raise PatchError("补丁包缺少 patch.json")
                return json.loads(handle.read().decode("utf-8"))
        except PatchError:
            raise
        except (tarfile.TarError, OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PatchError(f"不是有效的补丁包：{exc}") from exc

    def apply_patch(self, tar_path: str, *, expected_from: list[str] | None = None,
                    current_version: str = ""):
        """把补丁落到项目目录。成功返回摘要字符串，失败抛 PatchError（已自动回滚）。"""
        if not os.path.isfile(tar_path):
            raise PatchError("补丁文件不存在，请重新下载")

        with tempfile.TemporaryDirectory(prefix="linshe-patch-") as tmp:
            meta = self._extract_to(tar_path, tmp)
            self._validate_meta(meta, expected_from=expected_from, current_version=current_version)
            return self._install(tmp, meta)

    def _extract_to(self, tar_path: str, dest: str) -> dict:
        """安全解包到独立目录，返回 patch.json 内容。"""
        try:
            with tarfile.open(tar_path, "r:gz") as tar:
                for member in tar.getmembers():
                    if _is_unsafe_member(member.name):
                        raise PatchError(f"补丁包含不安全的路径：{member.name}")
                    if member.issym() or member.islnk():
                        raise PatchError(f"补丁包含链接文件（不允许）：{member.name}")
                tar.extractall(dest)
        except PatchError:
            raise
        except (tarfile.TarError, OSError) as exc:
            raise PatchError(f"补丁解包失败：{exc}") from exc

        meta_path = os.path.join(dest, "patch.json")
        if not os.path.isfile(meta_path):
            raise PatchError("补丁包缺少 patch.json")
        try:
            with open(meta_path, "r", encoding="utf-8") as handle:
                meta = json.load(handle)
        except (OSError, json.JSONDecodeError) as exc:
            raise PatchError(f"patch.json 解析失败：{exc}") from exc
        if int(meta.get("schema", 0)) != _SCHEMA:
            raise PatchError(f"补丁格式版本不支持：schema={meta.get('schema')}")
        return meta

    def _validate_meta(self, meta: dict, *, expected_from: list[str] | None,
                       current_version: str):
        files = meta.get("files")
        if not isinstance(files, list) or not files:
            raise PatchError("补丁不包含任何文件")

        if expected_from and current_version:
            normalized = {v.lstrip("v") for v in expected_from}
            if current_version.lstrip("v") not in normalized:
                raise PatchError(
                    f"当前版本 {current_version} 不在该补丁的适用范围内"
                    f"（适用：{'、'.join(expected_from)}），请改用手动切换版本"
                )

    def _install(self, staging: str, meta: dict) -> str:
        patch_id = sanitize_id(meta.get("id") or "patch")
        project = self._project_path
        backup_root = os.path.join(project, BACKUP_DIR_NAME, patch_id)
        files_root = os.path.join(staging, "files")

        # 先全部校验，再动项目目录上的任何文件
        staged: list[tuple[str, str]] = []
        for item in meta["files"]:
            rel = str(item.get("path") or "").replace("\\", "/")
            if not rel or _is_unsafe_member(rel):
                raise PatchError(f"补丁条目路径非法：{rel}")
            source = os.path.join(files_root, *rel.split("/"))
            if not os.path.isfile(source):
                raise PatchError(f"补丁缺少文件内容：{rel}")
            expected = str(item.get("sha256") or "").lower()
            if expected and sha256_file(source) != expected:
                raise PatchError(f"补丁内文件校验失败：{rel}")
            staged.append((rel, source))

        deleted = [str(p).replace("\\", "/") for p in (meta.get("deleted") or [])]
        for rel in deleted:
            if not rel or _is_unsafe_member(rel):
                raise PatchError(f"补丁删除条目路径非法：{rel}")

        journal: list[dict] = []
        try:
            os.makedirs(backup_root, exist_ok=True)
            for rel, source in staged:
                target = os.path.join(project, *rel.split("/"))
                existed = os.path.exists(target)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                journal.append(self._backup(project, backup_root, rel,
                                            action="update" if existed else "add"))
                shutil.copy2(source, target)

            for rel in deleted:
                target = os.path.join(project, *rel.split("/"))
                if not os.path.exists(target):
                    continue
                journal.append(self._backup(project, backup_root, rel, action="delete"))
                os.remove(target)

        except (OSError, PatchError) as exc:
            self._restore(backup_root, journal)
            raise PatchError(f"应用补丁失败，已回滚：{exc}") from exc

        with open(os.path.join(backup_root, "applied.json"), "w", encoding="utf-8") as handle:
            json.dump({"id": patch_id, "to": meta.get("to"), "journal": journal}, handle,
                      ensure_ascii=False, indent=2)

        added = sum(1 for entry in journal if entry.get("action") == "add")
        removed = sum(1 for entry in journal if entry.get("action") == "delete")
        summary = [f"更新 {len(staged) - added} 个文件"]
        if added:
            summary.append(f"新增 {added} 个")
        if removed:
            summary.append(f"删除 {removed} 个")
        return (f"已应用补丁 {patch_id}：" + "，".join(summary)
                + "。请到「版本」页强制重新构建后生效。")

    def _backup(self, project: str, backup_root: str, rel: str, *, action: str) -> dict:
        """把将被覆盖/删除的文件存进备份目录（``add`` 无需备份）。"""
        entry = {"path": rel, "action": action}
        if action == "add":
            return entry
        source = os.path.join(project, *rel.split("/"))
        dest = os.path.join(backup_root, "files", *rel.split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(source, dest)
        return entry

    def _restore(self, backup_root: str, journal: list[dict]):
        """按日志把项目目录恢复到打补丁之前（add 的删掉，其余从备份还原）。"""
        for entry in reversed(journal):
            rel = str(entry.get("path") or "")
            if not rel or _is_unsafe_member(rel):
                continue
            target = os.path.join(self._project_path, *rel.split("/"))
            try:
                if entry.get("action") == "add":
                    if os.path.exists(target):
                        os.remove(target)
                else:
                    backup = os.path.join(backup_root, "files", *rel.split("/"))
                    if os.path.isfile(backup):
                        os.makedirs(os.path.dirname(target), exist_ok=True)
                        shutil.copy2(backup, target)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # 回滚
    # ------------------------------------------------------------------

    def list_backups(self) -> list[str]:
        root = os.path.join(self._project_path, BACKUP_DIR_NAME)
        if not os.path.isdir(root):
            return []
        return sorted(
            name for name in os.listdir(root)
            if os.path.isfile(os.path.join(root, name, "applied.json"))
        )

    def rollback(self, patch_id: str) -> str:
        """用备份目录还原某个补丁。"""
        patch_id = sanitize_id(patch_id)
        backup_root = os.path.join(self._project_path, BACKUP_DIR_NAME, patch_id)
        journal_path = os.path.join(backup_root, "applied.json")
        if not os.path.isfile(journal_path):
            raise PatchError(f"找不到补丁 {patch_id} 的备份，无法回滚")
        with open(journal_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)

        for entry in reversed(data.get("journal") or []):
            rel = str(entry.get("path") or "")
            if not rel or _is_unsafe_member(rel):
                continue
            target = os.path.join(self._project_path, *rel.split("/"))
            # 与 _restore 同一套语义：add 的删掉，update/delete 的从备份还原。
            # （曾经这里读的是另一个字段名，结果回滚变成了"把文件删掉"，务必保持一致）
            action = entry.get("action") or ("update" if entry.get("existed") else "add")
            try:
                if action == "add":
                    if os.path.exists(target):
                        os.remove(target)
                else:
                    source = os.path.join(backup_root, "files", *rel.split("/"))
                    if os.path.isfile(source):
                        os.makedirs(os.path.dirname(target), exist_ok=True)
                        shutil.copy2(source, target)
            except OSError as exc:
                raise PatchError(f"回滚 {rel} 失败：{exc}") from exc

        shutil.rmtree(backup_root, ignore_errors=True)
        return f"已回滚补丁 {patch_id}，请重新构建后生效。"

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    def _get(self, url: str) -> QNetworkReply:
        request = QNetworkRequest(QUrl(url))
        request.setAttribute(
            QNetworkRequest.Attribute.RedirectPolicyAttribute,
            QNetworkRequest.RedirectPolicy.NoLessSafeRedirectPolicy,
        )
        request.setHeader(QNetworkRequest.KnownHeaders.UserAgentHeader, "LinsheLauncher-Patch/1.0")
        # 补丁源常在对象存储上，缓存会拿到过期清单
        request.setAttribute(
            QNetworkRequest.Attribute.CacheLoadControlAttribute,
            QNetworkRequest.CacheLoadControl.AlwaysNetwork,
        )
        return self._manager.get(request)

    @staticmethod
    def _network_error_text(reply: QNetworkReply) -> str:
        code = reply.error()
        if code == QNetworkReply.NetworkError.ContentNotFoundError:
            return "补丁源返回 404：地址或文件不存在（检查设置里的补丁源）"
        if code == QNetworkReply.NetworkError.OperationCanceledError:
            return "已取消"
        return f"网络请求失败：{reply.errorString()}"
