import array
import hashlib
import importlib.util
import math
import tempfile
import unittest
import wave
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'src/onset_evidence.py'
spec = importlib.util.spec_from_file_location('onset_evidence', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def piano(path, starts, duration=2.8):
    rate = 32000
    samples = array.array('h')
    for i in range(int(duration * rate)):
        t = i / rate
        value = sum(.3 * min(1, (t - start) / .005) * math.exp(-4 * (t - start)) *
                    math.sin(2 * math.pi * 440 * (t - start))
                    for start in starts if 0 <= t - start < 2)
        samples.append(round(value * 32767))
    with wave.open(str(path), 'wb') as handle:
        handle.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        handle.writeframes(samples.tobytes())
    return hashlib.sha256(path.read_bytes()).hexdigest()


class OnsetEvidenceTests(unittest.TestCase):
    def test_sustained_decay_does_not_become_repeated_attacks(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'held.wav'
            receipt, bundle = module.analyze(path, piano(path, [.25]))
            self.assertEqual(len(receipt['onsetEstimateSeconds']), 1)
            self.assertAlmostEqual(receipt['onsetEstimateSeconds'][0], .25, delta=.1)
            self.assertEqual(bundle['claims'][0]['origin'], 'measurement')
            self.assertIn('estimate', bundle['claims'][0]['text'])
            self.assertIn('not', bundle['claims'][0]['uncertainty'])
            self.assertNotIn(str(path), str(bundle))
            self.assertEqual(bundle['context']['sourceAuthority'], 'unknown')

    def test_repeated_same_pitch_with_overlapping_decay_keeps_four_onsets(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'repeated.wav'
            receipt, bundle = module.analyze(path, piano(path, [.25, .7, 1.15, 1.6]))
            self.assertEqual(len(receipt['onsetEstimateSeconds']), 4)
            for actual, expected in zip(receipt['onsetEstimateSeconds'], [.25, .7, 1.15, 1.6]):
                self.assertAlmostEqual(actual, expected, delta=.1)
            self.assertEqual(bundle['clips'][0]['sha256'], receipt['audio']['sha256'])
            self.assertEqual(receipt['musicalAcceptance'], 'not-established')
            self.assertIsNone(receipt['acousticPitch'])

    def test_silence_and_stale_hash_refuse_without_output(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'zero.wav'
            sha = piano(path, [])
            with self.assertRaisesRegex(ValueError, 'silence'):
                module.analyze(path, sha)
            with self.assertRaisesRegex(ValueError, 'hash'):
                module.analyze(path, '0' * 64)

    def test_malformed_and_oversized_files_refuse(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'bad.wav'
            for raw in [b'bad', b'x' * (2 * 1024 * 1024 + 1)]:
                path.write_bytes(raw)
                with self.assertRaises(ValueError):
                    module.analyze(path, hashlib.sha256(raw).hexdigest())

    def test_output_is_exclusive(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'held.wav'
            output = Path(folder) / 'report'
            sha = piano(path, [.25])
            module.write_report(path, sha, output)
            before = (output / 'anti-evidence.json').read_bytes()
            with self.assertRaises(FileExistsError):
                module.write_report(path, sha, output)
            self.assertEqual(before, (output / 'anti-evidence.json').read_bytes())

    def test_dense_clip_exports_all_estimates_within_portable_claim_bound(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'dense.wav'
            rate, period = 32000, 3808
            burst = array.array('h', (
                round(12000 * math.sin(2 * math.pi * 440 * i / rate) *
                      min(1, i / 100) * max(0, 1 - i / 1500))
                for i in range(period)))
            with wave.open(str(path), 'wb') as handle:
                handle.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
                handle.writeframes(burst.tobytes() * 252)
            receipt, bundle = module.analyze(path, hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertGreater(len(receipt['onsetEstimateSeconds']), 200)
            self.assertLessEqual(len(bundle['claims'][0]['text']), 4096)


if __name__ == '__main__':
    unittest.main()
