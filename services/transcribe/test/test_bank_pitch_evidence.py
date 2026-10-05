import array
import hashlib
import importlib.util
import math
import sys
import tempfile
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
SCRIPT = Path(__file__).resolve().parents[1] / 'src/bank_pitch_evidence.py'
spec = importlib.util.spec_from_file_location('bank_pitch', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def clip(path, pitches, gain=.2):
    rate = 32000
    pcm = array.array('h')
    for i in range(rate):
        t = i / rate - .25
        value = 0 if t < 0 else sum(gain * math.exp(-2 * t) * math.sin(
            2 * math.pi * 440 * 2 ** ((p - 69) / 12) * t) for p in pitches)
        pcm.append(round(value * 32767))
    with wave.open(str(path), 'wb') as w:
        w.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        w.writeframes(pcm.tobytes())
    return hashlib.sha256(path.read_bytes()).hexdigest()


def request(folder):
    bank = folder / 'unit-bank.bin'
    bank.write_bytes(b'Controlled unit fixture; not a sampled bank')
    bank_sha = hashlib.sha256(bank.read_bytes()).hexdigest()
    templates = []
    for midi in [60, 64, 67]:
        path = folder / f'{midi}.wav'
        templates.append({'midi': midi, 'path': str(path), 'sha256': clip(path, [midi]),
                          'bankSha256': bank_sha, 'attackSeconds': .28})
    audio = folder / 'chord.wav'
    return {'bank': {'path': str(bank), 'sha256': bank_sha},
            'audio': {'path': str(audio), 'sha256': clip(audio, [60, 67]), 'bankSha256': bank_sha},
            'templates': templates, 'window': {'startSeconds': .28, 'endSeconds': .408},
            'expectedPitches': [60, 67]}


class BankPitchTests(unittest.TestCase):
    def test_chord_fit_searches_inventory_even_when_expected_score_is_wrong(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            r['expectedPitches'] = [64]
            receipt, bundle = module.analyze(r)
            self.assertEqual(receipt['pitchSetEstimate'], [60, 67])
            self.assertEqual(receipt['comparison']['unexpectedPitches'], [60, 67])
            self.assertEqual(receipt['comparison']['missingExpectedPitches'], [64])
            self.assertEqual(receipt['searchedPitches'], [60, 64, 67])
            self.assertEqual(receipt['origin'], 'renderer-informed')
            self.assertEqual(receipt['providerCalls'], 0)
            self.assertFalse(receipt['calibrated'])
            self.assertNotIn(d, str(bundle))
            self.assertEqual(bundle['context']['sourceAuthority'], 'unknown')
            self.assertEqual({x['origin'] for x in bundle['claims']}, {'authored', 'measurement'})

    def test_unknown_or_mismatched_bank_refuses_before_reading(self):
        r = {'bank': {'path': '/missing', 'sha256': 'a' * 64},
             'audio': {'path': '/missing', 'sha256': 'b' * 64, 'bankSha256': 'c' * 64},
             'templates': [], 'window': {'startSeconds': 0, 'endSeconds': .128}, 'expectedPitches': None}
        with self.assertRaisesRegex(ValueError, 'bank'):
            module.analyze(r)

    def test_changed_bank_or_template_bytes_refuse(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            Path(r['bank']['path']).write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'bank'):
                module.analyze(r)
            r = request(Path(d))
            r['templates'][0]['sha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'hash'):
                module.analyze(r)

    def test_bad_alignment_or_template_inventory_refuses(self):
        with tempfile.TemporaryDirectory() as d:
            for bad in (float('nan'), True, -1, .95):
                r = request(Path(d))
                r['templates'][0]['attackSeconds'] = bad
                with self.assertRaisesRegex(ValueError, 'attack'):
                    module.analyze(r)
            r = request(Path(d))
            r['templates'].append(r['templates'][0])
            with self.assertRaisesRegex(ValueError, 'inventory'):
                module.analyze(r)

    def test_unsearched_expected_pitch_is_not_reported_as_acoustically_missing(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            r['expectedPitches'] = [61]
            receipt, _ = module.analyze(r)
            self.assertEqual(receipt['comparison']['unsearchedExpectedPitches'], [61])
            self.assertEqual(receipt['comparison']['missingExpectedPitches'], [])

    def test_quiet_or_poor_fit_remains_uncertain(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            r['audio']['sha256'] = clip(Path(r['audio']['path']), [70], gain=.0001)
            receipt, _ = module.analyze(r)
            self.assertEqual(receipt['status'], 'uncertain')
            self.assertIsNone(receipt['pitchSetEstimate'])
            self.assertIsNone(receipt['comparison'])
            r['audio']['sha256'] = clip(Path(r['audio']['path']), [70])
            receipt, _ = module.analyze(r)
            self.assertEqual(receipt['status'], 'uncertain')
            self.assertIsNone(receipt['pitchSetEstimate'])
            self.assertGreater(receipt['fit']['residualRatio'], module.CONFIG['maximumResidualRatio'])

    def test_unknown_expectation_stays_unknown_and_output_is_exclusive(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            r['expectedPitches'] = None
            out = Path(d) / 'report'
            receipt, _ = module.write_report(r, out)
            self.assertIsNone(receipt['comparison'])
            self.assertEqual(receipt['musicalAcceptance'], 'not-established')
            before = (out / 'receipt.json').read_bytes()
            with self.assertRaises(FileExistsError):
                module.write_report(r, out)
            self.assertEqual(before, (out / 'receipt.json').read_bytes())

    def test_window_bounds_and_expected_inventory_validation(self):
        with tempfile.TemporaryDirectory() as d:
            for window in ({'startSeconds': -.1, 'endSeconds': .028},
                           {'startSeconds': .95, 'endSeconds': 1.078},
                           {'startSeconds': .25, 'endSeconds': .3}):
                r = request(Path(d))
                r['window'] = window
                with self.assertRaisesRegex(ValueError, 'window'):
                    module.analyze(r)
            for expected in ([True], [60, 60], [109], [float('nan')]):
                r = request(Path(d))
                r['expectedPitches'] = expected
                with self.assertRaisesRegex(ValueError, 'expected pitches'):
                    module.analyze(r)


if __name__ == '__main__':
    unittest.main()
