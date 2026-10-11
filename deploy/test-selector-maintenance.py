import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('maintenance', Path(__file__).with_name('check-selector-maintenance.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads(Path(__file__).with_name('selector-maintenance.json').read_text())
        self.changed = release.APPLICATION | release.RELEASE
        self.hashes = self.manifest['applicationFiles'].copy()

    def test_exact_backport_passes(self):
        self.assertTrue(release.validate(self.manifest, self.changed, self.hashes))

    def test_music_worker_dependency_or_missing_change_refuses(self):
        for path in ['catalog/manifest.json', 'packages/player-core/src/playback.ts', 'services/transcribe/src/index.ts', 'package-lock.json']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                release.validate(self.manifest, self.changed | {path}, self.hashes)
        with self.assertRaises(ValueError):
            release.validate(self.manifest, self.changed - {next(iter(release.APPLICATION))}, self.hashes)

    def test_other_baseline_operation_or_musical_claim_refuses(self):
        for key, value in [('baselineCommit', 'a' * 40), ('operation', 'rebuild_all'), ('musicalQualification', 'passed')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.validate({**self.manifest, key: value}, self.changed, self.hashes)

    def test_unreviewed_bytes_refuse(self):
        self.hashes[next(iter(release.APPLICATION))] = 'a' * 64
        with self.assertRaises(ValueError):
            release.validate(self.manifest, self.changed, self.hashes)

if __name__ == '__main__':
    unittest.main()
