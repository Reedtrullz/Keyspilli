"""Concrete follow-up review regressions; use only isolated authored files."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'plugins/keyspilli/skills/keyspilli-song/scripts/pin_preparation_request.py'
CHECKER = ROOT / 'scripts/check-keyspilli-plugin.py'


class BoundaryReviewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='keyspilli-boundary-review-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.source = self.root / 'source.mid'
        events = b'\x00\x90\x3c\x50\x83\x60\x80\x3c\x00\x00\xff\x2f\x00'
        self.source.write_bytes(b'MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xe0MTrk' + len(events).to_bytes(4, 'big') + events)
        self.instruction = self.root / 'instruction.md'
        self.instruction.write_text('Authored software control. No musical approval.\n')
        self.output = self.root / 'request.json'

    def command(self, *extra, helper=HELPER, source=None, output=None):
        return subprocess.run([sys.executable, '-B', str(helper),
            '--source', str(source or self.source), '--instruction', str(self.instruction),
            '--title', 'Control', '--artist', 'Software', '--output', str(output or self.output),
            *extra], capture_output=True, text=True, timeout=15)

    def refuse(self, result, reason):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(reason, result.stderr)
        self.assertFalse(self.output.exists())

    def test_duplicate_source_pin_cannot_discard_the_first_constraint(self):
        correct = hashlib.sha256(self.source.read_bytes()).hexdigest()
        result = self.command('--expected-source-sha256', '0' * 64,
                              '--expected-source-sha256=' + correct)
        self.refuse(result, 'only once')

    def test_single_value_options_cannot_silently_replace_earlier_arguments(self):
        for option, value in (('--source', str(self.source)), ('--output', str(self.output)),
                              ('--title', 'Replacement'), ('--artist', 'Replacement')):
            with self.subTest(option=option):
                result = self.command(option + '=' + value)
                try:
                    self.refuse(result, 'only once')
                finally:
                    self.output.unlink(missing_ok=True)

    def test_duplicate_phrase_plan_is_rejected_before_reading_missing_files(self):
        result = self.command('--phrase-plan', str(self.root / 'first-missing.json'),
                              '--phrase-plan', str(self.root / 'second-missing.json'))
        self.refuse(result, 'only once')

    def test_repeated_instruction_option_remains_ordered_and_supported(self):
        second = self.root / 'second.md'; second.write_text('Second control.\n')
        result = self.command('--instruction', str(second))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([item['path'] for item in json.loads(self.output.read_bytes())['instructions']],
                         [str(self.instruction), str(second)])

    def test_double_leading_slash_source_is_not_emitted_as_a_native_host_path(self):
        if os.name != 'posix':
            self.skipTest('POSIX path spelling control')
        result = self.command(source='/' + str(self.source))
        self.refuse(result, 'leading slashes')

    def test_double_slash_destination_does_not_bypass_package_containment(self):
        if os.name != 'posix':
            self.skipTest('POSIX path spelling control')
        plugin = self.root / 'plugin'
        copied = plugin / 'skills/keyspilli-song/scripts/pin_preparation_request.py'
        copied.parent.mkdir(parents=True)
        shutil.copyfile(HELPER, copied)
        (plugin / 'source-members.json').write_text('{}\n')
        intended = plugin / 'request.json'
        result = self.command(helper=copied, output='/' + str(intended))
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('leading slashes', result.stderr)
        self.assertFalse(intended.exists())

    def test_report_alias_is_checked_before_creating_directories_or_files(self):
        plugin = self.root / 'plugin'; plugin.mkdir()
        marker = plugin / 'untouched.txt'; marker.write_bytes(b'unchanged')
        alias = self.root / 'alias'; alias.symlink_to(plugin, target_is_directory=True)
        spec = importlib.util.spec_from_file_location('keyspilli_boundary_checker', CHECKER)
        checker = importlib.util.module_from_spec(spec); spec.loader.exec_module(checker)
        with self.assertRaisesRegex(ValueError, 'outside.*source'):
            checker.check(plugin, self.root, '/missing-node', alias / 'nested' / 'report.json')
        self.assertEqual([p.name for p in plugin.iterdir()], ['untouched.txt'])
        self.assertEqual(marker.read_bytes(), b'unchanged')


if __name__ == '__main__':
    unittest.main()
