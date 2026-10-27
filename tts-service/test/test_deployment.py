import importlib.util
import os
import sys
import types
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("tts_deployment", Path(__file__).resolve().parents[1] / "deployment.py")
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / "original"
        self.root.mkdir()
        deployment.write_json(self.root / "versions.json", {"code_revision": "pinned-code", "model_revision": "pinned-model"})
        for name in ("indextts/infer_v2_5.py", "indextts/__init__.py", "pyproject.toml", "uv.lock"):
            self.write("runtime/index-tts/" + name, b"source")
        for name in deployment.MODEL_FILES:
            self.write("runtime/checkpoints/" + name, b"model-data")
        deployment.seal_source(self.root)
        deployment.seal_models(self.root)

    def write(self, relative, content):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def test_complete_bundle_needs_no_git_and_survives_relocation(self):
        moved = Path(self.directory.name) / "另一台电脑 with spaces" / "tts-service"
        shutil.copytree(self.root, moved)
        shutil.rmtree(self.root)
        self.assertIsNone(deployment.installation_error(moved))

    def test_missing_auxiliary_model_or_truncated_weight_never_reports_ready(self):
        for name in ("hf_cache/bigvgan/bigvgan_generator.pt", "gpt.pth"):
            target = self.root / "runtime/checkpoints" / name
            original = target.read_bytes()
            target.write_bytes(b"short")
            self.assertIn(name, deployment.installation_error(self.root))
            target.unlink()
            self.assertIn("部署不完整", deployment.installation_error(self.root))
            target.write_bytes(original)

    def test_changed_code_and_mismatched_model_versions_are_rejected(self):
        self.write("runtime/index-tts/indextts/infer_v2_5.py", b"modified")
        self.assertIn("源码损坏", deployment.installation_error(self.root))
        self.write("runtime/index-tts/indextts/infer_v2_5.py", b"source")
        deployment.write_json(self.root / "runtime/checkpoints/linshe-model-version.json", {})
        self.assertIn("模型版本不匹配", deployment.installation_error(self.root))

    def test_partial_download_has_no_completion_manifest(self):
        (self.root / "runtime/checkpoints/linshe-model-files.json").unlink()
        self.assertIn("部署不完整", deployment.installation_error(self.root))

    def test_runtime_repair_replaces_old_machine_paths_and_is_idempotent(self):
        self.write("runtime/python/cpython/python.exe", b"python")
        self.write("runtime/index-tts/.venv/Scripts/python.exe", b"launcher")
        self.write("runtime/index-tts/.venv/pyvenv.cfg", b"home = C:\\old-user\\python\nversion_info = 3.11.13\nexecutable = C:\\old-user\\python.exe\n")
        self.write("runtime/index-tts/.venv/Lib/site-packages/_editable_impl_indextts.pth", b"D:\\old-project\\index-tts\n")
        deployment.write_json(self.root / "runtime/runtime.json", {"python_home": "python/cpython"})
        deployment.prepare_runtime(self.root)
        cfg = self.root / "runtime/index-tts/.venv/pyvenv.cfg"
        content = cfg.read_text()
        self.assertIn(str(self.root / "runtime/python/cpython"), content)
        self.assertNotIn("old-user", content)
        self.assertIn("3.11.13", content)
        deployment.prepare_runtime(self.root)
        self.assertEqual(content, cfg.read_text())
        self.assertEqual((self.root / "runtime/index-tts/.venv/Lib/site-packages/_editable_impl_indextts.pth").read_text().strip(), str(self.root / "runtime/index-tts"))

    def test_runtime_manifest_cannot_escape_service_folder(self):
        deployment.write_json(self.root / "runtime/runtime.json", {"python_home": "../outside"})
        with self.assertRaisesRegex(ValueError, "越界"):
            deployment.prepare_runtime(self.root)

    def test_package_has_one_runtime_folder_and_extracts_as_a_complete_bundle(self):
        path = Path(__file__).resolve().parents[1] / "pack_runtime.py"
        spec = importlib.util.spec_from_file_location("tts_pack", path)
        packer = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"deployment": deployment}):
            spec.loader.exec_module(packer)
        for name in ("python/cpython/python.exe", "index-tts/.venv/Scripts/python.exe",
                     "tools/ffmpeg/bin/ffmpeg.exe", "tools/ffmpeg/bin/ffprobe.exe"):
            self.write("runtime/" + name, b"binary")
        self.write("runtime/index-tts/.venv/pyvenv.cfg", b"home = C:\\old\\python\n")
        self.write("runtime/index-tts/__pycache__/scratch.pyc", b"cache")
        deployment.write_json(self.root / "runtime/runtime.json", {"python_home": "python/cpython"})
        output = Path(self.directory.name) / "package.zip"
        packer.pack_runtime(self.root, output)
        with ZipFile(output) as archive:
            self.assertEqual({name.split('/')[0] for name in archive.namelist()}, {"runtime"})
            self.assertIn("runtime/index-tts/.venv/Scripts/python.exe", archive.namelist())
            self.assertFalse(any("__pycache__" in name for name in archive.namelist()))
            target = Path(self.directory.name) / "新的邻舍" / "tts-service"
            archive.extractall(target)
        shutil.copyfile(self.root / "versions.json", target / "versions.json")
        shutil.rmtree(self.root)
        deployment.prepare_runtime(target)
        self.assertIsNone(deployment.installation_error(target))
        self.assertTrue(output.with_suffix('.zip.sha256').is_file())

    def test_downloader_uses_bundle_paths_and_never_marks_partial_download_ready(self):
        path = Path(__file__).resolve().parents[1] / "download_model.py"
        spec = importlib.util.spec_from_file_location("tts_download", path)
        downloader = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"deployment": deployment}):
            spec.loader.exec_module(downloader)
        versions = deployment.read_json(self.root / "versions.json") | {"model_repo": "IndexTeam/IndexTTS-2.5"}
        deployment.write_json(self.root / "versions.json", versions)
        calls = []
        def download(**kwargs):
            calls.append(kwargs)
            self.assertTrue(Path(kwargs["local_dir"]).is_relative_to(self.root / "runtime/checkpoints"))
        hub = types.SimpleNamespace(snapshot_download=download, hf_hub_download=download)
        with patch.dict(sys.modules, {"huggingface_hub": hub}), patch.dict(os.environ, {"TTS_MODEL_DIR": "Z:/wrong-models"}):
            downloader.download_models(self.root)
            self.assertEqual(calls[0]["revision"], "pinned-model")
            self.assertEqual(len(calls), 5)
            self.assertTrue(Path(os.environ["HF_HOME"]).is_relative_to(self.root))
            self.assertEqual(deployment.read_json(self.root / "runtime/checkpoints/linshe-model-version.json"), versions)
            (self.root / "runtime/checkpoints/linshe-model-version.json").unlink()
            with patch.object(hub, "snapshot_download", side_effect=ConnectionError("offline")):
                with self.assertRaises(ConnectionError):
                    downloader.download_models(self.root)
            self.assertFalse((self.root / "runtime/checkpoints/linshe-model-version.json").exists())


if __name__ == "__main__":
    unittest.main()
