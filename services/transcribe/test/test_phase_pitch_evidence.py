import copy
import hashlib
import importlib.util
import json
import math
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
SCRIPT = Path(__file__).resolve().parents[1] / 'src/phase_pitch_evidence.py'
if SCRIPT.exists():
    spec = importlib.util.spec_from_file_location('phase_pitch', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
else:
    module = None

PROFILE = {'renderer': 'FluidSynth', 'rendererVersion': '2.6.0', 'gain': .4,
           'reverb': False, 'chorus': False, 'unnormalizedPcm': True,
           'referenceVelocity': 76, 'referenceOnsetSeconds': .25, 'referenceHoldSeconds': 2.2}


def capture(path, notes):
    import numpy as np
    rate = 32000
    t = np.arange(round(2.6 * rate)) / rate - .25
    data = np.zeros(len(t))
    live = t >= 0
    for midi in notes:
        f = 440 * 2 ** ((midi - 69) / 12)
        if midi == 60:
            value = .2 * np.sin(2 * math.pi * f * t) + .13 * np.sin(4 * math.pi * f * t) + .06 * np.sin(8 * math.pi * f * t)
        elif midi == 72:
            value = -.11 * np.sin(2 * math.pi * f * t) + .04 * np.sin(4 * math.pi * f * t)
        else:
            value = .15 * np.sin(2 * math.pi * f * t)
        data[live] += np.exp(-2 * t[live]) * value[live]
    with wave.open(str(path), 'wb') as w:
        w.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
        w.writeframes(np.round(data * 32767).astype('<i2').tobytes())
    return hashlib.sha256(path.read_bytes()).hexdigest()


def request(folder):
    bank = folder / 'controlled-unit-bank.bin'
    bank.write_bytes(b'Controlled additive waveform fixture, not a SoundFont')
    bank_sha = hashlib.sha256(bank.read_bytes()).hexdigest()
    pins = []
    for midi in [60, 72, 84]:
        path = folder / f'note-{midi}.wav'
        pins.append({'midi': midi, 'path': str(path), 'sha256': capture(path, [midi]),
                     'bankSha256': bank_sha, 'attackSeconds': .25, 'velocity': 76, 'holdSeconds': 2.2})
    audio = folder / 'mixture.wav'
    return {'bank': {'path': str(bank), 'sha256': bank_sha},
            'audio': {'path': str(audio), 'sha256': capture(audio, [60, 72]), 'bankSha256': bank_sha},
            'templates': pins, 'window': {'startSeconds': .6, 'endSeconds': .728},
            'expectedPitches': None, 'phaseProfile': copy.deepcopy(PROFILE)}


class PhasePitchTests(unittest.TestCase):
    def analyze(self, r):
        self.assertIsNotNone(module, 'phase pattern diagnostic must exist')
        return module.analyze(r)

    def test_harmonic_cancellation_is_fit_without_claiming_current_presence(self):
        with tempfile.TemporaryDirectory() as d:
            receipt, bundle = self.analyze(request(Path(d)))
            self.assertEqual(receipt['patternPitchCandidates'], [60, 72])
            self.assertLess(receipt['fit']['rawResidual'], .05)
            self.assertIsNone(receipt['currentPitchSetEstimate'])
            self.assertFalse(receipt['currentPresenceEstablished'])
            self.assertEqual(receipt['pitchSetCompleteness'], 'unknown')
            self.assertFalse(receipt['calibrated'])
            self.assertEqual(receipt['providerCalls'], 0)
            self.assertNotIn(d, json.dumps(bundle))
            self.assertEqual(bundle['context']['sourceAuthority'], 'unknown')

    def test_wrong_expected_score_never_restricts_the_search(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            receipt, _ = self.analyze(r)
            r['expectedPitches'] = [84]
            changed, bundle = self.analyze(r)
            self.assertEqual(changed['fit'], receipt['fit'])
            self.assertEqual(changed['patternPitchCandidates'], [60, 72])
            self.assertEqual(changed['searchedPitches'], [60, 72, 84])
            self.assertIn('expected-pitch-set', {c['id'] for c in bundle['claims']})

    def test_no_fitting_sample_extends_beyond_declared_non_grid_end(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            r['window'] = {'startSeconds': .60001, 'endSeconds': .72801}
            receipt, _ = self.analyze(r)
            self.assertLessEqual(receipt['fit']['fitInterval']['endSeconds'], .72801)
            self.assertEqual(receipt['patternPitchCandidates'], [60, 72])

    def test_unregistered_timbre_is_uncertain_instead_of_a_pitch_claim(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            r['audio']['sha256'] = capture(Path(r['audio']['path']), [61])
            receipt, _ = self.analyze(r)
            self.assertEqual(receipt['status'], 'uncertain')
            self.assertIsNone(receipt['patternPitchCandidates'])
            self.assertIsNone(receipt['currentPitchSetEstimate'])

    def test_profile_and_complete_held_templates_are_required(self):
        with tempfile.TemporaryDirectory() as d:
            original = request(Path(d))
            self.assertIsNotNone(module)
            for mutate in [lambda r: r.pop('phaseProfile'), lambda r: r['phaseProfile'].update(gain=1.),
                           lambda r: r['templates'][0].update(velocity=100),
                           lambda r: r['templates'][0].update(holdSeconds=.7),
                           lambda r: r['templates'][0].update(attackSeconds=.28)]:
                r = copy.deepcopy(original)
                mutate(r)
                with self.assertRaises(ValueError):
                    module.analyze(r)

    def test_hash_and_bank_mismatches_refuse_before_any_report(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            self.assertIsNotNone(module)
            for field in ['sha256', 'bankSha256']:
                broken = copy.deepcopy(r)
                broken['audio'][field] = '0' * 64
                target = Path(d) / ('refused-' + field)
                with self.assertRaises(ValueError):
                    module.write_report(broken, target)
                self.assertFalse(target.exists())

    def test_onset_cap_refuses_without_partial_output(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            self.assertIsNotNone(module)
            with (patch.object(module.onset_evidence, 'analyze', return_value=({'onsetEstimateSeconds': [.25, .3, .35, .4, .45]}, {})),
                  self.assertRaisesRegex(ValueError, 'onset bound')):
                module.write_report(r, Path(d) / 'too-many')
            self.assertFalse((Path(d) / 'too-many').exists())

    def test_reports_are_exclusive_and_claim_intervals_match_the_fit(self):
        with tempfile.TemporaryDirectory() as d:
            r = request(Path(d))
            self.assertIsNotNone(module)
            out = Path(d) / 'report'
            receipt, bundle = module.write_report(r, out)
            original = (out / 'receipt.json').read_bytes()
            self.assertEqual(json.loads(original)['patternPitchCandidates'], [60, 72])
            fit_claim = next(c for c in bundle['claims'] if c['id'] == 'phase-pattern-fit')
            self.assertEqual(fit_claim['endSeconds'], receipt['fit']['fitInterval']['endSeconds'])
            with self.assertRaises(FileExistsError):
                module.write_report(r, out)
            self.assertEqual((out / 'receipt.json').read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
