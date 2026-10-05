import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from test_onset_evidence import piano

SCRIPT = Path(__file__).resolve().parents[1] / 'src/pitch_evidence.py'
spec = importlib.util.spec_from_file_location('pitch_evidence', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PitchEvidenceTests(unittest.TestCase):
    def test_unknown_or_polyphonic_texture_refuses_before_media_access(self):
        for texture in ('unknown', 'polyphonic', None):
            with self.assertRaisesRegex(ValueError, 'monophonic'):
                module.analyze(Path('/missing.wav'), '0' * 64, texture=texture)

    def test_absolute_octave_is_retained_even_when_pitch_class_matches(self):
        low = module.summarize([60.1] * 12, [True] * 12, [.95] * 12, [0] * 12)
        high = module.summarize([72.1] * 12, [True] * 12, [.95] * 12, [0] * 12)
        self.assertEqual((low['midiEstimate'], high['midiEstimate']), (60, 72))
        self.assertEqual(low['pitchClassEstimate'], high['pitchClassEstimate'])
        self.assertAlmostEqual(low['centsFromNearestMidi'], 10)

    def test_unvoiced_and_low_probability_frames_do_not_supply_pitch(self):
        for voiced, probs in (([False] * 12, [.99] * 12), ([True] * 12, [.4] * 12)):
            result = module.summarize([69.] * 12, voiced, probs, [-20] * 12)
            self.assertIsNone(result['midiEstimate'])
            self.assertEqual(result['status'], 'uncertain')

    def test_unstable_detuned_and_quiet_windows_remain_uncertain(self):
        for values, level in (([60., 61.] * 6, -20), ([60.49] * 12, -20), ([60.] * 12, -70)):
            result = module.summarize(values, [True] * 12, [.99] * 12, [level] * 12)
            self.assertIsNone(result['midiEstimate'])

    def test_scale_requires_unique_integer_pitch_classes(self):
        for scale in ([True], [1.5], [-1], [12], [0, 0], [], list(range(13))):
            with self.assertRaisesRegex(ValueError, 'pitch classes'):
                module.validate_scale(scale)
        self.assertEqual(module.validate_scale(None), None)
        self.assertEqual(module.validate_scale([0, 2, 4, 5, 7, 9, 11]), [0, 2, 4, 5, 7, 9, 11])

    def test_measured_tone_and_explicit_scale_export_separate_origins(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tone.wav'
            sha = piano(path, [.25])  # A4; a controlled tone, not a sampled piano bank.
            receipt, bundle = module.analyze(path, sha, texture='monophonic', scale=[0, 2, 4, 5, 7, 9, 11])
            self.assertEqual(receipt['windows'][0]['midiEstimate'], 69)
            self.assertTrue(receipt['windows'][0]['inSuppliedScale'])
            claims = {x['id']: x for x in bundle['claims']}
            self.assertEqual(claims['pitch-0']['origin'], 'measurement')
            self.assertEqual(claims['supplied-scale']['origin'], 'authored')
            self.assertEqual(claims['asserted-texture']['origin'], 'authored')
            self.assertNotIn(str(path), str(bundle))
            self.assertFalse(receipt['calibrated'])
            self.assertEqual(receipt['providerCalls'], 0)
            self.assertEqual(receipt['musicalAcceptance'], 'not-established')

    def test_wrong_supplied_scale_is_reported_without_repair(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tone.wav'
            receipt, _ = module.analyze(path, piano(path, [.25]), texture='monophonic', scale=[0])
            self.assertFalse(receipt['windows'][0]['inSuppliedScale'])
            self.assertNotIn('repair', receipt)

    def test_missing_scale_stays_unknown_and_output_is_exclusive(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tone.wav'
            sha = piano(path, [.25])
            output = Path(folder) / 'report'
            receipt, _ = module.write_report(path, sha, output, texture='monophonic')
            self.assertIsNone(receipt['windows'][0]['inSuppliedScale'])
            before = (output / 'receipt.json').read_bytes()
            with self.assertRaises(FileExistsError):
                module.write_report(path, sha, output, texture='monophonic')
            self.assertEqual(before, (output / 'receipt.json').read_bytes())

    def test_silence_and_stale_hash_refuse(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'zero.wav'
            sha = piano(path, [])
            with self.assertRaisesRegex(ValueError, 'silence'):
                module.analyze(path, sha, texture='monophonic')
            with self.assertRaisesRegex(ValueError, 'hash'):
                module.analyze(path, '0' * 64, texture='monophonic')

    def test_dense_onset_inventory_refuses_before_expensive_pitch_tracking(self):
        receipt = {'onsetEstimateSeconds': [i / 10 for i in range(61)]}
        with patch.object(module.onset_evidence, 'analyze', return_value=(receipt, {})), \
                self.assertRaisesRegex(ValueError, 'at most60'):
            module.analyze(Path('/missing.wav'), '0' * 64, texture='monophonic')

    def test_relative_output_refuses_before_processing(self):
        with self.assertRaisesRegex(ValueError, 'absolute output'):
            module.write_report(Path('/missing.wav'), '0' * 64, Path('relative'), texture='monophonic')


if __name__ == '__main__':
    unittest.main()
