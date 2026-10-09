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


def temporal_request(folder):
    r = request(folder)
    rate = 32000
    pcm = array.array('h')
    for i in range(round(1.6 * rate)):
        t = i / rate
        low = 0 if t < .25 else .12 * math.exp(-4 * (t - .25)) * math.sin(2 * math.pi * 261.625565 * (t - .25))
        high = 0 if t < .65 else .22 * math.exp(-2 * (t - .65)) * math.sin(2 * math.pi * 391.995436 * (t - .65))
        pcm.append(round((low + high) * 32767))
    with wave.open(r['audio']['path'], 'wb') as w:
        w.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        w.writeframes(pcm.tobytes())
    r['audio']['sha256'] = hashlib.sha256(Path(r['audio']['path']).read_bytes()).hexdigest()
    r['window'] = {'startSeconds': .68, 'endSeconds': .808}
    return r


class BankPitchTests(unittest.TestCase):
    def test_history_links_a_weak_component_without_promoting_it(self):
        with tempfile.TemporaryDirectory() as d:
            r = temporal_request(Path(d))
            baseline, _ = module.analyze(r)
            receipt, bundle = getattr(module, 'analyze_with_history', module.analyze)(r)
            self.assertEqual(receipt['pitchSetEstimate'], [67])
            self.assertEqual(receipt['fit'], baseline['fit'])
            history = receipt.get('history', {})
            self.assertEqual(history.get('candidateLinks'), [{'midi': 60, 'priorWindowIds': ['prior-window-0']}])
            self.assertFalse(history['pitchPresenceEstablished'])
            self.assertEqual(history['windows'][0]['pitchSetEstimate'], [60])
            self.assertLessEqual(history['windows'][0]['endSeconds'], .68)
            self.assertIn('candidate-history', {x['id'] for x in bundle['claims']})
            r['expectedPitches'] = [64]
            wrong_score, _ = module.analyze_with_history(r)
            self.assertEqual(wrong_score['history'], receipt['history'])

    def test_history_excludes_future_and_expired_windows_and_caps_work(self):
        select = getattr(module, '_prior_windows', lambda onsets, rate, start: [])
        self.assertEqual(select([.25, .65, 1.35, 2.4, 2.85], 32000, 2.),
                         [{'onsetSeconds': 1.35, 'startSeconds': 1.38, 'endSeconds': 1.508}])
        self.assertEqual(select([1.35], 32000, 1.50799), [])
        with self.assertRaisesRegex(ValueError, 'history window bound'):
            select([.8 + i * .05 for i in range(12)], 32000, 2.)

    def test_history_does_not_use_a_later_fit_to_support_an_early_window(self):
        with tempfile.TemporaryDirectory() as d:
            r = temporal_request(Path(d))
            r['window'] = {'startSeconds': .28, 'endSeconds': .408}
            receipt, bundle = getattr(module, 'analyze_with_history', module.analyze)(r)
            self.assertEqual(receipt.get('history', {}).get('windows'), [])
            self.assertNotIn('prior-window-0', {x['id'] for x in bundle['claims']})

    def test_history_preserves_uncertain_target_and_unknown_current_presence(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            r['audio']['sha256'] = clip(Path(r['audio']['path']), [70])
            r['window'] = {'startSeconds': .68, 'endSeconds': .808}
            receipt, _ = getattr(module, 'analyze_with_history', module.analyze)(r)
            self.assertIsNone(receipt['pitchSetEstimate'])
            self.assertIsNone(receipt.get('history', {}).get('candidateLinks', []))
            self.assertEqual(receipt['pitchSetCompleteness'], 'unknown')

    def test_history_reports_are_exclusive_and_default_profile_stays_simple(self):
        with tempfile.TemporaryDirectory() as d:
            r = temporal_request(Path(d))
            baseline, _ = module.write_report(r, Path(d) / 'simple')
            self.assertNotIn('history', baseline)
            out = Path(d) / 'history'
            receipt, _ = module.write_report(r, out, with_history=True)
            self.assertIn('history', receipt)
            before = (out / 'receipt.json').read_bytes()
            with self.assertRaises(FileExistsError):
                module.write_report(r, out, with_history=True)
            self.assertEqual((out / 'receipt.json').read_bytes(), before)

    def test_quiet_component_is_visible_without_becoming_a_detected_pitch(self):
        # Removing weak-candidate reporting or promoting it to the selected set
        # would hide this ambiguity or incorrectly claim a recovered note.
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            rate = 32000
            pcm = array.array('h')
            for i in range(rate):
                t = i / rate - .25
                value = 0 if t < 0 else math.exp(-2 * t) * (
                    .2 * math.sin(2 * math.pi * 261.625565 * t) +
                    .025 * math.sin(2 * math.pi * 329.627557 * t))
                pcm.append(round(value * 32767))
            with wave.open(r['audio']['path'], 'wb') as w:
                w.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
                w.writeframes(pcm.tobytes())
            r['audio']['sha256'] = hashlib.sha256(Path(r['audio']['path']).read_bytes()).hexdigest()
            r['expectedPitches'] = [60, 64]
            receipt, bundle = module.analyze(r)
            self.assertEqual(receipt['pitchSetEstimate'], [60])
            self.assertEqual(receipt['comparison']['missingExpectedPitches'], [64])
            self.assertEqual([x['midi'] for x in receipt.get('belowThresholdCandidates', [])], [64])
            self.assertEqual(receipt['pitchSetCompleteness'], 'unknown')
            self.assertFalse(receipt['comparison']['absenceEstablished'])
            self.assertIn('weak-pitch-candidates', {x['id'] for x in bundle['claims']})
            r['expectedPitches'] = [67]
            wrong_score, _ = module.analyze(r)
            self.assertEqual(wrong_score['belowThresholdCandidates'], receipt['belowThresholdCandidates'])
            self.assertEqual(wrong_score['pitchSetEstimate'], [60])

    def test_clean_fit_does_not_invent_weak_candidates(self):
        with tempfile.TemporaryDirectory() as d:
            receipt, bundle = module.analyze(request(Path(d)))
            self.assertEqual(receipt.get('belowThresholdCandidates'), [])
            self.assertNotIn('weak-pitch-candidates', {x['id'] for x in bundle['claims']})

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
            self.assertIsNone(receipt.get('belowThresholdCandidates'))
            self.assertEqual(receipt.get('pitchSetCompleteness'), 'unknown')
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
