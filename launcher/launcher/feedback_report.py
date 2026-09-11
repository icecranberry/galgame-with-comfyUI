"""
问题反馈 —— 报告生成（纯逻辑，不依赖 PySide6，便于单独测试）。

设计要点：
1. 日志由系统采集（logbus + 环境探测），用户只填"问题描述"，不要求粘贴日志；
2. 每条反馈带一个问题 ID（``LS-YYYYMMDD-XXXXXX``），由本地生成，无需服务端；
3. 提交前统一脱敏：API Key / Token / Authorization 头 / 用户名路径一律打码，
   避免用户把自己花钱买的密钥贴到公开 issue 里。
"""
from __future__ import annotations

import os
import re
import secrets
from datetime import datetime, timezone, timedelta

# GitHub issue 预填链接（默认模板）。带 {body} 的模板能把整份报告塞进 URL，
# 但这依赖目标站点能直连——国内访问 GitHub 经常不通，所以调用方必须先落盘+复制，
# 再尝试打开；打不开就走备用渠道，用户手里始终有完整报告可粘贴。
DEFAULT_ISSUE_TEMPLATE = "https://github.com/{slug}/issues/new?title={title}&body={body}"
# 每行最多带多少字节的日志？报告本身不截断，只截 URL。
DEFAULT_LOG_LINES = 200
# GitHub 预填链接对 URL 长度敏感，超过这个字符数就只带摘要，完整内容走附件文件
MAX_ISSUE_URL_CHARS = 6000

_CST = timezone(timedelta(hours=8))  # 与项目其它地方的"上海日期"口径一致


# ----------------------------------------------------------------------
# 问题 ID
# ----------------------------------------------------------------------

def new_issue_id(now: datetime | None = None) -> str:
    """生成问题 ID，形如 ``LS-20260911-3F9A2C``。"""
    moment = (now or datetime.now(_CST)).astimezone(_CST)
    suffix = secrets.token_hex(3).upper()
    return f"LS-{moment:%Y%m%d}-{suffix}"


# ----------------------------------------------------------------------
# 脱敏
# ----------------------------------------------------------------------

_MASK_RULES: list[tuple[re.Pattern[str], str]] = [
    # Bearer / Authorization
    (re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._\-]{8,}"), r"\1 ***"),
    # sk-xxxx（OpenAI / DeepSeek 风格）
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{6,}"), "sk-***"),
    # key=value / "key": "value" 里的密钥
    (re.compile(r"(?i)(api[_-]?key\"?\s*[:=]\s*\"?)([A-Za-z0-9._\-]{6,})"), r"\1***"),
    (re.compile(r"(?i)(access[_-]?token\"?\s*[:=]\s*\"?)([A-Za-z0-9._\-]{6,})"), r"\1***"),
    (re.compile(r"(?i)(secret\"?\s*[:=]\s*\"?)([A-Za-z0-9._\-]{6,})"), r"\1***"),
    # Windows 用户目录里的真实用户名
    (re.compile(r"(?i)([A-Z]:\\Users\\)[^\\\s\"']+"), r"\1<user>"),
    # 兜底：任何 32 位以上的连续密钥/哈希串
    (re.compile(r"\b[A-Za-z0-9_\-]{32,}\b"), "***"),
]


def mask_secrets(text: str) -> str:
    """把报告里可能出现的凭据打码。宁可多打，不可漏打。"""
    if not text:
        return ""
    masked = text
    for pattern, replacement in _MASK_RULES:
        masked = pattern.sub(replacement, masked)
    return masked


# ----------------------------------------------------------------------
# 环境信息
# ----------------------------------------------------------------------

def _safe(getter, default: str = "未知") -> str:
    """探测类调用一律包一层：任何异常都不该让"生成反馈"本身失败。"""
    try:
        value = getter()
    except Exception:  # noqa: BLE001 - 环境探测失败不能中断反馈
        return default
    if value is None or value == "":
        return default
    return str(value)


def collect_environment(
    *,
    launcher_version: str = "",
    current_tag: str = "",
    remote_tag: str = "",
    project_path: str = "",
    repo_url: str = "",
    services: dict[str, str] | None = None,
    extra: dict[str, str] | None = None,
) -> list[tuple[str, str]]:
    """采集"简要日志"里那一段环境信息。顺序即展示顺序。"""
    import platform
    import sys

    rows: list[tuple[str, str]] = [
        ("启动器版本", launcher_version),
        ("当前版本(tag)", current_tag),
        ("远程最新(tag)", remote_tag),
        ("操作系统", _safe(lambda: f"{platform.system()} {platform.release()} ({platform.version()})")),
        ("系统架构", _safe(lambda: platform.machine())),
        ("Python", _safe(lambda: sys.version.split()[0])),
        ("项目目录", project_path),
        ("更新源", repo_url),
    ]

    # Node 版本：项目跑在 bundle 的 node 上，取不到的常见原因是还没构建过
    def _node_version() -> str:
        import subprocess

        node_exe = os.path.join(project_path, "runtime", "nodejs", "node.exe")
        if not os.path.isfile(node_exe):
            return "未找到（未构建？）"
        out = subprocess.run(
            [node_exe, "-v"], capture_output=True, text=True, timeout=5
        )
        return (out.stdout or out.stderr).strip() or "未知"

    rows.append(("Node", _safe(_node_version)))

    for name, status in (services or {}).items():
        rows.append((f"服务·{name}", status))

    for name, value in (extra or {}).items():
        rows.append((name, value))

    return [(k, mask_secrets(v)) for k, v in rows]


# ----------------------------------------------------------------------
# 报告正文
# ----------------------------------------------------------------------

def build_report_text(
    *,
    issue_id: str,
    description: str,
    environment: list[tuple[str, str]],
    log_lines: list[str],
    generated_at: datetime | None = None,
) -> str:
    """拼出完整的反馈正文（Markdown，便于直接贴进 issue）。"""
    moment = (generated_at or datetime.now(_CST)).astimezone(_CST)
    parts: list[str] = [
        "# 邻舍.EXE 问题反馈",
        "",
        f"- 问题ID：**{issue_id}**",
        f"- 生成时间：{moment:%Y-%m-%d %H:%M:%S} (UTC+8)",
        "",
        "## 问题描述",
        "",
        (description or "").strip() or "（未填写）",
        "",
        "## 环境信息",
        "",
    ]
    for key, value in environment:
        parts.append(f"- {key}：{value}")

    parts.extend(["", f"## 最近日志（尾部 {len(log_lines)} 行，系统自动采集）", "", "```log"])
    parts.extend(mask_secrets(line) for line in log_lines)
    parts.extend(["```", ""])
    return "\n".join(parts)


def build_issue_title(issue_id: str, description: str) -> str:
    """issue 标题：``[问题ID] 描述首行``，方便按 ID 检索。"""
    first_line = ""
    for line in (description or "").splitlines():
        if line.strip():
            first_line = line.strip()
            break
    if len(first_line) > 60:
        first_line = first_line[:60] + "…"
    return f"[{issue_id}] {first_line}" if first_line else f"[{issue_id}] 问题反馈"


def build_submit_url(
    template: str,
    *,
    repo_url: str,
    issue_id: str,
    description: str,
    report: str,
) -> str:
    """按模板拼提交地址。

    占位符：``{slug}``（owner/repo）、``{issue_id}``、``{title}``、``{body}``。
    · 模板为空 → 回退到 GitHub issue 预填链接；
    · 模板里没有 ``{body}``（问卷 / QQ 群 / B 站视频页这类）→ 正文只能靠剪贴板，
      调用方必须把这一点告诉用户，不能默默让他提交一份空报告。
    """
    template = (template or "").strip() or DEFAULT_ISSUE_TEMPLATE
    if "{" not in template:
        return template

    from urllib.parse import quote

    body = report
    if len(body) > MAX_ISSUE_URL_CHARS:
        body = body[:MAX_ISSUE_URL_CHARS] + "\n\n…（正文过长已截断，完整报告见附件文件）"

    return (
        template
        .replace("{slug}", quote(_github_slug(repo_url), safe="/"))
        .replace("{issue_id}", quote(issue_id, safe=""))
        .replace("{title}", quote(build_issue_title(issue_id, description), safe=""))
        .replace("{body}", quote(body, safe=""))
    )


def template_carries_body(template: str) -> bool:
    """模板能否把报告正文一起带过去（决定"打不开时是否必须手动粘贴"）。"""
    return "{body}" in (template or DEFAULT_ISSUE_TEMPLATE)


def build_issue_url(repo_url: str, *, issue_id: str, description: str, report: str) -> str:
    """GitHub「新建 issue」预填链接（默认模板的便捷入口）。"""
    return build_submit_url(
        DEFAULT_ISSUE_TEMPLATE,
        repo_url=repo_url,
        issue_id=issue_id,
        description=description,
        report=report,
    )


def _github_slug(repo_url: str) -> str:
    """从 ``https://github.com/owner/repo.git`` 提取 ``owner/repo``。"""
    if not repo_url:
        return ""
    match = re.search(r"github\.com[:/]+([^/]+)/([^/\s]+?)(?:\.git)?/?$", repo_url.strip())
    if not match:
        return ""
    return f"{match.group(1)}/{match.group(2)}"


# ----------------------------------------------------------------------
# 落盘
# ----------------------------------------------------------------------

def save_report(project_path: str, issue_id: str, text: str) -> str:
    """把报告写到 ``<项目>/feedback/<问题ID>.txt``，返回绝对路径。"""
    folder = os.path.join(project_path, "feedback")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{issue_id}.txt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    return path
