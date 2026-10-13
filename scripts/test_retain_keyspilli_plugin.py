"""Authored software controls for retaining exact, already-tested plugin bytes."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('retain_test_packager', SCRIPTS / 'package-keyspilli-plugin.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class RetainTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='keyspilli-retain-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / 'plugin'
        self.source.mkdir()
        (self.source / 'README.md').write_text('Synthetic packaging control. Not a musical approval.\n')
        self.refresh_inventory()
        self.expected = packager.package(self.source, self.root / 'tested.zip', self.root / 'tested.json')
        self.receipt = {
            'schemaVersion': 1, 'kind': 'keyspilli-plugin-offline-compatibility',
            'status': 'passed', 'package': self.expected,
            'checkoutCommit': '1' * 40,
            'installedAdoption': False, 'productionAdmission': False,
            'musicalAcceptance': 'not-established',
            'temporaryCatalogsRemoved': True, 'temporaryPackageRemoved': True,
        }
        self.report = self.root / 'compatibility.json'
        self.destination = self.root / 'candidate'
        self.save_report()

    def refresh_inventory(self):
        (self.source / 'source-members.json').write_text(json.dumps({
            'members': ['README.md', 'source-members.json'],
            'sha256': {'README.md': hashlib.sha256((self.source / 'README.md').read_bytes()).hexdigest()},
        }))

    def save_report(self):
        self.report.write_text(json.dumps(self.receipt, sort_keys=True, indent=2) + '\n')

    def run_retain(self, destination=None):
        return subprocess.run([
            sys.executable, '-B', str(SCRIPTS / 'retain-keyspilli-plugin.py'),
            '--source', str(self.source), '--report', str(self.report),
            '--destination', str(destination or self.destination),
        ], capture_output=True, text=True, timeout=15)

    def assert_refused(self, reason):
        result = self.run_retain()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(reason, result.stderr, result.stderr)
        self.assertFalse(self.destination.exists())

    def test_retains_byte_identical_tested_package_manifest_and_report(self):
        result = self.run_retain()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(p.name for p in self.destination.iterdir()), [
            'compatibility.json', 'keyspilli.zip', 'package-manifest.json',
        ])
        self.assertEqual((self.destination / 'keyspilli.zip').read_bytes(), (self.root / 'tested.zip').read_bytes())
        self.assertEqual((self.destination / 'package-manifest.json').read_bytes(), (self.root / 'tested.json').read_bytes())
        self.assertEqual((self.destination / 'compatibility.json').read_bytes(), self.report.read_bytes())
        with zipfile.ZipFile(self.destination / 'keyspilli.zip') as archive:
            self.assertIsNone(archive.testzip())
            for member in self.expected['members']:
                self.assertEqual(hashlib.sha256(archive.read(member['name'])).hexdigest(), member['sha256'])
        summary = json.loads(result.stdout)
        self.assertEqual(summary['status'], 'retained')
        self.assertFalse(summary['installedAdoption'])
        self.assertFalse(summary['productionAdmission'])
        self.assertEqual(summary['musicalAcceptance'], 'not-established')

    def test_failed_compatibility_report_is_not_retained(self):
        self.receipt['status'] = 'failed'
        self.save_report()
        self.assert_refused('passed offline compatibility')

    def test_unrelated_report_kind_is_not_retained(self):
        self.receipt['kind'] = 'another-pipeline'
        self.save_report()
        self.assert_refused('passed offline compatibility')

    def test_changed_source_even_with_refreshed_inventory_is_not_retained(self):
        (self.source / 'README.md').write_text('Different plugin bytes.\n')
        self.refresh_inventory()
        self.assert_refused('differs from the tested package')

    def test_changed_manifest_fields_are_not_ignored(self):
        for field, value in (('archiveSha256', '0' * 64), ('sourceTreeSha256', '0' * 64),
                             ('members', []), ('checkedReferences', [{'from': 'absent', 'target': 'absent'}])):
            with self.subTest(field=field):
                original = copy.deepcopy(self.receipt)
                self.receipt['package'][field] = value
                self.save_report()
                self.assert_refused('differs from the tested package')
                self.receipt = original

    def test_musical_and_release_claims_cannot_enter_candidate_receipt(self):
        for field, value in (('installedAdoption', True), ('productionAdmission', True),
                             ('musicalAcceptance', 'approved'), ('temporaryCatalogsRemoved', False),
                             ('temporaryPackageRemoved', False)):
            with self.subTest(field=field):
                original = self.receipt[field]
                self.receipt[field] = value
                self.save_report()
                self.assert_refused('scope or cleanup')
                self.receipt[field] = original

    def test_existing_destination_is_never_overwritten(self):
        self.destination.mkdir()
        (self.destination / 'owner.txt').write_text('keep')
        result = self.run_retain()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('new destination', result.stderr)
        self.assertEqual((self.destination / 'owner.txt').read_text(), 'keep')
        self.assertEqual(len(list(self.destination.iterdir())), 1)

    def test_refuses_destination_inside_canonical_source(self):
        result = self.run_retain(self.source / 'candidate')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('outside the plugin source', result.stderr)
        self.assertFalse((self.source / 'candidate').exists())

    def test_refuses_duplicate_report_fields(self):
        raw = self.report.read_text().rstrip()
        self.report.write_text(raw[:-1] + ', "status": "passed"}\n')
        self.assert_refused('duplicate JSON field')

    def test_refuses_symlinked_report(self):
        target = self.report.with_suffix('.saved')
        self.report.rename(target)
        self.report.symlink_to(target)
        self.assert_refused('regular report')

    def test_refuses_oversized_report(self):
        self.report.write_bytes(b' ' * (16 * 1024 * 1024 + 1))
        self.assert_refused('report size')

    def test_bad_json_report_has_no_outputs(self):
        self.report.write_text('{')
        self.assert_refused('JSON')


if __name__ == '__main__':
    unittest.main()
