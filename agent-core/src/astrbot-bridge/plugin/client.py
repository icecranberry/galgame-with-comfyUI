"""Small asynchronous client; credentials never enter tool arguments or tool results."""
import asyncio
import time
import base64
from urllib.parse import urlsplit, urljoin

import aiohttp


class LinsheClient:
    def __init__(self, base_url, token):
        base_url = str(base_url).rstrip('/')
        parsed = urlsplit(base_url)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError('邻舍地址须为根地址，如 http://127.0.0.1:3099')
        self.base_url, self.token = base_url, str(token)
        self.session = None

    async def request(self, method, path, timeout=120, **kwargs):
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120))
        async with self.session.request(method, self.base_url + '/api/astrbot' + path,
                                        headers={'Authorization': 'Bearer ' + self.token},
                                        allow_redirects=False, timeout=aiohttp.ClientTimeout(total=timeout), **kwargs) as response:
            try:
                data = await response.json()
            except (ValueError, aiohttp.ContentTypeError):
                raise RuntimeError(f'邻舍接口返回 HTTP {response.status}，请检查地址和后端版本') from None
            if response.status >= 300:
                raise RuntimeError(data.get('error', f'邻舍请求失败 ({response.status})'))
            return data

    async def wait_job(self, path, timeout=600):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            data = await self.request('GET', path)
            if data.get('status') in ('done', 'completed'):
                return data
            if data.get('status') in ('failed', 'cancelled'):
                raise RuntimeError(data.get('error') or '邻舍任务失败或已取消')
            await asyncio.sleep(2)
        raise TimeoutError('等待邻舍任务超时，请在邻舍检查任务状态；任务可能仍在运行')

    def media_url(self, path):
        url = urljoin(self.base_url + '/', path)
        if urlsplit(url).netloc != urlsplit(self.base_url).netloc or urlsplit(url).scheme != urlsplit(self.base_url).scheme:
            raise ValueError('邻舍媒体地址不属于已配置的服务')
        return url

    async def media_base64(self, path):
        url = self.media_url(path)
        async with self.session.get(url, allow_redirects=False) as response:
            if response.status != 200:
                raise RuntimeError(f'邻舍媒体读取失败 ({response.status})')
            chunks, total = [], 0
            async for chunk in response.content.iter_chunked(65536):
                total += len(chunk)
                if total > 32 * 1024 * 1024:
                    raise RuntimeError('邻舍媒体超过 32MB，请在邻舍查看')
                chunks.append(chunk)
            return base64.b64encode(b''.join(chunks)).decode('ascii')

    async def close(self):
        if self.session:
            await self.session.close()
