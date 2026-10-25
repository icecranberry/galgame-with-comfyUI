"""Cortico deployment config migration and extension manifest wiring."""
import json
import tempfile
import unittest
from pathlib import Path

from launcher.launcher.cortico_runner import (
    EXTENSION_LINKS,
    ensure_extensions,
    migrate_qq_segmentation,
)


def make_project(root, config=None):
    project = root / 'project'
    for relative in EXTENSION_LINKS.values():
        # 'link:../../agent-core/...' → project/agent-core/...
        (project / relative[len('link:'):].lstrip('./')).mkdir(parents=True, exist_ok=True)
    if config is not None:
        deployment = project / 'Cortico' / 'deployments' / 'linshe'
        deployment.mkdir(parents=True)
        (deployment / 'config.json').write_text(json.dumps(config), encoding='utf-8')
    return project


def emitted():
    lines = []
    return (lambda key, text: lines.append(f'{key}: {text}')), lines


class MigrationTest(unittest.TestCase):
    def test_copies_qq_section_to_qq_linshe_and_disables_legacy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = {'worlds': {'qq': {'enabled': True, 'wsUrl': 'ws://x', 'groups': [{'id': 1, 'enabled': True}]}}}
            project = make_project(root, config)
            append, lines = emitted()
            migrate_qq_segmentation(project, append)
            migrated = json.loads((project / 'Cortico' / 'deployments' / 'linshe' / 'config.json').read_text(encoding='utf-8'))
            segment = migrated['worlds']['qq-linshe']
            self.assertTrue(segment['enabled'])
            self.assertEqual(segment['wsUrl'], 'ws://x')
            self.assertEqual(segment['groups'], [{'id': 1, 'enabled': True}])
            self.assertFalse(migrated['worlds']['qq']['enabled'])
            self.assertIn('worlds.qq → worlds.qq-linshe', lines[0])
            # 幂等：第二次运行不再改动。
            migrate_qq_segmentation(project, append)
            again = json.loads((project / 'Cortico' / 'deployments' / 'linshe' / 'config.json').read_text(encoding='utf-8'))
            self.assertEqual(again, migrated)
            self.assertEqual(len(lines), 1)

    def test_skips_without_config_or_legacy_section(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = make_project(root)
            append, _ = emitted()
            migrate_qq_segmentation(project, append)  # 无 config.json 不抛错
            fresh = make_project(root / 'a', {'worlds': {'console': {'enabled': True}}})
            migrate_qq_segmentation(fresh, append)
            self.assertEqual(list(json.loads((fresh / 'Cortico' / 'deployments' / 'linshe' / 'config.json').read_text(encoding='utf-8'))['worlds']), ['console'])
            already = make_project(root / 'b', {'worlds': {'qq': {'enabled': True}, 'qq-linshe': {'enabled': False}}})
            migrate_qq_segmentation(already, append)
            state = json.loads((already / 'Cortico' / 'deployments' / 'linshe' / 'config.json').read_text(encoding='utf-8'))
            self.assertTrue(state['worlds']['qq']['enabled'])


class ExtensionsManifestTest(unittest.TestCase):
    def test_manifest_links_all_packages_and_validates_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = make_project(Path(tmp))
            ensure_extensions(project)
            manifest = json.loads((project / 'Cortico' / 'extensions' / 'package.json').read_text(encoding='utf-8'))
            self.assertEqual(manifest['dependencies'], EXTENSION_LINKS)
            self.assertIn('cortico-world-qq-linshe', manifest['dependencies'])

    def test_missing_package_source_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / 'project'
            (project / 'Cortico' / 'extensions').mkdir(parents=True)
            with self.assertRaises(ValueError):
                ensure_extensions(project)


if __name__ == '__main__':
    unittest.main()
