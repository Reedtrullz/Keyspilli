"""Offline compatibility checker contracts; fixtures are synthetic software controls."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import stat
import sys
import tempfile
import unittest
from unittest import mock
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/check-keyspilli-plugin.py'


class CheckerTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'missing runnable extracted-plugin compatibility checker')
        spec = importlib.util.spec_from_file_location('check_keyspilli_plugin', SCRIPT)
        self.checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.checker)
        self.tmp = tempfile.TemporaryDirectory(prefix='keyspilli-compat-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'plugin'
        self.skill = self.source / 'skills/keyspilli-song'
        (self.source / '.codex-plugin').mkdir(parents=True)
        (self.skill / 'agents').mkdir(parents=True)
        (self.skill / 'scripts').mkdir()
        (self.skill / 'references').mkdir()
        self.metadata = {'name': 'keyspilli', 'version': '0.1.0+test', 'skills': './skills/',
                         'description': 'Synthetic fixture', 'interface': {'displayName': 'Keyspilli'}}
        self.write_metadata()
        (self.skill / 'SKILL.md').write_text('---\nname: keyspilli-song\ndescription: Synthetic ordinary preparation fixture.\n---\n[Check](references/check.md#supported)\n')
        (self.skill / 'references/check.md').write_text('# Supported\n')
        (self.skill / 'agents/openai.yaml').write_text('interface:\n  display_name: "Keyspilli Song"\n  short_description: "Synthetic check"\n  default_prompt: "Use $keyspilli-song for the fixture."\n')
        for helper in self.checker.HELPERS:
            (self.skill / 'scripts' / helper).write_text('print("synthetic helper")\n')

    def write_metadata(self):
        (self.source / '.codex-plugin/plugin.json').write_text(json.dumps(self.metadata))

    def archive(self, name='README.md', content=b'fixture'):
        path = self.root / 'candidate.zip'
        with zipfile.ZipFile(path, 'w') as archive:
            item = zipfile.ZipInfo(name)
            item.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(item, content)
        manifest = {'archiveSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'members': [{'name': name, 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}]}
        return path, manifest

    def preparation(self):
        run = self.root / 'run'
        bundle, installed, data = (run / name for name in ('bundle', 'installed', 'data'))
        source_sha = 'a' * 64
        base = 'upload-' + source_sha
        files = {}
        for name in ['artifacts/manifest.json', *[f'artifacts/{level}/{filename}' for level in self.checker.LEVELS for filename in ('notes.json', 'variant.mid', 'variant.xml')], 'rows.json', 'timeline.json', 'playback.json', 'chords.mid', 'chords.musicxml']:
            target = bundle / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'synthetic pinned artifact')
            files[name] = hashlib.sha256(target.read_bytes()).hexdigest()
            if name.startswith('artifacts/'):
                for catalog in (data, installed):
                    dest = catalog / 'artifacts' / base / name.removeprefix('artifacts/')
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(target.read_bytes())
        rows = [{'id': base + '-' + level, 'baseId': base, 'level': level} for level in self.checker.LEVELS]
        (bundle / 'rows.json').write_text(json.dumps(rows))
        files['rows.json'] = hashlib.sha256((bundle / 'rows.json').read_bytes()).hexdigest()
        (bundle / 'bundle.json').write_text(json.dumps({'schemaVersion': 1, 'baseId': base, 'files': files}))
        bundle_hash = hashlib.sha256((bundle / 'bundle.json').read_bytes()).hexdigest()
        (installed / 'bundle-install.json').write_text(json.dumps({'bundleHash': bundle_hash, 'baseId': base, 'status': 'verified'}))
        for catalog in (data, installed):
            with sqlite3.connect(catalog / 'db.sqlite') as db:
                db.execute('CREATE TABLE songs (id TEXT, base_id TEXT, level TEXT)')
                db.executemany('INSERT INTO songs VALUES (?,?,?)', [(r['id'], base, r['level']) for r in rows])
        result = {'baseId': base, 'sourceSha256': source_sha, 'bundle': str(bundle), 'installed': str(installed),
                  'status': 'provisional', 'checks': {'freshImport': True, 'musicalIdempotence': True}}
        (run / 'result.json').write_text(json.dumps(result))
        return run, source_sha

    def test_metadata_and_packaged_fragment_are_checked_without_version_adoption(self):
        result = self.checker.validate_metadata(self.source)
        self.assertEqual(result['pluginVersion'], '0.1.0+test')
        self.assertEqual(result['skillName'], 'keyspilli-song')
        self.assertEqual(len(result['references']), 1)
        self.assertEqual(json.loads((self.source / '.codex-plugin/plugin.json').read_text()), self.metadata)

    def test_refuses_misdirected_skill_directory(self):
        self.metadata['skills'] = '../other/'
        self.write_metadata()
        with self.assertRaisesRegex(ValueError, 'metadata|skills'):
            self.checker.validate_metadata(self.source)

    def test_refuses_wrong_skill_frontmatter(self):
        (self.skill / 'SKILL.md').write_text('---\nname: wrong\ndescription: fixture\n---\n')
        with self.assertRaisesRegex(ValueError, 'skill|frontmatter'):
            self.checker.validate_metadata(self.source)

    def test_refuses_missing_packaged_reference_fragment(self):
        (self.skill / 'references/check.md').write_text('# Different\n')
        with self.assertRaisesRegex(ValueError, 'fragment'):
            self.checker.validate_metadata(self.source)

    def test_refuses_an_unreviewed_sixth_packaged_helper(self):
        (self.skill / 'scripts/unreviewed.py').write_text('raise RuntimeError("must not execute")')
        with self.assertRaisesRegex(ValueError, 'helper'):
            self.checker.validate_metadata(self.source)

    def test_extracts_only_exact_hashed_archive_members(self):
        archive, manifest = self.archive()
        self.checker.extract_package(archive, self.root / 'extracted', manifest)
        self.assertEqual((self.root / 'extracted/README.md').read_bytes(), b'fixture')

    def test_refuses_archive_payload_hash_mismatch(self):
        archive, manifest = self.archive()
        manifest['members'][0]['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'hash|digest'):
            self.checker.extract_package(archive, self.root / 'extracted', manifest)

    def test_refuses_archive_path_traversal_even_in_claimed_inventory(self):
        archive, manifest = self.archive('../outside')
        with self.assertRaisesRegex(ValueError, 'path|member'):
            self.checker.extract_package(archive, self.root / 'extracted', manifest)
        self.assertFalse((self.root / 'outside').exists())

    def test_ordinary_route_allows_absent_or_incompatible_optional_capabilities(self):
        root = self.root.resolve()
        value = {'checkout': str(root), 'node_executable': '/explicit/node', 'errors': [],
                 'preparation': {'route': 'ordinary', 'status': 'compatible', 'command': ['/explicit/node', '--import', 'tsx', str(root / 'apps/web/scripts/prepare-song.mts')]},
                 'host_workflow': {'status': 'absent'}, 'audio_review': {'status': 'incompatible'}}
        self.assertEqual(self.checker.validate_preflight(value, root, '/explicit/node'), value['preparation']['command'])
        changed = copy.deepcopy(value)
        changed['checkout'] = str(root / 'other')
        with self.assertRaisesRegex(ValueError, 'checkout'):
            self.checker.validate_preflight(changed, root, '/explicit/node')
        changed = copy.deepcopy(value)
        changed['preparation']['command'][0] = 'different-node'
        with self.assertRaisesRegex(ValueError, 'command|runtime'):
            self.checker.validate_preflight(changed, root, '/explicit/node')

    def test_report_is_exclusive_before_any_package_or_catalog_work(self):
        report = self.root / 'existing.json'
        report.write_bytes(b'previous evidence')
        with self.assertRaises(FileExistsError):
            self.checker.check(self.source, self.root, '/unavailable/node', report)
        self.assertEqual(report.read_bytes(), b'previous evidence')

    def test_actual_preparation_inspector_requires_two_complete_catalogs_and_exact_artifacts(self):
        run, source = self.preparation()
        result = self.checker.inspect_preparation(run, source)
        self.assertEqual(result['catalogRows'], {'source': 6, 'installed': 6})
        self.assertEqual(result['levels'], list(self.checker.LEVELS))
        self.assertEqual(result['status'], 'provisional')

    def test_inspector_refuses_fabricated_success_flags(self):
        run, source = self.preparation()
        value = json.loads((run / 'result.json').read_text())
        value['checks']['freshImport'] = 'true'
        (run / 'result.json').write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'freshImport|preparation'):
            self.checker.inspect_preparation(run, source)

    def test_inspector_refuses_five_actual_installed_variants_despite_success_flags(self):
        run, source = self.preparation()
        with sqlite3.connect(run / 'installed/db.sqlite') as db:
            db.execute("DELETE FROM songs WHERE level='vb'")
        with self.assertRaisesRegex(ValueError, 'six|catalog'):
            self.checker.inspect_preparation(run, source)

    def test_inspector_refuses_changed_installed_note_artifacts(self):
        run, source = self.preparation()
        (run / 'installed/artifacts' / ('upload-' + source) / 'a/notes.json').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'artifact|hash'):
            self.checker.inspect_preparation(run, source)

    def test_owned_command_timeout_is_reported_as_failure(self):
        checks = []
        with self.assertRaisesRegex(ValueError, 'timeout'):
            self.checker.run_command([sys.executable, '-c', 'import time; time.sleep(5)'], self.root, {}, checks, timeout=.05)
        self.assertTrue(checks[0]['timedOut'])

    def test_report_refuses_leftover_temporary_catalog_or_package(self):
        members = sorted([p.relative_to(self.source).as_posix() for p in self.source.rglob('*') if p.is_file()] + ['source-members.json'])
        (self.source / 'source-members.json').write_text(json.dumps({
            'members': members, 'sha256': {name: hashlib.sha256((self.source / name).read_bytes()).hexdigest()
                                         for name in members if name != 'source-members.json'}}))
        real_temporary = tempfile.TemporaryDirectory
        node = str(Path(sys.executable).resolve())
        preflight = {'checkout': str(self.root), 'node_executable': node, 'errors': [],
                     'preparation': {'route': 'ordinary', 'status': 'compatible',
                                     'command': [node, '--import', 'tsx', str(self.root / 'apps/web/scripts/prepare-song.mts')]}}

        def command(argv, *_args, **_kwargs):
            if '-e' in argv:
                return json.dumps({'node': 'v22.22.3'})
            if 'rev-parse' in argv:
                return 'synthetic-checkout'
            if '--discover' in argv:
                return json.dumps(preflight)
            if '--help' in argv:
                return 'Usage: render-midi.ts --input FILE --output FILE --soundfont'
            return ''

        for leak in ('keyspilli-plugin-smoke-', 'keyspilli-plugin-check-'):
            with self.subTest(leak=leak):
                retained = []

                class LeakingTemporary:
                    def __init__(self, *args, **kwargs):
                        self.original = real_temporary(*args, **kwargs)
                        self.leak = kwargs.get('prefix') == leak
                        retained.append(self.original)

                    def __enter__(self):
                        return self.original.__enter__()

                    def __exit__(self, *args):
                        if not self.leak:
                            self.original.__exit__(*args)

                try:
                    with mock.patch.object(self.checker.tempfile, 'TemporaryDirectory', LeakingTemporary), \
                            mock.patch.object(self.checker, 'run_command', side_effect=command), \
                            mock.patch.object(self.checker, 'inspect_preparation', return_value={'status': 'provisional'}):
                        result = self.checker.check(self.source, self.root, node, self.root / (leak + 'report.json'))
                    self.assertEqual(result['status'], 'failed')
                    self.assertRegex(result['error'], 'temporary.*remains')
                    field = 'temporaryCatalogsRemoved' if leak == 'keyspilli-plugin-smoke-' else 'temporaryPackageRemoved'
                    self.assertIsNot(result.get(field), True)
                finally:
                    for directory in retained:
                        directory.cleanup()

    def test_ci_uses_pinned_runtime_and_offline_checker_without_release_actions(self):
        text = (ROOT / '.github/workflows/keyspilli-plugin-compatibility.yml').read_text()
        self.assertIn("node-version: '22.22.3'", text)
        self.assertIn('pnpm install --frozen-lockfile', text)
        self.assertIn('python -B scripts/check-keyspilli-plugin.py', text)
        self.assertIn('persist-credentials: false', text)
        self.assertNotIn('contents: write', text)
        self.assertNotIn('pip install', text)


if __name__ == '__main__':
    unittest.main()
