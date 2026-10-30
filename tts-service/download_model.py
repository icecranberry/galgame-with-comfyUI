"""Download all models into the same layout consumed by offline bundles."""
import os
import time
import threading
import logging
import sys
from contextlib import contextmanager
from urllib.parse import urlparse
from pathlib import Path
from deployment import CATALOG, model_id, model_versions, model_directory, model_files, seal_models

HERE = Path(__file__).resolve().parent


def download_endpoints():
    configured = os.environ.get('TTS_HF_ENDPOINTS', '')
    values = configured.split(',') if configured else [os.environ.get('HF_ENDPOINT', ''), 'https://huggingface.co', 'https://hf-mirror.com']
    result = []
    for value in values:
        value = value.strip().rstrip('/')
        if not value:
            continue
        url = urlparse(value)
        if url.scheme != 'https' or not url.netloc or url.username or url.password or url.query or url.fragment or url.path:
            raise ValueError('模型下载地址必须是无凭据的 HTTPS 站点地址')
        if value not in result:
            result.append(value)
    if not result:
        raise ValueError('未配置可用的模型下载站点')
    return result


def configure_hub_network():
    import huggingface_hub
    if not hasattr(huggingface_hub, 'configure_http_backend'):
        return
    import requests
    mirror_hosts = {urlparse(endpoint).netloc for endpoint in download_endpoints() if urlparse(endpoint).hostname != 'huggingface.co'}
    class HubSession(requests.Session):
        def request(self, method, url, **kwargs):
            if kwargs.get('timeout') is None:
                kwargs['timeout'] = (10, 60)
            # Some mirrors send absolute HEAD redirects without Hub metadata
            # on the first hop. The SDK only follows relative HEAD redirects.
            # Follow HTTPS HEAD redirects using the normal verified TLS session
            # and retain any Hub metadata supplied by intermediate responses.
            if method.upper() == 'HEAD' and urlparse(url).netloc in mirror_hosts:
                kwargs['allow_redirects'] = True
                response = super().request(method, url, **kwargs)
                for previous in response.history:
                    for key in ('X-Repo-Commit', 'X-Linked-Size', 'X-Linked-Etag'):
                        if previous.headers.get(key):
                            response.headers.setdefault(key, previous.headers[key])
                return response
            return super().request(method, url, **kwargs)
    huggingface_hub.configure_http_backend(backend_factory=HubSession)


def retry_download(operation, **kwargs):
    # Hub >=0.23 automatically resumes its .incomplete files. All attempts keep
    # the same local_dir/revision; never use force_download or erase the cache.
    # Explicit token=False prevents ambient Hub credentials reaching a mirror.
    endpoints = download_endpoints()
    last = None
    for attempt in range(3):
        for endpoint in endpoints:
            try:
                print(f"下载源：{urlparse(endpoint).hostname} · {kwargs.get('repo_id', '')} · {kwargs.get('filename', '所需模型文件')}", flush=True)
                return operation(**kwargs, endpoint=endpoint, token=False, etag_timeout=20)
            except Exception as error:
                status = getattr(getattr(error, 'response', None), 'status_code', None)
                # LocalEntryNotFoundError also inherits ValueError, despite
                # representing a failed metadata/network lookup. It must retry.
                if isinstance(error, (TypeError, ImportError, PermissionError)) or (isinstance(error, ValueError) and not isinstance(error, OSError)):
                    raise
                last = error
                # Exception strings may contain signed CDN URLs. Log only the
                # error class/status and host; keep the complete cause internal.
                reason = f'HTTP {status}' if status is not None else type(error).__name__
                print(f'下载中断：{urlparse(endpoint).hostname}，{reason}；保留断点，尝试下一下载源（第 {attempt + 1}/3 轮）。', flush=True)
        if attempt < 2:
            delay = min(5 * 2 ** attempt, 20)
            print(f'{delay} 秒后自动重试，已下载文件将继续复用。', flush=True)
            time.sleep(delay)
    raise RuntimeError('模型下载重试后仍失败，请稍后重试；已保留断点，不需要删除模型文件或关闭证书校验。') from last


@contextmanager
def report_download_progress(target):
    stopped = threading.Event()
    def report():
        while not stopped.wait(10):
            try:
                size = sum(p.stat().st_size for p in target.rglob('*') if p.is_file() and p.suffix in ('.pth', '.pt', '.safetensors', '.incomplete'))
                print(f'已保留 {size / 1024 ** 3:.2f} GiB 模型数据（含断点）；下载仍在进行。', flush=True)
            except OSError:
                pass  # A completed .incomplete file can be renamed during scan.
    thread = threading.Thread(target=report, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stopped.set()
        thread.join(1)


def download_models(root=HERE, version=None):
    # Set paths before importing huggingface_hub (it reads environment at import).
    os.environ['HF_HOME'] = str(root / 'cache/huggingface')
    os.environ['HF_HUB_CACHE'] = str(root / 'cache/huggingface/hub')
    os.environ['HF_XET_CACHE'] = str(root / 'cache/huggingface/xet')
    os.environ['HF_HUB_OFFLINE'] = '0'
    os.environ['TRANSFORMERS_OFFLINE'] = '0'
    # HTTP transfer supports byte-range resume and behaves consistently through
    # Windows proxies; avoid the separate Xet transfer stack for this installer.
    os.environ['HF_HUB_DISABLE_XET'] = '1'
    os.environ.setdefault('HF_HUB_DOWNLOAD_TIMEOUT', '60')
    os.environ.setdefault('HF_HUB_ETAG_TIMEOUT', '20')
    # The Hub's retry warnings include complete signed CDN URLs. Our wrapper
    # reports status and host without copying those URLs into the application's UI.
    logging.getLogger('huggingface_hub').setLevel(logging.ERROR)
    from huggingface_hub import hf_hub_download, snapshot_download
    configure_hub_network()

    version = model_id(version)
    versions = model_versions(root, version)
    target = model_directory(root, version)
    target.mkdir(parents=True, exist_ok=True)
    print(f'正在下载 {CATALOG[version]["label"]}；自动切换下载源并保留断点。', flush=True)
    with report_download_progress(target):
        retry_download(snapshot_download, repo_id=versions['model_repo'], revision=versions['model_revision'], local_dir=target, max_workers=1,
                       allow_patterns=[name for name in model_files(version) if not name.startswith('hf_cache/')])
    # Pre-download auxiliaries: first speech must never need the network.
    aux = target / 'hf_cache'
    w2v_files = ['config.json', 'preprocessor_config.json', 'model.safetensors']
    if not all((aux / 'w2v-bert-2.0' / name).is_file() and (aux / 'w2v-bert-2.0' / name).stat().st_size for name in w2v_files):
        retry_download(snapshot_download, repo_id='facebook/w2v-bert-2.0', local_dir=aux / 'w2v-bert-2.0', max_workers=1,
                       allow_patterns=['*.json', '*.safetensors'])
    if not (aux / 'campplus_cn_common.bin').is_file():
        retry_download(hf_hub_download, repo_id='funasr/campplus', filename='campplus_cn_common.bin', local_dir=aux)
    for filename in ('config.json', 'bigvgan_generator.pt'):
        if not (aux / 'bigvgan' / filename).is_file():
            retry_download(hf_hub_download, repo_id='nvidia/bigvgan_v2_22khz_80band_256x', filename=filename,
                           local_dir=aux / 'bigvgan')
    if version == '2.0':
        if not (aux / 'semantic_codec_model.safetensors').is_file():
            downloaded = retry_download(hf_hub_download, repo_id='amphion/MaskGCT', filename='semantic_codec/model.safetensors', local_dir=aux)
            destination = aux / 'semantic_codec_model.safetensors'
            # Both paths are in the same local_dir. Atomically rename the
            # completed download instead of keeping a second 169 MiB copy.
            Path(downloaded).replace(destination)
    print('下载完成，正在校验并写入所选版本的完整性清单…', flush=True)
    seal_models(root, version)


if __name__ == '__main__':
    try:
        download_models()
    except Exception as error:
        print(f'模型安装未完成：{error}', file=sys.stderr, flush=True)
        raise SystemExit(1)
