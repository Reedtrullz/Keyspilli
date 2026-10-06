"""Serial bounded Player batch runner tests."""
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import player_input_batch as batch


class PlayerInputBatchTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='keyspilli-player-batch-')
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)

    def _request(self, name='request.json'):
        path = self.root / name
        path.write_text('{}')
        return path

    def _script(self, body):
        path = self.root / 'fake-analyzer.py'
        path.write_text('#!' + sys.executable + '\n' + body)
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
        return path

    def test_timeout_terminates_child_without_retry(self):
        script = self._script('import time\ntime.sleep(2)\n')
        output = self.root / 'case-timeout'
        result = batch.run_player_case(self._request(), output, python=script, timeout_seconds=.05)
        self.assertEqual(result['status'], 'timeout')
        self.assertGreaterEqual(result['wallSeconds'], .05)

    def test_preexisting_output_refuses_before_spawn(self):
        script = self._script('from pathlib import Path\nPath(__file__).with_name("spawned").write_text("x")\n')
        output = self.root / 'existing'
        output.mkdir()
        with self.assertRaises(FileExistsError):
            batch.run_player_case(self._request(), output, python=script)
        self.assertFalse((self.root / 'spawned').exists())

    def test_incomplete_case_is_not_success(self):
        script = self._script('import sys\nsys.exit(3)\n')
        result = batch.run_player_case(self._request(), self.root / 'case-failed', python=script)
        self.assertEqual(result['status'], 'failed')
        self.assertIsNone(result['receiptPath'])

    def test_wall_time_includes_validation(self):
        script = self._script(
            'import json,sys,time\nfrom pathlib import Path\n'
            'time.sleep(.12)\nout=Path(sys.argv[5]);out.mkdir()\n'
            'receipt={"schemaVersion":1,"kind":"keyspilli-player-input-evidence","status":"uncertain","historyPitchCandidates":None,"rawResidual":None,"resources":{"elapsedSeconds":.12,"peakRssBytes":1024},"limitations":["fixture"]}\n'
            '(out/"receipt.json").write_text(json.dumps(receipt))\n'
        )
        result = batch.run_player_case(self._request(), self.root / 'case-valid', python=script)
        self.assertEqual(result['status'], 'complete')
        self.assertGreaterEqual(result['wallSeconds'], .1)
        self.assertIsNotNone(result['receiptSha256'])

    def test_manifest_rejects_duplicate_foreign_or_unbounded_rows(self):
        path = self.root / 'manifest.json'
        for rows in (
            [{'id': 'a', 'requestPath': str(self._request('one.json'))}, {'id': 'a', 'requestPath': str(self._request('two.json'))}],
            [{'id': 'a', 'requestPath': str(self._request()), 'expected': [60]}],
            [{'id': '../escape', 'requestPath': str(self._request())}],
        ):
            path.write_text(json.dumps(rows))
            with self.assertRaises(ValueError):
                batch.validate_manifest(path)

    def test_nonfinite_or_oversized_resource_receipt_refuses(self):
        with self.assertRaises(ValueError):
            batch.validate_receipt({'schemaVersion': 1, 'kind': 'keyspilli-player-input-evidence', 'status': 'uncertain', 'historyPitchCandidates': None, 'rawResidual': None, 'resources': {'elapsedSeconds': float('nan'), 'peakRssBytes': 1}, 'limitations': ['fixture']})
        with self.assertRaises(ValueError):
            batch.validate_receipt({'schemaVersion': 1, 'kind': 'keyspilli-player-input-evidence', 'status': 'uncertain', 'historyPitchCandidates': None, 'rawResidual': None, 'resources': {'elapsedSeconds': 1, 'peakRssBytes': 3 * 1024 ** 3}, 'limitations': ['fixture']})


if __name__ == '__main__':
    unittest.main()
