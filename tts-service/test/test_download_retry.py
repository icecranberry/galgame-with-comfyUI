import hashlib
import importlib.util
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('tts_retry_download', ROOT / 'download_model.py')
downloader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloader)


class DownloadRetryTests(unittest.TestCase):
    def test_network_error_inheriting_value_error_still_tries_the_mirror(self):
        class CachedNetworkFailure(OSError, ValueError): pass
        calls = []
        def transfer(**kwargs):
            calls.append(kwargs['endpoint'])
            if len(calls) == 1: raise CachedNetworkFailure('failed Hub metadata lookup')
            return 'ok'
        with patch.object(downloader, 'download_endpoints', return_value=['https://first.example', 'https://mirror.example']):
            self.assertEqual(downloader.retry_download(transfer), 'ok')
        self.assertEqual(len(calls), 2)

    @unittest.skipUnless(importlib.util.find_spec('huggingface_hub'), 'requires the bundled Hub dependency')
    def test_mirror_absolute_head_redirects_preserve_metadata_and_verified_tls(self):
        import requests
        import huggingface_hub
        response = types.SimpleNamespace(headers={}, history=[types.SimpleNamespace(headers={'X-Repo-Commit': 'pinned', 'X-Linked-Etag': 'digest'})])
        with patch.object(downloader, 'download_endpoints', return_value=['https://huggingface.co', 'https://hf-mirror.com']), \
                patch.object(huggingface_hub, 'configure_http_backend') as configure:
            downloader.configure_hub_network()
            session = configure.call_args.kwargs['backend_factory']()
        with patch.object(requests.Session, 'request', return_value=response) as request:
            actual = session.request('HEAD', 'https://hf-mirror.com/model/resolve/main/file', allow_redirects=False)
            self.assertTrue(request.call_args.kwargs['allow_redirects'])
            self.assertEqual(request.call_args.kwargs['timeout'], (10, 60))
            self.assertNotEqual(request.call_args.kwargs.get('verify'), False)
            self.assertEqual(actual.headers['X-Repo-Commit'], 'pinned')
            self.assertEqual(actual.headers['X-Linked-Etag'], 'digest')

    def test_ssl_failure_falls_back_to_mirror_with_identical_revision_and_resume_directory(self):
        calls = []
        def transfer(**kwargs):
            calls.append(kwargs)
            if kwargs['endpoint'] == 'https://huggingface.co': raise ConnectionError('SSL interrupted; signed URL must not be logged')
            return 'downloaded'
        with patch.dict(os.environ, {'TTS_HF_ENDPOINTS': 'https://huggingface.co,https://hf-mirror.com'}):
            result = downloader.retry_download(transfer, repo_id='IndexTeam/IndexTTS-2', filename='gpt.pth', revision='pinned', local_dir=Path('same-folder'))
        self.assertEqual(result, 'downloaded')
        self.assertEqual([c['endpoint'] for c in calls], ['https://huggingface.co', 'https://hf-mirror.com'])
        self.assertEqual({k: v for k, v in calls[0].items() if k != 'endpoint'}, {k: v for k, v in calls[1].items() if k != 'endpoint'})
        self.assertFalse(calls[0]['token']); self.assertNotIn('force_download', calls[0])

    def test_rate_limits_retry_with_bounded_backoff_and_eventually_fail_without_erasing_data(self):
        calls = []
        def failed(**kwargs):
            calls.append(kwargs)
            error = OSError('rate limited')
            error.response = types.SimpleNamespace(status_code=429)
            raise error
        with patch.object(downloader, 'download_endpoints', return_value=['https://one.example', 'https://two.example']), patch.object(downloader.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, '保留断点'): downloader.retry_download(failed, repo_id='test')
        self.assertEqual(len(calls), 6); self.assertEqual([c.args[0] for c in sleep.call_args_list], [5, 10])

    def test_invalid_endpoint_and_programming_errors_never_disable_certificate_validation(self):
        for endpoint in ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?key=secret']:
            with patch.dict(os.environ, {'TTS_HF_ENDPOINTS': endpoint}), self.assertRaises(ValueError): downloader.download_endpoints()
        with patch.object(downloader, 'download_endpoints', return_value=['https://example.com']), patch.object(downloader.time, 'sleep') as sleep:
            with self.assertRaises(TypeError): downloader.retry_download(lambda **kw: (_ for _ in ()).throw(TypeError('bad argument')))
            sleep.assert_not_called()

    @unittest.skipUnless(importlib.util.find_spec('huggingface_hub'), 'requires the bundled Hub dependency')
    def test_real_hub_download_resumes_after_interrupted_http_stream(self):
        from huggingface_hub import hf_hub_download, constants
        content = bytes(range(256)) * (24 * 1024 * 1024 // 256)
        digest = hashlib.sha256(content).hexdigest()
        revision = 'a' * 40
        ranges = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_HEAD(self):
                self.send_response(200)
                self.send_header('X-Repo-Commit', revision)
                self.send_header('ETag', '"' + digest + '"')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
            def do_GET(self):
                requested = self.headers.get('Range', '')
                ranges.append(requested)
                start = int(requested.removeprefix('bytes=').split('-')[0]) if requested else 0
                self.send_response(206 if start else 200)
                self.send_header('Content-Length', str(len(content) - start))
                if start: self.send_header('Content-Range', f'bytes {start}-{len(content)-1}/{len(content)}')
                self.end_headers()
                if len(ranges) == 1:
                    self.wfile.write(content[:12 * 1024 * 1024]); self.wfile.flush()
                    self.close_connection = True
                    self.connection.shutdown(socket.SHUT_RDWR)
                else: self.wfile.write(content[start:])
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory, patch.object(constants, 'HF_HUB_OFFLINE', False), patch.dict(os.environ, {'NO_PROXY': '127.0.0.1,localhost'}), \
                    patch.object(downloader, 'download_endpoints', return_value=[f'http://127.0.0.1:{server.server_port}']), patch.object(downloader.time, 'sleep'):
                result = downloader.retry_download(hf_hub_download, repo_id='test/model', filename='weight.bin', revision=revision, local_dir=Path(directory))
                self.assertEqual(hashlib.sha256(Path(result).read_bytes()).hexdigest(), digest)
                self.assertTrue(any(r.startswith('bytes=10485760-') for r in ranges), ranges)
                self.assertFalse(list(Path(directory).rglob('*.incomplete')))
        finally:
            server.shutdown(); server.server_close(); thread.join(2)


if __name__ == '__main__': unittest.main()
