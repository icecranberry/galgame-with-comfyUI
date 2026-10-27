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
from urllib.request import Request, urlopen
from uuid import uuid4
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


def request(url, data=None, timeout=10):
    body = None if data is None else json.dumps(data).encode()
    with urlopen(Request(url, body, headers={"Content-Type": "application/json"}), timeout=timeout) as response:
        return json.load(response)


@unittest.skipUnless(os.environ.get("RUN_TTS_BUNDLE_TEST") == "1", "requires deployed local bundle")
class BundleIntegrationTests(unittest.TestCase):
    def test_offline_start_and_optional_gpu_synthesis(self):
        with tempfile.TemporaryDirectory(prefix="tts-offline-", dir=os.environ.get("TTS_BUNDLE_TEST_TMPDIR")) as directory:
            temp = Path(directory)
            root = ROOT
            if os.environ.get("TTS_BUNDLE_ARCHIVE"):
                # Exercise the exact user flow: existing app scripts + one ZIP.
                root = temp / "解压验证 with spaces" / "tts-service"
                root.mkdir(parents=True)
                for pattern in ("*.py", "*.ps1", "versions.json"):
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
                       PYTHONPATH=os.pathsep.join((str(temp), str(root / "runtime/index-tts"))), PYTHONNOUSERSITE="1",
                       HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HOME=str(temp / "empty-hf"),
                       TORCH_HOME=str(temp / "empty-torch"), NUMBA_CACHE_DIR=str(temp / "numba"))
            # Even the normal setup entry point must stay offline on a complete
            # bundle, with neither system Git nor system Python on PATH.
            windows = Path(os.environ["SystemRoot"])
            powershell = windows / "System32/WindowsPowerShell/v1.0/powershell.exe"
            setup_env = dict(env, PATH=str(windows / "System32"))
            setup_path = str(root / "setup.ps1").replace("'", "''")
            checked = subprocess.run([str(powershell), "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
                                      "function Invoke-WebRequest { throw 'Network access forbidden' }; & '" + setup_path + "'"],
                                     cwd=temp, env=setup_env, capture_output=True, timeout=30,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)
            base = f"http://127.0.0.1:{port}"
            lease = None
            with (temp / "service.log").open("w", encoding="utf-8") as log:
                process = subprocess.Popen([str(root / "runtime/index-tts/.venv/Scripts/python.exe"), "-X", "utf8", str(root / "server.py")],
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
                        active = request("http://127.0.0.1:7861/health")
                        self.assertFalse(active["worker_alive"], "Production TTS must be idle and unloaded")
                        token = str(uuid4())
                        acquired = request("http://127.0.0.1:8188/linshe/gpu/acquire", {"token": token}, 30)
                        self.assertTrue(acquired.get("acquired"), acquired)
                        lease = token
                        reference = temp / "audio/references/test.wav"
                        reference.parent.mkdir(parents=True)
                        shutil.copyfile(root / "runtime/index-tts/examples/voice_03.wav", reference)
                        result = request(base + "/synthesize", {
                            "model_version": health["model_version"], "text": "你好，离线语音部署已经完成。",
                            "reference": "references/test.wav", "output": "generated/test.wav",
                            "language": "zh", "duration_factor": 1,
                        }, 360)
                        self.assertTrue(result["ok"], result)
                        self.assertGreater((temp / "audio/generated/test.wav").stat().st_size, 1000)
                        print(f"Offline bundle synthesis: {result['elapsed_seconds']} seconds", flush=True)
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
