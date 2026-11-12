import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('page scraping tries the working ordinary request before the legacy Chrome fallback', () => {
  const result = spawnSync(process.env.PYTHON || 'python', ['-B', '-c', `
from moegirl_page import fetch_moegirl_page
calls = []
class Response:
    status_code = 200
    headers = {}
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def iter_content(self, size): yield b'<html>article</html>'
class Session:
    def __init__(self, name, failed=False): self.name, self.failed = name, failed
    def get(self, url, **options):
        calls.append((self.name, url, options))
        response = Response()
        if self.failed: response.status_code = 403
        return response
_direct_session = Session('direct')
_scraper = Session('legacy')
_SCRAPE_HEADERS = {'User-Agent': 'fixed legacy Chrome'}
url = 'https://zh.moegirl.org.cn/Character'
assert fetch_moegirl_page(url, _direct_session, _scraper, _SCRAPE_HEADERS) == (b'<html>article</html>', url)
assert len(calls) == 1
assert calls[0][0:2] == ('direct', url)
assert calls[0][2]['headers'] == {'User-Agent': 'Mozilla/5.0'}
assert calls[0][2]['allow_redirects'] is False
calls.clear()
_direct_session.failed = True
assert fetch_moegirl_page(url, _direct_session, _scraper, _SCRAPE_HEADERS)[0] == b'<html>article</html>'
assert [c[0] for c in calls] == ['direct', 'legacy']
assert calls[1][2]['headers'] == _SCRAPE_HEADERS
`], { cwd: fileURLToPath(new URL('../../vector-service', import.meta.url)), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
});

test('image retrieval uses same-portrait alternatives and reports typed retry failures', () => {
  const result = spawnSync(process.env.PYTHON || 'python', ['-B', '-c', `
import time, requests
from bs4 import BeautifulSoup
from moegirl_fetch import fetch_bytes, FetchError, retry_after_seconds
from moegirl_image import find_infobox_image_candidates, fetch_infobox_image_result
page = 'https://zh.moegirl.org.cn/Character'
small = 'https://storage.moegirl.org.cn/portrait.jpg!/fw/280?v=1'
large = 'https://storage.moegirl.org.cn/portrait.jpg!/fw/560?v=1'
soup = BeautifulSoup('<table class="moe-infobox infobox3"><img width="280" src="' + small + '" srcset="' + large + ' 2x"><img src="https://storage.moegirl.org.cn/other-outfit.jpg"></table>', 'html.parser')
assert find_infobox_image_candidates([soup], page) == [small, large]

class Response:
    def __init__(self, status=200, headers=None, data=b'\\xff\\xd8\\xffportrait'):
        self.status_code, self.headers, self.data = status, headers or {}, data
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def iter_content(self, size): yield self.data
class Session:
    def __init__(self, responses): self.responses, self.calls = list(responses), []
    def get(self, url, **options):
        options['headers'].get('Referer', '').encode('ascii')
        self.calls.append(url)
        value = self.responses.pop(0)
        if isinstance(value, Exception): raise value
        return value

session = Session([Response(404), Response()])
result = fetch_infobox_image_result([soup], page, session)
assert result['status'] == 'ready'
assert result['image'].startswith('data:image/jpeg;base64,')
assert session.calls == [small, large]
session = Session([Response()])
assert fetch_infobox_image_result([soup], 'https://zh.moegirl.org.cn/御坂美琴', session)['status'] == 'ready'
session = Session([Response(403), Response(403)])
result = fetch_infobox_image_result([soup], page, session)
assert result['status'] == 'blocked' and result['message']
assert session.calls == [small, large]  # no repeated requests to the rejected address
session = Session([Response(429, {'Retry-After': '120'})])
result = fetch_infobox_image_result([soup], page, session)
assert result['status'] == 'rate_limited' and result['retry_after'] == 120
assert session.calls == [small]  # don't switch addresses to evade a rate limit

delays = []
session = Session([Response(429, {'Retry-After': '2'}), Response()])
fetch_bytes(session, small, {}, time.monotonic()+30, 1000, sleep=delays.append)
assert delays == [2]
assert retry_after_seconds('Thu, 01 Jan 1970 00:00:00 GMT') == 0
assert retry_after_seconds('invalid') == 2

delays = []
session = Session([requests.Timeout(), Response(503), Response()])
fetch_bytes(session, small, {}, time.monotonic()+30, 1000, sleep=delays.append)
assert delays == [0.5, 1.0]
assert len(session.calls) == 3
session = Session([Response(200, data=b'<html>Just a moment <div id="cf-challenge"></div></html>')])
try:
    fetch_bytes(session, small, {}, time.monotonic()+30, 1000)
    assert False
except FetchError as error:
    assert error.code == 'blocked'
session = Session([Response(404)])
try:
    fetch_bytes(session, small, {}, time.monotonic()+30, 1000)
    assert False
except FetchError as error:
    assert error.code == 'not_found' and len(session.calls) == 1
`], { cwd: fileURLToPath(new URL('../../vector-service', import.meta.url)), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
});

test('Python scraper selects the infobox portrait and bounds image downloads without losing text', () => {
  const result = spawnSync(process.env.PYTHON || 'python', ['-B', '-c', `
from bs4 import BeautifulSoup
from moegirl_image import find_infobox_image, fetch_infobox_image, MAX_IMAGE_BYTES
page = 'https://zh.moegirl.org.cn/Character'
html = '''<template id="MOE_SKIN_TEMPLATE_BODYCONTENT"><div class="mw-parser-output">
<img src="https://img.moegirl.org.cn/unrelated.png">
<table class="moe-infobox infobox3"><tr><td>
<img width="20" src="//img.moegirl.org.cn/badge.png">
<img width="280" height="500" src="data:image/gif;base64,placeholder" data-src="//img.moegirl.org.cn/portrait.png">
<img src="//img.moegirl.org.cn/alternate.png"></td></tr></table></div></template>'''
soup = BeautifulSoup(html, 'html.parser')
assert find_infobox_image([None, soup], page) == 'https://img.moegirl.org.cn/portrait.png'
assert find_infobox_image([BeautifulSoup('<img src="//img.moegirl.org.cn/body.png">', 'html.parser')], page) == ''
for url in ['http://127.0.0.1/image.png', 'https://moegirl.org.cn.evil.test/image.png', 'file:///x.png']:
    bad = BeautifulSoup('<table class="infobox3"><img src="' + url + '"></table>', 'html.parser')
    assert find_infobox_image([bad], page) == ''

class Response:
    def __init__(self, data=b'\\x89PNG\\r\\n\\x1a\\nportrait', status=200, headers=None):
        self.data, self.status_code, self.headers = data, status, headers or {}
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def raise_for_status(self):
        if self.status_code >= 400: raise ValueError('download failed')
    def iter_content(self, size): yield self.data

class Session:
    def __init__(self, response): self.response, self.calls = response, []
    def get(self, url, **kwargs):
        assert kwargs['allow_redirects'] is False
        assert kwargs['headers']['Referer'] == page
        self.calls.append(url)
        return self.response

assert fetch_infobox_image([soup], page, Session(Response())).startswith('data:image/png;base64,')
for response in [Response(b'<html>denied</html>'), Response(status=403),
                 Response(headers={'Content-Length': str(MAX_IMAGE_BYTES + 1)}),
                 Response(b'x' * (MAX_IMAGE_BYTES + 1))]:
    assert fetch_infobox_image([soup], page, Session(response)) == ''
redirect = Session(Response(status=302, headers={'Location': 'http://127.0.0.1/private.png'}))
assert fetch_infobox_image([soup], page, redirect) == ''
assert len(redirect.calls) == 1
`], { cwd: fileURLToPath(new URL('../../vector-service', import.meta.url)), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
});
