"""Request-construction controls; no musician, source or playback approval."""
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

PLUGIN = Path(__file__).resolve().parents[1] / 'plugins/keyspilli'
HELPER = PLUGIN / 'skills/keyspilli-song/scripts/pin_preparation_request.py'


def midi_fixture():
    events = b'\x00\x90\x3c\x50\x83\x60\x80\x3c\x00\x00\xff\x2f\x00'
    return b'MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xe0MTrk' + len(events).to_bytes(4, 'big') + events


class PinRequestTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='keyspilli-request-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.source = self.root / 'source with spaces.mid'
        self.source.write_bytes(midi_fixture())
        self.instructions = self.root / 'intent.md'
        self.instructions.write_text('Self-authored software control; not a musical approval.\n')
        self.output = self.root / 'request.json'

    def run_helper(self, *extra, source=None, instructions=None, output=None, title='Test song', artist='Software control'):
        args = [sys.executable, '-B', str(HELPER), '--source', str(source or self.source),
                '--title', title, '--artist', artist, '--output', str(output or self.output)]
        for path in [self.instructions] if instructions is None else instructions:
            args += ['--instruction', str(path)]
        return subprocess.run([*args, *extra], cwd=self.root, capture_output=True, text=True, timeout=15)

    def assert_refused(self, result, reason):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(reason, result.stderr)
        self.assertFalse(self.output.exists())

    def test_creates_exact_native_request_without_mutating_inputs(self):
        inputs = {p: p.read_bytes() for p in (self.source, self.instructions)}
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        request = json.loads(self.output.read_text())
        self.assertEqual(request, {
            'schemaVersion': 1, 'kind': 'keyspilli-deterministic-preparation',
            'title': 'Test song', 'artist': 'Software control',
            'sourceMidi': {'path': str(self.source), 'sha256': hashlib.sha256(inputs[self.source]).hexdigest()},
            'instructions': [{'path': str(self.instructions), 'sha256': hashlib.sha256(inputs[self.instructions]).hexdigest()}],
        })
        summary = json.loads(result.stdout)
        self.assertEqual(summary['status'], 'pinned')
        self.assertEqual(summary['requestPath'], str(self.output))
        self.assertEqual(summary['requestSha256'], hashlib.sha256(self.output.read_bytes()).hexdigest())
        self.assertEqual(summary['semanticAdmission'], 'not-run')
        self.assertEqual(summary['musicalAcceptance'], 'not-established')
        self.assertFalse(summary['preparationRun'])
        self.assertEqual(summary['providerCalls'], 0)
        self.assertEqual(inputs, {p: p.read_bytes() for p in inputs})
        if os.name == 'posix':
            self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)

    def test_relative_paths_and_spaces_are_normalized_without_shell_parsing(self):
        result = self.run_helper(source=self.source.name, instructions=['intent.md'], output='request.json')
        self.assertEqual(result.returncode, 0, result.stderr)
        request = json.loads(self.output.read_text())
        self.assertEqual(request['sourceMidi']['path'], str(self.source))
        self.assertEqual(request['instructions'][0]['path'], str(self.instructions))

    def test_repeat_outputs_have_identical_request_bytes(self):
        self.assertEqual(self.run_helper().returncode, 0)
        second = self.root / 'second.json'
        self.assertEqual(self.run_helper(output=second).returncode, 0)
        self.assertEqual(self.output.read_bytes(), second.read_bytes())

    def test_preserves_instruction_order_and_raw_phrase_plan_pin(self):
        second = self.root / 'second.md'; second.write_text('Second instruction.\n')
        plan = self.root / 'plan.json'; plan.write_bytes(b'{ "softwareFixture": true }\n')
        result = self.run_helper('--phrase-plan', str(plan), instructions=[second, self.instructions])
        self.assertEqual(result.returncode, 0, result.stderr)
        request = json.loads(self.output.read_text())
        self.assertEqual([p['path'] for p in request['instructions']], [str(second), str(self.instructions)])
        self.assertEqual(request['phrasePlan'], {'path': str(plan), 'sha256': hashlib.sha256(plan.read_bytes()).hexdigest()})
        self.assertEqual(json.loads(result.stdout)['semanticAdmission'], 'not-run')

    def test_matching_expected_source_hash_is_checked(self):
        digest = hashlib.sha256(self.source.read_bytes()).hexdigest()
        result = self.run_helper('--expected-source-sha256', digest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.output.read_text())['sourceMidi']['sha256'], digest)

    def test_mismatched_expected_source_hash_is_refused(self):
        self.assert_refused(self.run_helper('--expected-source-sha256', '0' * 64), 'expected source SHA-256')

    def test_invalid_expected_hash_is_not_treated_as_an_unset_pin(self):
        for digest in ('', 'actual_hash', 'A' * 64, '0' * 63):
            with self.subTest(digest=digest):
                self.assert_refused(self.run_helper('--expected-source-sha256', digest), 'lowercase SHA-256')

    def test_existing_request_is_never_overwritten(self):
        self.output.write_text('owner data')
        result = self.run_helper()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('new output', result.stderr)
        self.assertEqual(self.output.read_text(), 'owner data')

    def test_input_and_output_collision_preserves_source(self):
        source_bytes = self.source.read_bytes()
        result = self.run_helper(output=self.source)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('new output', result.stderr)
        self.assertEqual(self.source.read_bytes(), source_bytes)

    def test_duplicate_input_paths_are_refused(self):
        self.assert_refused(self.run_helper(instructions=[self.instructions, self.instructions]), 'distinct input')

    def test_source_as_instruction_is_refused(self):
        self.assert_refused(self.run_helper(instructions=[self.source]), 'distinct input')

    def test_instruction_count_is_bounded(self):
        self.assert_refused(self.run_helper(instructions=[]), '1 to 8 instruction')
        paths=[]
        for index in range(9):
            p=self.root/f'intent-{index}.md'; p.write_text(str(index)); paths.append(p)
        self.assert_refused(self.run_helper(instructions=paths), '1 to 8 instruction')

    def test_non_midi_and_short_headers_are_refused(self):
        for raw in (b'', b'not MIDI', b'MThd', b'RIFF' + bytes(20)):
            with self.subTest(raw=raw):
                self.source.write_bytes(raw)
                self.assert_refused(self.run_helper(), 'MIDI header')

    def test_oversized_inputs_are_refused_before_output(self):
        self.source.write_bytes(midi_fixture() + bytes(16 * 1024 * 1024))
        self.assert_refused(self.run_helper(), 'source size')
        self.source.write_bytes(midi_fixture())
        self.instructions.write_bytes(b'x' * (1024 * 1024 + 1))
        self.assert_refused(self.run_helper(), 'instruction size')

    def test_symlinked_inputs_and_parents_are_refused(self):
        link=self.root/'alias.mid'; link.symlink_to(self.source)
        self.assert_refused(self.run_helper(source=link), 'symlink')
        directory=self.root/'alias'; directory.symlink_to(self.root, target_is_directory=True)
        self.assert_refused(self.run_helper(source=directory/self.source.name), 'symlink')

    def test_absent_input_or_output_parent_does_not_create_request(self):
        self.assert_refused(self.run_helper(source=self.root/'absent.mid'), 'source')
        destination=self.root/'absent'/'request.json'
        result=self.run_helper(output=destination)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('output parent',result.stderr)
        self.assertFalse(destination.exists())
        self.assertFalse(destination.parent.exists())

    def test_title_artist_and_unicode_lengths_follow_host_units(self):
        for metadata in ('', '   ', '\ufeff', 'x\ny', 'x' * 257, '🎹' * 129):
            with self.subTest(metadata=repr(metadata)):
                self.assert_refused(self.run_helper(title=metadata), 'title')
        self.assert_refused(self.run_helper(artist=''), 'artist')
        self.assertEqual(self.run_helper(title='🎹' * 128).returncode, 0)

    def test_unknown_execution_or_publication_flags_are_refused(self):
        self.assert_refused(self.run_helper('--publish'), 'unrecognized arguments')

    def test_abbreviated_options_are_not_silently_accepted(self):
        result = self.run_helper('--expected-source', hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assert_refused(result, 'unrecognized arguments')

    def test_parent_traversal_is_not_normalized_into_a_different_source(self):
        child = self.root / 'child'; child.mkdir()
        result = self.run_helper(source=child / '..' / self.source.name)
        self.assert_refused(result, 'parent traversal')

    def test_output_inside_packaged_source_is_refused(self):
        destination=PLUGIN/'pinning-test-must-not-exist.json'
        result=self.run_helper(output=destination)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('outside the plugin',result.stderr)
        self.assertFalse(destination.exists())

    def test_self_test_is_offline_and_explicitly_not_musical(self):
        result=subprocess.run([sys.executable,'-B',str(HELPER),'--self-test'],capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        value=json.loads(result.stdout)
        self.assertEqual(value['status'],'passed')
        self.assertEqual(value['musicalAcceptance'],'not-established')
        self.assertEqual(value['providerCalls'],0)


if __name__ == '__main__':
    unittest.main()
