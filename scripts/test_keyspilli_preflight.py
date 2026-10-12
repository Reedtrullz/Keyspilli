"""CLI contracts: ordinary preparation survives missing optional capabilities."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'plugins/keyspilli/skills/keyspilli-song/scripts/check_checkout.py'
spec = importlib.util.spec_from_file_location('keyspilli_preflight', SCRIPT)
preflight = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = preflight
spec.loader.exec_module(preflight)
NODE = shutil.which('node')


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='keyspilli-preflight-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True, capture_output=True)
        (self.root / 'package.json').write_text(json.dumps({'name': 'keyspilli', 'engines': {'node': '>=22.22.3 <23'}}))
        for name in (*preflight.REQUIRED, 'node_modules/.bin/tsx'):
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('')
        (self.root / 'node_modules/.bin/tsx').chmod(0o700)
        self.sqlite = self.root / 'node_modules/better-sqlite3/index.js'
        self.sqlite.parent.mkdir(parents=True)
        self.sqlite.write_text("module.exports=class {constructor(p){if(p!==':memory:')throw Error('not isolated')}close(){}}")

    def run_cli(self, *args, free_gib=2):
        stream = io.StringIO()
        disk = shutil._ntuple_diskusage(40 * 2**30, (40-free_gib) * 2**30, free_gib * 2**30)
        with patch.object(sys, 'argv', [str(SCRIPT), str(self.root), '--node', NODE, *args]), patch.object(shutil, 'disk_usage', return_value=disk), contextlib.redirect_stdout(stream):
            code = preflight.main()
        return code, json.loads(stream.getvalue())

    def test_default_returns_executable_ordinary_route_with_small_read_only_budget(self):
        code, result = self.run_cli()
        self.assertEqual(code, 0, result)
        self.assertEqual(result['preparation']['route'], 'ordinary')
        self.assertEqual(result['preparation']['command'], [NODE, '--import', 'tsx', str(self.root / 'apps/web/scripts/prepare-song.mts')])
        self.assertEqual(result['host_workflow']['status'], 'absent')

    def test_discover_keeps_requested_git_checkout_without_experimental_driver(self):
        code, result = self.run_cli('--discover')
        self.assertEqual(code, 0, result)
        self.assertEqual(result['checkout'], str(self.root))
        self.assertEqual(result['preparation']['route'], 'ordinary')

    def test_source_archive_without_git_is_blocked_before_advertising_preparation(self):
        shutil.rmtree(self.root / '.git')
        for args in ((), ('--discover',)):
            with self.subTest(args=args):
                code, result = self.run_cli(*args)
                self.assertEqual(code, 1, result)
                self.assertIn('Git', ' '.join(result.get('errors', [])) + result.get('reason', ''))
                self.assertFalse(result.get('preparation', {}).get('command'))

    def test_nested_source_archive_cannot_borrow_an_unrelated_parent_git_root(self):
        parent = self.root
        nested = parent / 'nested-source'
        for name in ('apps', 'packages', 'node_modules'):
            shutil.copytree(parent / name, nested / name)
        shutil.copyfile(parent / 'package.json', nested / 'package.json')
        self.root = nested
        code, result = self.run_cli()
        self.assertEqual(code, 1, result)
        self.assertEqual(result['preparation']['status'], 'blocked')
        self.assertIn('Git', ' '.join(result['errors']))

    def test_missing_fingerprinted_source_is_reported_before_preparation(self):
        source = self.root / 'packages/midi/src/missing.ts'
        source.parent.mkdir(parents=True)
        source.write_text('fixture')
        subprocess.run(['git', 'add', str(source)], cwd=self.root, check=True, capture_output=True)
        source.unlink()
        code, result = self.run_cli()
        self.assertEqual(code, 1, result)
        self.assertEqual(result['preparation']['status'], 'blocked')
        self.assertIn('fingerprint', ' '.join(result['errors']))

    def test_optional_contract_failure_does_not_block_ordinary_path(self):
        with patch.object(preflight, 'check_audio_review_capabilities', return_value={'status': 'incompatible', 'reason': 'supports.maxOutputTokens expected 4096, actual 2048'}):
            code, result = self.run_cli()
        self.assertEqual(code, 0, result)
        self.assertEqual(result['audio_review']['status'], 'incompatible')
        self.assertEqual(result['preparation']['status'], 'compatible')

    def test_explicit_workload_budget_is_enforced(self):
        code, result = self.run_cli('--minimum-free-gib', '3')
        self.assertEqual(code, 1)
        self.assertIn('3', ' '.join(result['errors']))
        self.assertEqual(result['preparation']['status'], 'blocked')

    def test_wrong_runtime_remains_blocking(self):
        (self.root / 'package.json').write_text(json.dumps({'name': 'keyspilli', 'engines': {'node': '>=99 <100'}}))
        code, result = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn('Node', ' '.join(result['errors']))

    def test_sqlite_abi_failure_remains_blocking(self):
        self.sqlite.write_text("throw Error('ABI mismatch')")
        code, result = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn('native ABI', ' '.join(result['errors']))

    def test_missing_ordinary_entry_remains_blocking(self):
        (self.root / 'apps/web/scripts/prepare-song.mts').unlink()
        code, result = self.run_cli()
        self.assertEqual(code, 1)
        self.assertIn('apps/web/scripts/prepare-song.mts', result['missing'])

    def test_returned_node_is_absolute_even_when_runtime_discovery_returns_relative_path(self):
        lookup = shutil.which
        with patch.object(shutil, 'which', side_effect=lambda name: os.path.relpath(NODE) if name == NODE else lookup(name)):
            code, result = self.run_cli()
        self.assertEqual(code, 0, result)
        self.assertEqual(result['node_executable'], NODE)
        self.assertEqual(result['preparation']['command'][0], NODE)

    def test_audio_limit_drift_names_the_exact_expected_and_observed_limit(self):
        (self.root / preflight.OPTIONAL['audio_review_script']).write_text('fixture')
        caps = {'schemaVersion': 2, 'manifestSchemaVersion': 2, 'reportSchemaVersion': 2, 'provider': 'anti.listen',
                **{key: True for key in ('pairwiseAudio', 'dryRun', 'safeResume', 'validatesCompleteOutput', 'mapsSourceOutputAnchors', 'symbolicEvidenceSeparate', 'repairQueue', 'validatesOrderedSubmissionReceipt', 'validatesGatewayModelAllowlist', 'strictLiveStdout')},
                'requiresGatewayBackendAttemptLimit': 1, 'supports': {'maxClipBytes': 2*1024*1024, 'maxPairBytes': 4*1024*1024, 'maxClipSeconds': 30, 'maxOutputTokens': 2048, 'maxProviderCallsPerJob': 1}}
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(caps))):
            result = preflight.check_audio_review_capabilities(self.root, NODE)
        self.assertEqual(result['status'], 'incompatible')
        self.assertEqual(result.get('incompatibilities'), [{'field': 'supports.maxOutputTokens', 'expected': 4096, 'actual': 2048}])

    def test_malformed_optional_music_contract_reports_incompatible_without_crashing(self):
        for relative in ('apps/web/scripts/report-music-review.mts', 'packages/catalog/src/acoustic-receipt.ts',
                         'packages/catalog/src/acoustic-receipt-v1.schema.json', 'packages/catalog/src/music-benchmark.ts',
                         'apps/web/scripts/benchmark-music-review.mts', 'apps/web/scripts/preview-music-repair.mts',
                         'apps/web/src/lib/music-evidence-v1.schema.json'):
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('fixture')
        for value in (None, [], {'optionalBackends': None}):
            with self.subTest(value=value), patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(value))):
                self.assertEqual(preflight.check_music_review_capabilities(self.root, NODE)['status'], 'incompatible')


if __name__ == '__main__':
    unittest.main()
