import os
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import deployment
import download_model
import pack_runtime
import compact_runtime


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        selected = patch.dict(os.environ, {'TTS_LOCAL_MODEL': '2.0'})
        selected.start(); self.addCleanup(selected.stop)
        self.directory = tempfile.TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / 'original'; self.root.mkdir()
        for file in ('python/cpython/python.exe', 'tools/ffmpeg/bin/ffmpeg.exe', 'tools/ffmpeg/bin/ffprobe.exe'):
            self.write('runtime/' + file, b'binary')
        deployment.write_json(self.root / 'runtime/runtime.json', {'python_home': 'python/cpython'})
        deployment.write_json(self.root / 'versions-2.0.json', {'code_revision': 'pinned-code', 'model_revision': 'pinned-2.0', 'model_repo': 'IndexTeam/IndexTTS-2'})
        self.source = deployment.source_directory(self.root)
        for name in deployment.source_entries(): self.write_path(self.source / name, b'source')
        self.write_path(self.source / '.venv/Scripts/python.exe', b'launcher')
        self.write_path(self.source / '.venv/pyvenv.cfg', b'home = C:\\old\\python\nversion_info = 3.11.13\nexecutable = C:\\old\\python.exe\n')
        self.write_path(self.source / '.venv/Lib/site-packages/_editable_impl_indextts.pth', b'D:\\old-project\n')
        self.models = deployment.model_directory(self.root)
        for name in deployment.model_files(): self.write_path(self.models / name, b'model-data')
        deployment.seal_source(self.root); deployment.seal_models(self.root)

    def write_path(self, target, content):
        target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(content)

    def write(self, relative, content): self.write_path(self.root / relative, content)

    def test_index_only_bundle_is_complete_and_relocatable(self):
        self.assertEqual(list(deployment.CATALOG), ['2.0'])
        moved = Path(self.directory.name) / '另一台电脑 with spaces' / 'tts-service'
        shutil.copytree(self.root, moved)
        deployment.prepare_runtime(moved)
        self.assertIsNone(deployment.installation_error(moved))
        self.assertFalse((moved / 'runtime/voxcpm-2.0').exists())

    def test_missing_auxiliary_and_truncated_weights_never_report_ready(self):
        for name in ('hf_cache/bigvgan/bigvgan_generator.pt', 'gpt.pth'):
            target = self.models / name; original = target.read_bytes()
            target.write_bytes(b'x'); self.assertIn(name, deployment.installation_error(self.root))
            target.unlink(); self.assertIn('部署不完整', deployment.installation_error(self.root))
            target.write_bytes(original)

    def test_changed_source_missing_environment_and_wrong_version_are_rejected(self):
        self.write_path(self.source / 'indextts/infer_v2.py', b'modified')
        self.assertIn('源码损坏', deployment.installation_error(self.root))
        self.write_path(self.source / 'indextts/infer_v2.py', b'source')
        launcher = self.source / '.venv/Scripts/python.exe'; launcher.unlink()
        self.assertIn('独立依赖环境', deployment.installation_error(self.root))
        launcher.write_bytes(b'launcher')
        deployment.write_json(self.models / 'linshe-model-version.json', {})
        self.assertIn('模型版本不匹配', deployment.installation_error(self.root))

    def test_partial_download_has_no_completion_manifest(self):
        (self.models / 'linshe-model-files.json').unlink()
        self.assertIn('部署不完整', deployment.installation_error(self.root))

    def test_removed_saved_selections_migrate_and_paths_cannot_escape_runtime(self):
        for previous in ('2.5', 'voxcpm-2.0'):
            self.assertEqual(deployment.model_id(previous), '2.0')
        with self.assertRaises(ValueError): deployment.model_directory(self.root, '../other')
        deployment.write_json(self.root / 'runtime/runtime.json', {'python_home': '../outside'})
        with self.assertRaisesRegex(ValueError, '越界'): deployment.prepare_runtime(self.root)

    def test_runtime_repair_is_idempotent_and_pth_is_safe_for_chinese_windows_paths(self):
        deployment.prepare_runtime(self.root)
        cfg = self.source / '.venv/pyvenv.cfg'; content = cfg.read_text()
        self.assertIn(str(self.root / 'runtime/python/cpython'), content); self.assertNotIn('old', content)
        self.assertIn('3.11.13', content)
        deployment.prepare_runtime(self.root); self.assertEqual(content, cfg.read_text())
        editable = (self.source / '.venv/Lib/site-packages/_editable_impl_indextts.pth').read_text()
        self.assertTrue(editable.isascii()); self.assertIn(ascii(str(self.source)), editable)

    def test_legacy_migration_keeps_20_weights_and_never_overwrites_new_install(self):
        self.source.rename(self.root / 'runtime/index-tts'); self.models.rename(self.root / 'runtime/checkpoints-2.0')
        deployment.migrate_legacy(self.root); self.assertIsNone(deployment.installation_error(self.root))
        self.write('runtime/checkpoints-2.0/gpt.pth', b'old-duplicate')
        deployment.migrate_legacy(self.root)
        self.assertEqual((self.models / 'gpt.pth').read_bytes(), b'model-data')

    def test_full_package_excludes_removed_engines_and_legacy_weights(self):
        self.write('runtime/checkpoints/gpt.pth', b'removed-2.5')
        self.write('runtime/voxcpm-2.0/checkpoints/model.safetensors', b'removed-engine')
        self.write('runtime/unrelated/large.bin', b'irrelevant')
        self.write('runtime/indextts-2.0/source/__pycache__/scratch.pyc', b'cache')
        output = Path(self.directory.name) / 'package.zip'
        pack_runtime.pack_runtime(self.root, output)
        with ZipFile(output) as archive:
            names = archive.namelist()
            self.assertIn('runtime/indextts-2.0/source/.venv/Scripts/python.exe', names)
            self.assertEqual({name.split('/')[1] for name in names}, {'python', 'tools', 'runtime.json', 'selected-model.json', 'indextts-2.0'})
            self.assertFalse(any('__pycache__' in name or 'voxcpm' in name for name in names))
            target = Path(self.directory.name) / '离线语音' / 'tts-service'; archive.extractall(target)
        shutil.copyfile(self.root / 'versions-2.0.json', target / 'versions-2.0.json')
        deployment.prepare_runtime(target); self.assertIsNone(deployment.installation_error(target))
        self.assertEqual(deployment.read_json(target / 'runtime/selected-model.json'), {'model': '2.0'})
        self.assertTrue(output.with_suffix('.zip.sha256').is_file())

    def test_legacy_25_weights_are_archived_without_deletion_or_overwrite(self):
        self.write('runtime/checkpoints/gpt.pth', b'old-25')
        deployment.write_json(self.root / 'runtime/checkpoints/linshe-model-version.json', {'model_repo': 'IndexTeam/IndexTTS-2.5'})
        deployment.migrate_legacy(self.root)
        self.assertFalse((self.root / 'runtime/checkpoints').exists())
        archive = self.root / 'cache/retired-indextts-2.5/gpt.pth'
        self.assertEqual(archive.read_bytes(), b'old-25')
        self.write('runtime/checkpoints/gpt.pth', b'another-copy')
        deployment.write_json(self.root / 'runtime/checkpoints/linshe-model-version.json', {'model_repo': 'IndexTeam/IndexTTS-2.5'})
        deployment.migrate_legacy(self.root); self.assertEqual(archive.read_bytes(), b'old-25')
        self.assertEqual((self.root / 'runtime/checkpoints/gpt.pth').read_bytes(), b'another-copy')

    def test_model_only_package_contains_no_shared_tools_or_selection(self):
        output = Path(self.directory.name) / 'model.zip'
        pack_runtime.pack_runtime(self.root, output, model_only=True)
        with ZipFile(output) as archive:
            self.assertTrue(all(name.startswith('runtime/indextts-2.0/') for name in archive.namelist()))

    def test_inference_package_and_compaction_preserve_runtime_dependencies(self):
        library = self.source / '.venv/Lib/site-packages/torch/lib'
        static = library / 'dnnl.lib'
        dll = library / 'torch_cpu.dll'
        player = self.root / 'runtime/tools/ffmpeg/bin/ffplay.exe'
        duplicate = self.models / 'hf_cache/semantic_codec/model.safetensors'
        canonical = self.models / 'hf_cache/semantic_codec_model.safetensors'
        for path, data in ((static, b'compile-only'), (dll, b'runtime'),
                           (player, b'player'), (duplicate, canonical.read_bytes())):
            self.write_path(path, data)
        expected = sum(path.stat().st_size for path in (static, player, duplicate))
        self.assertEqual(compact_runtime.compact_runtime(self.root), expected)
        self.assertTrue(static.exists())
        output = Path(self.directory.name) / 'compact.zip'
        pack_runtime.pack_runtime(self.root, output)
        with ZipFile(output) as archive:
            names = archive.namelist()
            for path in (static, player, duplicate):
                self.assertNotIn(path.relative_to(self.root).as_posix(), names)
            for path in (dll, canonical, self.root / 'runtime/tools/ffmpeg/bin/ffmpeg.exe',
                         self.root / 'runtime/tools/ffmpeg/bin/ffprobe.exe'):
                self.assertIn(path.relative_to(self.root).as_posix(), names)
        self.assertEqual(compact_runtime.compact_runtime(self.root, apply=True), expected)
        self.assertTrue(dll.exists()); self.assertTrue(canonical.exists())
        self.assertIsNone(deployment.installation_error(self.root))
        self.assertEqual(compact_runtime.compact_runtime(self.root, apply=True), 0)

    def test_compaction_keeps_different_duplicate_and_rejects_incomplete_install(self):
        duplicate = self.models / 'hf_cache/semantic_codec/model.safetensors'
        self.write_path(duplicate, b'other-data')
        self.assertNotIn(duplicate, compact_runtime.removable_files(self.root))
        (self.models / 'hf_cache/semantic_codec_model.safetensors').unlink()
        with self.assertRaises(ValueError):
            compact_runtime.compact_runtime(self.root, apply=True)
        self.assertTrue(duplicate.exists())

    def test_compaction_rejects_external_library_symlink(self):
        outside = Path(self.directory.name) / 'external.lib'
        outside.write_bytes(b'keep')
        link = self.source / '.venv/Lib/site-packages/torch/lib/external.lib'
        link.parent.mkdir(parents=True)
        try:
            link.symlink_to(outside)
        except OSError:
            self.skipTest('symlink creation unavailable')
        with self.assertRaisesRegex(ValueError, '越界'):
            compact_runtime.compact_runtime(self.root, apply=True)
        self.assertEqual(outside.read_bytes(), b'keep')

    def test_semantic_download_is_promoted_without_duplicate_weights(self):
        canonical = self.models / 'hf_cache/semantic_codec_model.safetensors'
        canonical.unlink()
        downloaded = self.models / 'hf_cache/semantic_codec/model.safetensors'
        def download(**kwargs):
            self.assertEqual(kwargs['filename'], 'semantic_codec/model.safetensors')
            self.write_path(downloaded, b'completed-model')
            return str(downloaded)
        hub = types.SimpleNamespace(snapshot_download=lambda **kwargs: None, hf_hub_download=download)
        with patch.dict(sys.modules, {'huggingface_hub': hub}):
            download_model.download_models(self.root)
        self.assertEqual(canonical.read_bytes(), b'completed-model')
        self.assertFalse(downloaded.exists())
        self.assertIsNone(deployment.installation_error(self.root))

    def test_downloader_uses_only_pinned_index_files_and_existing_auxiliaries(self):
        calls = []
        before = (self.models / 'hf_cache/bigvgan/bigvgan_generator.pt').read_bytes()
        hub = types.SimpleNamespace(snapshot_download=lambda **kwargs: calls.append(kwargs), hf_hub_download=lambda **kwargs: self.fail('local auxiliaries already complete'))
        with patch.dict(sys.modules, {'huggingface_hub': hub}): download_model.download_models(self.root)
        self.assertEqual(len(calls), 1); self.assertEqual(calls[0]['revision'], 'pinned-2.0')
        self.assertEqual(calls[0]['repo_id'], 'IndexTeam/IndexTTS-2')
        self.assertEqual(set(calls[0]['allow_patterns']), {name for name in deployment.MODEL_20_FILES if not name.startswith('hf_cache/')})
        self.assertEqual((self.models / 'hf_cache/bigvgan/bigvgan_generator.pt').read_bytes(), before)
        self.assertIsNone(deployment.installation_error(self.root))


if __name__ == '__main__': unittest.main()
