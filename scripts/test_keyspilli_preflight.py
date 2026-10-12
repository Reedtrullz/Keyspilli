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
        fingerprint_files = (name for name in preflight.DETERMINISTIC_REQUIRED
                             if name not in ('package.json', preflight.OPTIONAL['deterministic_workflow_script']))
        for name in (*preflight.REQUIRED, *fingerprint_files, 'node_modules/.bin/tsx'):
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
        self.assertEqual(result['deterministic_workflow']['status'], 'absent')

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

    def deterministic_caps(self):
        return {'schemaVersion': 1, 'deterministicPreparationContractVersions': [1],
                'sourceFormats': ['midi'], 'resume': True, 'readOnlyVerify': True,
                'maxPreparationAttempts': 3, 'automaticRetries': False, 'providerCalls': 0,
                'productionAdmission': False, 'implementationSha256': 'a' * 64}

    def probe_deterministic(self, caps):
        script = self.root / 'apps/web/scripts/prepare-workflow.mts'
        script.write_text('fixture')
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(caps))), \
             patch.object(preflight, 'deterministic_implementation_fingerprint', return_value='a' * 64):
            return preflight.check_deterministic_preparation_capabilities(self.root, NODE)

    def test_deterministic_workflow_is_distinct_from_experimental_protocol(self):
        result = self.probe_deterministic(self.deterministic_caps())
        self.assertEqual(result['status'], 'compatible', result)
        self.assertEqual(result['command'], [NODE, '--import', 'tsx', str(self.root / 'apps/web/scripts/prepare-workflow.mts')])
        self.assertEqual(preflight.check_workflow_capabilities(self.root, NODE)['status'], 'absent')

    def test_deterministic_workflow_rejects_stale_implementation(self):
        caps = self.deterministic_caps()
        caps['implementationSha256'] = 'b' * 64
        result = self.probe_deterministic(caps)
        self.assertEqual(result['status'], 'incompatible')
        self.assertFalse(result.get('command'))
        self.assertIn('implementationSha256', [item['field'] for item in result['incompatibilities']])

    def test_deterministic_workflow_checks_exact_bounds_and_protocol_types(self):
        for changed in ({'maxPreparationAttempts': 4}, {'providerCalls': False},
                        {'deterministicPreparationContractVersions': [True]},
                        {'sourceFormats': ['midi', 'musicxml']}, {'readOnlyVerify': False},
                        {'automaticRetries': True}, {'productionAdmission': True},
                        {'decisionContractVersions': [2]}):
            with self.subTest(changed=changed):
                result = self.probe_deterministic({**self.deterministic_caps(), **changed})
                self.assertEqual(result['status'], 'incompatible', result)
                self.assertFalse(result.get('command'))

    def test_deterministic_optional_probe_failure_does_not_disable_ordinary_preparation(self):
        with patch.object(preflight, 'check_deterministic_preparation_capabilities', return_value={'status': 'incompatible'}):
            code, result = self.run_cli()
        self.assertEqual(code, 0, result)
        self.assertEqual(result['preparation']['status'], 'compatible')
        self.assertEqual(result['deterministic_workflow']['status'], 'incompatible')

    def test_deterministic_probe_excludes_injected_runtime_and_production_environment(self):
        (self.root / 'apps/web/scripts/prepare-workflow.mts').write_text('fixture')
        unsafe = {'NODE_OPTIONS': '--require /untrusted.js', 'NODE_PATH': '/untrusted',
                  'TSX_TSCONFIG_PATH': '/untrusted.json', 'KEYSPILLI_DATA_DIR': '/production',
                  'OPENAI_API_KEY': 'synthetic-control-not-a-key'}
        with patch.dict(os.environ, unsafe), \
             patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(self.deterministic_caps()))) as child, \
             patch.object(preflight, 'deterministic_implementation_fingerprint', return_value='a' * 64):
            result = preflight.check_deterministic_preparation_capabilities(self.root, NODE)
        self.assertEqual(result['status'], 'compatible', result)
        for key in unsafe:
            self.assertNotIn(key, child.call_args.kwargs['env'])

    def test_deterministic_probe_rejects_entrypoint_symlink_before_execution(self):
        script = self.root / 'apps/web/scripts/prepare-workflow.mts'
        outside = self.root / 'outside.mts'
        outside.write_text('must not execute')
        script.symlink_to(outside)
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(self.deterministic_caps()))) as child, \
             patch.object(preflight, 'deterministic_implementation_fingerprint', side_effect=ValueError('symlink refused')):
            result = preflight.check_deterministic_preparation_capabilities(self.root, NODE)
        self.assertEqual(result['status'], 'incompatible', result)
        child.assert_not_called()

    def test_deep_capability_json_remains_optional_incompatible(self):
        (self.root / 'apps/web/scripts/prepare-workflow.mts').write_text('fixture')
        for depth in (2000, 10000):
            output = json.dumps(self.deterministic_caps())[:-1] + ',"nested":' + '[' * depth + '0' + ']' * depth + '}'
            with self.subTest(depth=depth), \
                 patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=output)), \
                 patch.object(preflight, 'deterministic_implementation_fingerprint', return_value='a' * 64):
                result = preflight.check_deterministic_preparation_capabilities(self.root, NODE)
                self.assertEqual(result['status'], 'incompatible', result)
                self.assertLess(len(json.dumps(result, indent=2)), 4096)

    def test_deterministic_probe_rejects_symlinked_source_parent_before_execution(self):
        parent = self.root / 'apps/web/scripts'
        parent.rename(self.root / 'source-scripts')
        (self.root / 'source-scripts/prepare-workflow.mts').write_text('must not execute')
        parent.symlink_to(self.root / 'source-scripts', target_is_directory=True)
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(self.deterministic_caps()))) as child, \
             patch.object(preflight, 'deterministic_implementation_fingerprint', return_value='a' * 64):
            result = preflight.check_deterministic_preparation_capabilities(self.root, NODE)
        self.assertEqual(result['status'], 'incompatible', result)
        child.assert_not_called()

    def test_deterministic_probe_does_not_retain_invalid_nested_known_fields(self):
        for changed in ({'implementationSha256': {'nested': [1]}},
                        {'sourceFormats': [['midi']]}, {'schemaVersion': {'nested': 1}}):
            with self.subTest(changed=changed):
                result = self.probe_deterministic({**self.deterministic_caps(), **changed})
                self.assertEqual(result['status'], 'incompatible', result)
                self.assertNotIn('capabilities', result)

    def test_deterministic_fingerprint_refuses_an_ignored_entrypoint(self):
        script = self.root / 'apps/web/scripts/prepare-workflow.mts'
        script.write_text('must be covered by the independent fingerprint')
        (self.root / '.gitignore').write_text('apps/web/scripts/prepare-workflow.mts\n')
        with self.assertRaisesRegex(ValueError, 'entrypoint|inventory'):
            preflight.deterministic_implementation_fingerprint(self.root)

    def test_deterministic_probe_refuses_working_changes_during_execution(self):
        (self.root / 'apps/web/scripts/prepare-workflow.mts').write_text('fixture')
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(self.deterministic_caps()))), \
             patch.object(preflight, 'deterministic_implementation_fingerprint', side_effect=['a' * 64, 'b' * 64]):
            result = preflight.check_deterministic_preparation_capabilities(self.root, NODE)
        self.assertEqual(result['status'], 'incompatible', result)
        self.assertFalse(result.get('command'))

    def test_deterministic_fingerprint_detects_working_source_configuration_and_catalog_changes(self):
        (self.root / 'apps/web/scripts/prepare-workflow.mts').write_text('fixture')
        first = preflight.deterministic_implementation_fingerprint(self.root)
        source = self.root / 'packages/midi/src/probe.ts'
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text('export const value = 1;')
        second = preflight.deterministic_implementation_fingerprint(self.root)
        self.assertNotEqual(first, second)
        source.write_text('export const value = 2;')
        third = preflight.deterministic_implementation_fingerprint(self.root)
        self.assertNotEqual(second, third)
        config = self.root / 'apps/web/tsconfig.song-tools.json'
        config.write_text('{}')
        fourth = preflight.deterministic_implementation_fingerprint(self.root)
        self.assertNotEqual(third, fourth)
        catalog = self.root / 'catalog/chord-sources.json'
        catalog.parent.mkdir(exist_ok=True)
        catalog.write_text('{"schemaVersion":1,"entries":[]}')
        fifth = preflight.deterministic_implementation_fingerprint(self.root)
        self.assertNotEqual(fourth, fifth)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True, capture_output=True)
        self.assertEqual(fifth, preflight.deterministic_implementation_fingerprint(self.root))

    def test_deterministic_fingerprint_refuses_symlinks_and_oversized_files(self):
        (self.root / 'apps/web/scripts/prepare-workflow.mts').write_text('fixture')
        source = self.root / 'packages/midi/src/probe.ts'
        source.parent.mkdir(parents=True, exist_ok=True)
        source.symlink_to(self.root / 'package.json')
        with self.assertRaisesRegex(ValueError, 'symlink|regular'):
            preflight.deterministic_implementation_fingerprint(self.root)
        source.unlink()
        with source.open('wb') as output:
            output.truncate(16 * 1024 * 1024 + 1)
        with self.assertRaisesRegex(ValueError, 'bound|limit'):
            preflight.deterministic_implementation_fingerprint(self.root)

    def test_deterministic_fingerprint_refuses_path_escape_before_reading(self):
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=b'../outside\0')):
            with self.assertRaisesRegex(ValueError, 'path'):
                preflight.deterministic_implementation_fingerprint(self.root)


if __name__ == '__main__':
    unittest.main()
