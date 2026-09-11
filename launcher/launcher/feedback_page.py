"""
问题反馈页 —— 用户只写「问题描述」，日志与环境信息由系统自动采集，
并给每条反馈打一个问题 ID。

为什么不做「一键直接上报到服务器」：
  客户端内置 GitHub token 等于把写入凭据公开分发给所有人；而自建接收服务
  又不该在没有服务端之前先写进客户端。所以这里的口径是：
    · 报告在本地生成（含问题 ID、脱敏后的日志），可保存成文件；
    · 「打开反馈页」用 GitHub 的 issue 预填链接，用户点一下就直接带着正文到提交页；
    · 正文过长时链接只带摘要，完整报告以附件文件为准。
"""
from __future__ import annotations

import os
from datetime import datetime

from PySide6.QtCore import Qt, Signal, QTimer, QUrl
from PySide6.QtGui import QDesktopServices, QFont
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkReply, QNetworkRequest
from PySide6.QtWidgets import (
    QCheckBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from . import logbus
from .feedback_report import (
    DEFAULT_LOG_LINES,
    build_submit_url,
    build_report_text,
    collect_environment,
    new_issue_id,
    save_report,
    template_carries_body,
)

_HINT = (
    "日志与环境信息由系统自动采集，你只需要描述遇到的问题。"
    "报告在本地生成，提交前会自动把 API Key、Token、用户名路径打码。"
)


class FeedbackPage(QWidget):
    """问题反馈页面。"""

    report_saved = Signal(str)          # 保存成功后的文件路径
    issue_page_opened = Signal(str)     # 打开的反馈页 URL
    channel_saved = Signal(str)         # 备用反馈渠道

    # 探测超时：GitHub 在国内常见的是"连不上但也不立刻报错"，卡太久不如早点告诉用户
    PROBE_TIMEOUT_MS = 3000

    def __init__(self, project_path: str, parent=None):
        super().__init__(parent)
        self._project_path = project_path
        self._context_provider = None
        self._issue_id = new_issue_id()
        self._report_text = ""
        self._issue_template = ""
        self._net = QNetworkAccessManager(self)
        # 便于单测替换掉真实网络探测
        self._probe_override = None
        self._setup_ui()
        self.refresh_preview()

    # ------------------------------------------------------------------
    # 对外
    # ------------------------------------------------------------------

    def set_project_path(self, path: str):
        self._project_path = path

    def set_context_provider(self, provider):
        """provider() -> dict，字段见 collect_environment 的参数。

        用回调而不是一次性传值，是为了让「当前版本 / 服务状态」在用户点开页面时
        取到最新值，而不是启动时的快照。
        """
        self._context_provider = provider
        self.refresh_preview()

    # ------------------------------------------------------------------
    # UI
    # ------------------------------------------------------------------

    def _setup_ui(self):
        self.setStyleSheet("background: #F7F3F0;")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(20, 44, 20, 16)
        layout.setSpacing(8)

        header = QHBoxLayout()
        title = QLabel("问题反馈")
        title.setStyleSheet("color: #2E2A27; font-size: 18px; font-weight: bold;")
        header.addWidget(title)
        header.addStretch()

        self._issue_label = QLabel()
        self._issue_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self._issue_label.setStyleSheet(
            "color: #E07B6C; font-size: 13px; font-weight: bold;"
            "background: #FCEDE9; border-radius: 6px; padding: 4px 10px;"
        )
        header.addWidget(self._issue_label)
        layout.addLayout(header)

        self._update_issue_label()

        hint = QLabel(_HINT)
        hint.setWordWrap(True)
        hint.setStyleSheet("color: #756B65; font-size: 12px; line-height: 1.6;")
        layout.addWidget(hint)

        # --- 问题描述 ---
        desc_label = QLabel("问题描述（必填）")
        desc_label.setStyleSheet("color: #2E2A27; font-size: 13px; font-weight: 600;")
        layout.addWidget(desc_label)

        self.description_edit = QPlainTextEdit()
        self.description_edit.setPlaceholderText(
            "例如：群聊里角色回复半天不出来，刷新后一下子全冒出来；"
            "私聊会提示「请求超时，请重试」。\n"
            "尽量写清楚：在哪个页面、点了什么、期望什么、实际发生什么。"
        )
        self.description_edit.setFixedHeight(96)
        self.description_edit.setStyleSheet(_editor_style())
        self.description_edit.textChanged.connect(self._on_description_changed)
        layout.addWidget(self.description_edit)

        # --- 预览 ---
        preview_row = QHBoxLayout()
        preview_label = QLabel("将提交的内容（系统自动生成）")
        preview_label.setStyleSheet("color: #2E2A27; font-size: 13px; font-weight: 600;")
        preview_row.addWidget(preview_label)
        preview_row.addStretch()

        self.include_log_check = QCheckBox(f"附带最近 {DEFAULT_LOG_LINES} 行日志")
        self.include_log_check.setChecked(True)
        self.include_log_check.setStyleSheet("color: #756B65; font-size: 12px;")
        self.include_log_check.stateChanged.connect(lambda _=0: self.refresh_preview())
        preview_row.addWidget(self.include_log_check)

        self.refresh_btn = QPushButton("刷新预览")
        self.refresh_btn.setStyleSheet(_small_btn_style())
        self.refresh_btn.clicked.connect(self.refresh_preview)
        preview_row.addWidget(self.refresh_btn)
        layout.addLayout(preview_row)

        self.preview_edit = QPlainTextEdit()
        self.preview_edit.setReadOnly(True)
        font = QFont("Consolas", 9)
        font.setStyleHint(QFont.Monospace)
        self.preview_edit.setFont(font)
        self.preview_edit.setStyleSheet(_editor_style())
        layout.addWidget(self.preview_edit, stretch=1)

        # --- 状态 + 操作 ---
        self._status_label = QLabel("")
        self._status_label.setWordWrap(True)
        self._status_label.setStyleSheet("color: #4A9B4A; font-size: 12px;")
        layout.addWidget(self._status_label)

        actions = QHBoxLayout()

        self.copy_btn = QPushButton("复制到剪贴板")
        self.copy_btn.setStyleSheet(_btn_style())
        self.copy_btn.clicked.connect(self._on_copy)
        actions.addWidget(self.copy_btn)

        self.save_btn = QPushButton("保存为文件")
        self.save_btn.setStyleSheet(_btn_style())
        self.save_btn.clicked.connect(self._on_save)
        actions.addWidget(self.save_btn)

        self.folder_btn = QPushButton("打开反馈文件夹")
        self.folder_btn.setStyleSheet(_btn_style())
        self.folder_btn.clicked.connect(self._on_open_folder)
        actions.addWidget(self.folder_btn)

        actions.addStretch()

        self.submit_btn = QPushButton("提交反馈")
        self.submit_btn.setStyleSheet(_primary_btn_style())
        self.submit_btn.clicked.connect(self._on_submit)
        actions.addWidget(self.submit_btn)

        layout.addLayout(actions)

        # --- 备用反馈渠道 ---
        # 默认的反馈页是 GitHub，国内常常直连不上；这里可以指到 QQ 群 / 问卷 / B站视频页，
        # 提交时会先探测一次可达性，连不上就自动改开这个渠道，并把报告放进剪贴板。
        channel_row = QHBoxLayout()
        channel_label = QLabel("备用渠道")
        channel_label.setStyleSheet("color: #756B65; font-size: 11px;")
        channel_row.addWidget(channel_label)

        self.channel_edit = QLineEdit()
        self.channel_edit.setPlaceholderText(
            "打不开 GitHub 时改用的链接（QQ 群 / 问卷 / B站视频页，可留空）"
        )
        self.channel_edit.setStyleSheet(_input_style())
        channel_row.addWidget(self.channel_edit, stretch=1)

        self.channel_save_btn = QPushButton("保存")
        self.channel_save_btn.setStyleSheet(_small_btn_style())
        self.channel_save_btn.clicked.connect(
            lambda: self.channel_saved.emit(self.channel_edit.text().strip())
        )
        channel_row.addWidget(self.channel_save_btn)
        layout.addLayout(channel_row)

    # ------------------------------------------------------------------
    # 报告生成
    # ------------------------------------------------------------------

    def _update_issue_label(self):
        self._issue_label.setText(f"问题ID：{self._issue_id}")

    def refresh_preview(self):
        """重新采集环境与日志并刷新预览。"""
        context = {}
        if self._context_provider is not None:
            try:
                context = self._context_provider() or {}
            except Exception:  # noqa: BLE001 - 采集失败不该让页面报错
                context = {}

        environment = collect_environment(
            launcher_version=context.get("launcher_version", ""),
            current_tag=context.get("current_tag", ""),
            remote_tag=context.get("remote_tag", ""),
            project_path=context.get("project_path", self._project_path),
            repo_url=context.get("repo_url", ""),
            services=context.get("services") or {},
            extra=context.get("extra") or {},
        )
        log_lines = logbus.snapshot(DEFAULT_LOG_LINES) if self.include_log_check.isChecked() else []

        self._report_text = build_report_text(
            issue_id=self._issue_id,
            description=self.description_edit.toPlainText(),
            environment=environment,
            log_lines=log_lines,
        )
        self.preview_edit.setPlainText(self._report_text)
        if log_lines:
            self._set_status(f"已采集最近的 {len(log_lines)} 行日志", ok=True)

    def _on_description_changed(self):
        # 描述改动后同步进报告，避免用户复制到的是旧正文
        if self._report_text:
            self.refresh_preview()

    def _set_status(self, text: str, *, ok: bool = True):
        self._status_label.setText(text)
        self._status_label.setStyleSheet(
            f"color: {'#4A9B4A' if ok else '#D9434A'}; font-size: 12px;"
        )

    # ------------------------------------------------------------------
    # 操作
    # ------------------------------------------------------------------

    def _require_description(self) -> bool:
        text = self.description_edit.toPlainText().strip()
        if not text:
            self._set_status("请先填写问题描述（日志无需你填写）", ok=False)
            self.description_edit.setFocus()
            return False
        return True

    def _on_copy(self):
        if not self._require_description():
            return
        self.refresh_preview()
        from PySide6.QtWidgets import QApplication

        QApplication.clipboard().setText(self._report_text)
        self._set_status("已复制完整报告（含问题ID），可直接粘贴到任意反馈渠道")

    def _on_save(self):
        if not self._require_description():
            return
        self.refresh_preview()
        try:
            path = save_report(self._project_path, self._issue_id, self._report_text)
        except OSError as exc:
            self._set_status(f"保存失败：{exc}", ok=False)
            return
        self._set_status(f"已保存：{path}")
        self.report_saved.emit(path)

    def _on_open_folder(self):
        folder = os.path.join(self._project_path, "feedback")
        try:
            os.makedirs(folder, exist_ok=True)
        except OSError as exc:
            self._set_status(f"无法创建反馈文件夹：{exc}", ok=False)
            return
        QDesktopServices.openUrl(QUrl.fromLocalFile(folder))

    # ------------------------------------------------------------------
    # 提交：先备齐 → 再试网页 → 试不通走备用渠道
    # ------------------------------------------------------------------

    def set_issue_template(self, template: str):
        self._issue_template = (template or "").strip()

    def set_channel(self, url: str):
        self.channel_edit.setText(url or "")

    def channel(self) -> str:
        return self.channel_edit.text().strip()

    def set_probe_override(self, probe):
        """测试用：替换真实网络探测（``callable(url) -> bool``）。"""
        self._probe_override = probe

    def _prepare_payload(self) -> str:
        """先把报告落盘并复制到剪贴板。

        顺序很关键：默认反馈页是 GitHub，国内常常直连不上。无论后面网页能否打开，
        用户手里都必须已经有一份完整报告能直接粘贴，否则一点"提交"就卡死在死链接上。
        """
        from PySide6.QtWidgets import QApplication

        QApplication.clipboard().setText(self._report_text)
        try:
            path = save_report(self._project_path, self._issue_id, self._report_text)
            self.report_saved.emit(path)
            return path
        except OSError:
            return ""

    def _submit_url(self) -> str:
        context = {}
        if self._context_provider is not None:
            try:
                context = self._context_provider() or {}
            except Exception:  # noqa: BLE001
                context = {}
        return build_submit_url(
            self._issue_template,
            repo_url=context.get("repo_url", ""),
            issue_id=self._issue_id,
            description=self.description_edit.toPlainText(),
            report=self._report_text,
        )

    def _on_submit(self):
        if not self._require_description():
            return
        self.refresh_preview()
        saved_path = self._prepare_payload()

        url = self._submit_url()
        if not url:
            self._set_status(
                "没有可用的反馈地址；报告已复制到剪贴板，"
                f"请粘贴到任意反馈渠道（问题ID {self._issue_id}）",
                ok=False,
            )
            return

        self._set_status("报告已复制到剪贴板，正在检查反馈页能否打开…")
        self.submit_btn.setEnabled(False)
        self._probe(url, lambda reachable: self._finish_submit(reachable, url, saved_path))

    def _probe(self, url: str, callback):
        """探测反馈站点是否可达。只对 host 发 HEAD，不拉整个页面。"""
        if self._probe_override is not None:
            callback(bool(self._probe_override(url)))
            return

        target = QUrl(url)
        if not target.host():
            callback(False)
            return
        request = QNetworkRequest(QUrl(f"{target.scheme()}://{target.host()}/"))
        request.setAttribute(
            QNetworkRequest.Attribute.RedirectPolicyAttribute,
            QNetworkRequest.RedirectPolicy.NoLessSafeRedirectPolicy,
        )
        reply = self._net.head(request)
        settled = {"done": False}

        def finish(reachable: bool):
            if settled["done"]:
                return
            settled["done"] = True
            reply.deleteLater()
            callback(reachable)

        def on_timeout():
            reply.abort()
            finish(False)

        reply.finished.connect(
            lambda: finish(reply.error() == QNetworkReply.NetworkError.NoError)
        )
        QTimer.singleShot(self.PROBE_TIMEOUT_MS, on_timeout)

    def _finish_submit(self, reachable: bool, url: str, saved_path: str):
        self.submit_btn.setEnabled(True)
        channel = self.channel()

        if reachable:
            QDesktopServices.openUrl(QUrl(url))
            self.issue_page_opened.emit(url)
            tail = f"，同时已存到 {saved_path}" if saved_path else ""
            hint = "" if template_carries_body(self._issue_template) else \
                "（该渠道不会自动带正文，打开后按 Ctrl+V 粘贴）"
            self._set_status(
                f"已打开反馈页，问题ID {self._issue_id} 已写进标题{hint}{tail}", ok=True
            )
            return

        # 连不上：不打开死链接，改用备用渠道；报告早已在剪贴板里
        note = f"报告已复制到剪贴板，粘贴提交即可（问题ID {self._issue_id}）"
        if channel:
            QDesktopServices.openUrl(QUrl(channel))
            self._set_status(
                f"反馈页连不上（可能需要科学上网），已改用备用渠道；{note}", ok=False
            )
        else:
            self._set_status(
                f"反馈页连不上（可能需要科学上网），且未配置备用渠道；{note}", ok=False
            )

    def new_report(self):
        """开一条新反馈：换问题 ID 并清空描述。"""
        self._issue_id = new_issue_id()
        self._update_issue_label()
        self.description_edit.clear()
        self._set_status("")
        self.refresh_preview()


# ----------------------------------------------------------------------
# 与启动器其它页面一致的样式
# ----------------------------------------------------------------------


def _editor_style() -> str:
    return """
        QPlainTextEdit {
            background: #FCFAF8;
            color: #2E2A27;
            border: 1px solid #E5D9D2;
            border-radius: 6px;
            padding: 8px;
            selection-background-color: #F7D7D1;
            selection-color: #2E2A27;
        }
    """


def _btn_style() -> str:
    return """
        QPushButton {
            background: #E5D9D2; color: #756B65; font-size: 12px;
            padding: 8px 16px; border-radius: 6px; border: none;
        }
        QPushButton:hover { background: #DDD0C8; color: #2E2A27; }
        QPushButton:disabled { background: #F1ECE8; color: #C9C0BB; }
    """


def _small_btn_style() -> str:
    return """
        QPushButton {
            background: #E5D9D2; color: #756B65; font-size: 11px;
            padding: 4px 10px; border-radius: 5px; border: none;
        }
        QPushButton:hover { background: #DDD0C8; color: #2E2A27; }
    """


def _input_style() -> str:
    return """
        QLineEdit {
            background: #FCFAF8; color: #2E2A27;
            border: 1px solid #E5D9D2; border-radius: 5px;
            padding: 4px 8px; font-size: 11px;
        }
        QLineEdit:focus { border-color: #E07B6C; }
    """


def _primary_btn_style() -> str:
    return """
        QPushButton {
            background: #E07B6C; color: #FCFAF8; font-size: 12px;
            padding: 8px 18px; border-radius: 6px; border: none;
        }
        QPushButton:hover { background: #D96D5D; }
        QPushButton:pressed { background: #C95F4F; }
        QPushButton:disabled { background: #E5D9D2; color: #C9C0BB; }
    """
