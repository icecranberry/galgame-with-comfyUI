"""Opt-in real extracted-bundle check; no user DB or audio is modified."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import wave
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from uuid import uuid4
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT))
from deployment import CATALOG, model_id, source_directory


def request(url, data=None, timeout=10):
    body = None if data is None else json.dumps(data).encode()
    try:
        with urlopen(Request(url, body, headers={"Content-Type": "application/json"}), timeout=timeout) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code == 409: raise
        raise RuntimeError(f'HTTP {error.code}: {error.read().decode("utf-8", errors="replace")}') from error


@unittest.skipUnless(os.environ.get("RUN_TTS_BUNDLE_TEST") == "1", "requires deployed local bundle")
class BundleIntegrationTests(unittest.TestCase):
    def test_offline_start_and_optional_gpu_synthesis(self):
        parent = os.environ.get('TTS_BUNDLE_TEST_TMPDIR')
        if not parent and os.environ.get('TTS_BUNDLE_TEST_SINGLE_MODEL') == '1':
            parent = ROOT.parent / 'output'
            parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="tts-offline-", dir=parent) as directory:
            temp = Path(directory)
            root = ROOT
            selected = model_id()
            if os.environ.get('TTS_BUNDLE_TEST_SINGLE_MODEL') == '1':
                # Same-volume hard links keep the real offline folder contract
                # without duplicating weight bytes. Mutable venv config is
                # copied; no other engine exists in this service root.
                root = temp / '只有所选模型 with spaces' / 'tts-service'
                root.mkdir(parents=True)
                for pattern in ('*.py', '*.ps1', '*.json', '*.txt'):
                    for source in ROOT.glob(pattern): shutil.copyfile(source, root / source.name)
                (root / 'runtime').mkdir()
                def link_file(source, target):
                    # Windows also locks other hard links to a loaded DLL. Copy
                    # binaries so this temporary tree can be removed while the
                    # test runner still uses the original Python runtime.
                    if Path(source).name in ('pyvenv.cfg', '_editable_impl_indextts.pth') or Path(source).suffix.lower() in ('.exe', '.dll', '.pyd'):
                        return shutil.copyfile(source, target)
                    return os.link(source, target)
                for name in ('python', 'tools', CATALOG[selected]['directory']):
                    shutil.copytree(ROOT / 'runtime' / name, root / 'runtime' / name, copy_function=link_file,
                                    ignore=shutil.ignore_patterns('.cache', '__pycache__'))
                shutil.copyfile(ROOT / 'runtime/runtime.json', root / 'runtime/runtime.json')
                (root / 'runtime/selected-model.json').write_text(json.dumps({'model': selected}), encoding='utf-8')
                self.assertEqual({p.name for p in (root / 'runtime').iterdir()}, {'python', 'tools', 'runtime.json', 'selected-model.json', CATALOG[selected]['directory']})
            if os.environ.get("TTS_BUNDLE_ARCHIVE"):
                # Exercise the exact user flow: existing app scripts + one ZIP.
                root = temp / "解压验证 with spaces" / "tts-service"
                root.mkdir(parents=True)
                for pattern in ("*.py", "*.ps1", "*.json", "*.txt"):
                    for source in ROOT.glob(pattern):
                        shutil.copyfile(source, root / source.name)
                with ZipFile(os.environ["TTS_BUNDLE_ARCHIVE"]) as archive:
                    for name in archive.namelist():
                        target = (root / name).resolve()
                        if not target.is_relative_to(root.resolve()) or name.split('/')[0] != "runtime":
                            raise ValueError("Unexpected archive member")
                    archive.extractall(root)
            # Inherited by inference children too. A missing dependency cannot
            # silently fall back to an internet download during this test.
            (temp / "sitecustomize.py").write_text(
                "import sys\n"
                "def audit(event, args):\n"
                "    if event == 'socket.connect' and args[1][0] not in ('127.0.0.1', '::1', 'localhost'):\n"
                "        raise RuntimeError('External network forbidden in offline bundle test')\n"
                "sys.addaudithook(audit)\n", encoding="utf-8")
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            env = dict(os.environ, TTS_PORT=str(port), TTS_SERVICE_TOKEN="", TTS_AUDIO_DIR=str(temp / "audio"),
                       TTS_LOCAL_MODEL=selected,
                       PYTHONPATH=os.pathsep.join((str(temp), str(source_directory(root, selected)))), PYTHONNOUSERSITE="1",
                       HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HOME=str(temp / "empty-hf"),
                       TORCH_HOME=str(temp / "empty-torch"), NUMBA_CACHE_DIR=str(temp / "numba"))
            # Even the normal setup entry point must stay offline on a complete
            # bundle, with neither system Git nor system Python on PATH.
            windows = Path(os.environ["SystemRoot"])
            powershell = windows / "System32/WindowsPowerShell/v1.0/powershell.exe"
            setup_env = dict(env, PATH=str(windows / "System32"))
            setup_path = str(root / "setup.ps1").replace("'", "''")
            checked = subprocess.run([str(powershell), "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
                                      "function Invoke-WebRequest { throw 'Network access forbidden' }; & '" + setup_path + "' -ModelVersion '" + selected + "'"],
                                     cwd=temp, env=setup_env, capture_output=True, timeout=30,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)
            base = f"http://127.0.0.1:{port}"
            lease = None
            with (temp / "service.log").open("w", encoding="utf-8") as log:
                process = subprocess.Popen([str(source_directory(root, selected) / '.venv/Scripts/python.exe'), "-X", "utf8", str(root / "server.py")],
                                           cwd=temp, env=env, stdout=log, stderr=subprocess.STDOUT,
                                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                try:
                    for attempt in range(30):
                        try:
                            health = request(base + "/health", timeout=1)
                            break
                        except OSError:
                            if process.poll() is not None:
                                self.fail((temp / "service.log").read_text(encoding="utf-8"))
                            time.sleep(0.25)
                    else:
                        self.fail("Bundle server did not start")
                    self.assertTrue(health["ready"], health)
                    self.assertFalse(health["worker_alive"])
                    if os.environ.get("RUN_TTS_BUNDLE_GPU_TEST") == "1":
                        # Do not disturb a warm or busy production voice worker.
                        try: active = request("http://127.0.0.1:7861/health")
                        except OSError: active = {'worker_alive': False}
                        self.assertFalse(active["worker_alive"], "Production TTS must be idle and unloaded")
                        token = str(uuid4())
                        deadline = time.monotonic() + 120
                        while True:
                            try:
                                acquired = request("http://127.0.0.1:8188/linshe/gpu/acquire", {"token": token}, 30)
                                break
                            except HTTPError as error:
                                if error.code != 409 or time.monotonic() >= deadline: raise
                                time.sleep(1)
                        self.assertTrue(acquired.get("acquired"), acquired)
                        lease = token
                        reference = temp / "audio/references/test.wav"
                        reference.parent.mkdir(parents=True)
                        example = 'voice_03.wav'
                        source_reference = Path(os.environ.get('TTS_TEST_REFERENCE', str(source_directory(root, selected) / 'examples' / example)))
                        shutil.copyfile(source_reference, reference)
                        result = request(base + "/synthesize", {
                            "model_version": health["model_version"], "text": "你好，离线语音部署已经完成。",
                            "reference": "references/test.wav", "output": "generated/test.wav",
                            "language": "zh", "duration_factor": 1,
                        }, 360)
                        self.assertTrue(result["ok"], result)
                        self.assertGreater((temp / "audio/generated/test.wav").stat().st_size, 1000)
                        print(f"Offline bundle synthesis: {result['elapsed_seconds']} seconds", flush=True)
                        with wave.open(str(temp / 'audio/generated/test.wav')) as generated:
                            self.assertGreater(generated.getnframes() / generated.getframerate(), 0.2)
                        if os.environ.get('TTS_BUNDLE_TEST_OUTPUT'):
                            output = Path(os.environ['TTS_BUNDLE_TEST_OUTPUT'])
                            output.mkdir(parents=True, exist_ok=True)
                            model_label = CATALOG[selected]['directory']
                            shutil.copyfile(temp / 'audio/generated/test.wav', output / f'{model_label}-check.wav')
                            (output / 'report.json').write_text(json.dumps({'health': health, 'synthesis': result}, ensure_ascii=False, indent=2), encoding='utf-8')
                        if os.environ.get('TTS_BUNDLE_TEST_WARM') == '1':
                            warm = request(base + '/synthesize', {
                                'model_version': health['model_version'], 'text': '语速调整测试，今天的天气很好。',
                                'reference': 'references/test.wav', 'output': 'generated/warm.wav', 'language': 'zh', 'duration_factor': 0.8,
                            }, 360)
                            self.assertTrue(warm['ok'], warm)
                            print(f"Warm synthesis with speed 1.25: {warm['elapsed_seconds']} seconds", flush=True)
                            if os.environ.get('TTS_BUNDLE_TEST_OUTPUT'):
                                shutil.copyfile(temp / 'audio/generated/warm.wav', output / f'{model_label}-speed-1.25.wav')
                                (output / 'report.json').write_text(json.dumps({'health': health, 'synthesis': result, 'warm_synthesis': warm, 'warm_speed': 1.25}, ensure_ascii=False, indent=2), encoding='utf-8')
                except Exception:
                    log.flush()
                    print((temp / "service.log").read_text(encoding="utf-8"), flush=True)
                    raise
                finally:
                    # Unload must succeed before releasing ComfyUI's GPU guard.
                    unloaded = False
                    try:
                        unloaded = request(base + "/unload", {}, 30).get("unloaded", False)
                    finally:
                        if os.name == "nt" and process.poll() is None:
                            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                           check=True, stdout=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
                        else:
                            process.terminate()
                        process.wait(timeout=15)
                        if lease and unloaded:
                            request("http://127.0.0.1:8188/linshe/gpu/release", {"token": lease})


if __name__ == "__main__":
    unittest.main()
