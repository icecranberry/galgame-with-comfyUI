"""Bounded Moegirl requests shared by page and portrait downloads."""

import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlparse

import requests

MESSAGES = {
    'blocked': '萌娘百科要求访问验证，暂时无法获取立绘',
    'rate_limited': '萌娘百科请求过于频繁，请稍后重试立绘',
    'timeout': '获取立绘超时，请重试',
    'network_error': '连接萌娘百科失败，请重试立绘',
    'http_error': '萌娘百科暂时无法提供图片，请重试',
    'not_found': '未找到可用的百科立绘，可重试或手动提供参考图',
    'too_large': '百科立绘超过 6MB，请手动提供较小的参考图',
    'invalid_image': '百科返回的内容不是有效图片，请重试或手动提供参考图',
    'invalid_url': '百科地址无效，无法获取立绘',
}


class FetchError(Exception):
    def __init__(self, code, retry_after=0):
        super().__init__(MESSAGES[code])
        self.code = code
        self.retry_after = retry_after


def allowed_moegirl_url(value, base=''):
    try:
        url = urljoin(base, value)
        parsed = urlparse(url)
        host = parsed.hostname or ''
        if (parsed.scheme not in ('http', 'https') or parsed.username or parsed.password
                or parsed.port not in (None, 80, 443)
                or not (host == 'moegirl.org.cn' or host.endswith('.moegirl.org.cn'))):
            return ''
        return requests.utils.requote_uri(url)
    except (TypeError, ValueError):
        return ''


def retry_after_seconds(value):
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            return max(0, int((date - datetime.now(timezone.utc)).total_seconds()) + 1)
        except (TypeError, ValueError, OverflowError):
            return 2


def fetch_bytes(session, url, headers, deadline, max_bytes, *, sleep=time.sleep):
    """403/404: don't repeat; 429: honor Retry-After; timeout/5xx: bounded backoff."""
    url = allowed_moegirl_url(url)
    if not url:
        raise FetchError('invalid_url')
    last_error = FetchError('timeout')
    for attempt in range(3):
        delay = 0.5 * (2 ** attempt)
        current_url = url
        try:
            for _ in range(4):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise FetchError('timeout')
                with session.get(current_url, headers=headers, timeout=min(5, remaining),
                                 stream=True, allow_redirects=False) as response:
                    status = response.status_code
                    if status in (301, 302, 303, 307, 308):
                        location = response.headers.get('Location')
                        current_url = allowed_moegirl_url(location, current_url) if location else ''
                        if not current_url:
                            raise FetchError('invalid_url')
                        continue
                    if status in (401, 403) or response.headers.get('cf-mitigated') == 'challenge':
                        raise FetchError('blocked')
                    if status == 429:
                        delay = max(1, retry_after_seconds(response.headers.get('Retry-After')))
                        raise FetchError('rate_limited', delay)
                    if status in (404, 410):
                        raise FetchError('not_found')
                    if status >= 500 or status == 408:
                        raise FetchError('http_error' if status >= 500 else 'timeout')
                    if status >= 400:
                        raise FetchError('invalid_url')
                    try:
                        size = int(response.headers.get('Content-Length', 0))
                    except ValueError:
                        size = 0
                    if size > max_bytes:
                        raise FetchError('too_large')
                    data = bytearray()
                    for chunk in response.iter_content(64 * 1024):
                        data.extend(chunk)
                        if len(data) > max_bytes:
                            raise FetchError('too_large')
                        if time.monotonic() >= deadline:
                            raise FetchError('timeout')
                    head = bytes(data[:8192]).lower()
                    if b'just a moment' in head and (b'cloudflare' in head or b'cf-' in head):
                        raise FetchError('blocked')
                    return bytes(data), current_url
            raise FetchError('invalid_url')
        except requests.Timeout:
            last_error = FetchError('timeout')
        except requests.RequestException:
            last_error = FetchError('network_error')
        except FetchError as error:
            last_error = error
        if last_error.code not in ('timeout', 'network_error', 'http_error', 'rate_limited'):
            raise last_error
        # Don't bypass a long server-requested cooldown by switching hosts/addresses.
        if attempt == 2 or delay > 8 or time.monotonic() + delay >= deadline:
            raise last_error
        sleep(delay)
    raise last_error
