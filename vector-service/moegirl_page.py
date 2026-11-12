"""Page fallback strategies without loading the vector database or embedding model."""

import time
from urllib.parse import urlparse, urlunparse
from moegirl_fetch import FetchError, allowed_moegirl_url, fetch_bytes


def fetch_moegirl_page(url, direct_session, scraper, legacy_headers):
    if not allowed_moegirl_url(url):
        raise FetchError('invalid_url')
    parsed = urlparse(url)
    candidates = [url]
    if parsed.hostname == 'zh.moegirl.org.cn':
        candidates.append(urlunparse(parsed._replace(netloc='mzh.moegirl.org.cn')))
    deadline = time.monotonic() + 30
    last_error = FetchError('timeout')
    for candidate in candidates:
        for session, headers in ((direct_session, {'User-Agent': 'Mozilla/5.0'}), (scraper, legacy_headers)):
            try:
                return fetch_bytes(session, candidate, headers, deadline, 8 * 1024 * 1024)
            except FetchError as error:
                last_error = error
                if error.code == 'rate_limited' or time.monotonic() >= deadline:
                    raise error
                # Missing articles aren't fixed by changing request headers or domain.
                if error.code in ('not_found', 'invalid_url'):
                    raise error
    raise last_error
