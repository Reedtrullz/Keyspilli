"""Synthetic audio-only support controls for octave ambiguity."""
import sys
from pathlib import Path
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from player_pitch_support import PitchSupportPolicy, evaluate_pitch_support


class PlayerPitchSupportTests(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(41)
        self.refs = []
        for _ in range(3):
            wave = np.zeros((52920, 2), dtype=np.float64)
            wave[:18000] = rng.normal(0, .1, (18000, 2))
            self.refs.append(wave)
        self.pins = [
            {'midi': 48, 'velocity': 76},
            {'midi': 60, 'velocity': 76},
            {'midi': 72, 'velocity': 76},
        ]
        self.policy = PitchSupportPolicy(.001, .001)

    def test_true_octave_dyad_is_not_blanket_deleted(self):
        target = self.refs[1] + self.refs[2]
        result = evaluate_pitch_support(target, [{'ref': 1, 'frame': 0, 'duration': None}, {'ref': 2, 'frame': 0, 'duration': None}], self.refs, self.pins, self.policy)
        self.assertEqual(result['status'], 'supported')

    def test_redundant_lower_octave_is_ambiguous(self):
        target = self.refs[2]
        result = evaluate_pitch_support(target, [{'ref': 1, 'frame': 0, 'duration': None}, {'ref': 2, 'frame': 0, 'duration': None}], self.refs, self.pins, self.policy)
        self.assertEqual(result['status'], 'ambiguous')

    def test_zero_coefficients_and_tied_alternatives_withhold_set(self):
        target = self.refs[2]
        events = [{'ref': 1, 'frame': 0, 'duration': None}, {'ref': 2, 'frame': 0, 'duration': None}]
        first = evaluate_pitch_support(target, events, self.refs, self.pins, self.policy)
        second = evaluate_pitch_support(target, list(reversed(events)), self.refs, self.pins, self.policy)
        self.assertEqual(first['status'], 'ambiguous')
        self.assertEqual(second['status'], first['status'])
        self.assertEqual(second['policySha256'], first['policySha256'])

    def test_alternative_search_never_reads_target_notes(self):
        target = self.refs[2]
        pins = [dict(pin, expected=[90]) for pin in self.pins]
        result = evaluate_pitch_support(target, [{'ref': 2, 'frame': 0, 'duration': None}], self.refs, pins, self.policy)
        self.assertIn(result['status'], {'supported', 'ambiguous'})


if __name__ == '__main__':
    unittest.main()
