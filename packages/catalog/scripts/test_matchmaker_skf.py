import importlib.util
import pathlib
import unittest

import numpy as np


SCRIPT = pathlib.Path(__file__).with_name("evaluate-matchmaker-skf.py")
SPEC = importlib.util.spec_from_file_location("keyspilli_matchmaker_skf_test", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
SKF = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SKF)


class MatchmakerSkfEvaluatorTests(unittest.TestCase):
    def test_score_axis_scale_handles_compound_meter(self) -> None:
        normal = np.array([(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)], dtype=[("onset_beat", "f8"), ("onset_quarter", "f8")])
        bach = np.array([(0.0, 0.0), (2.0, 1.0), (4.0, 2.0)], dtype=normal.dtype)
        self.assertEqual(SKF.score_axis_scale(normal), 1.0)
        self.assertEqual(SKF.score_axis_scale(bach), 0.5)

    def test_longest_region_is_deterministic_and_inclusive(self) -> None:
        self.assertEqual(SKF.longest_contiguous_region([0.1, 0.3, 0.4, 0.2, 0.8], 0.25), {
            "thresholdSeconds": 0.25,
            "count": 2,
            "startIndex": 1,
            "endIndex": 2,
            "durationSamples": 2,
        })

    def test_path_interpolation_preserves_score_time_and_deduplicates_frames(self) -> None:
        path = np.array([[0.0, 1.0, 0.8, 2.0, 2.0], [0.0, 1.0, 1.5, 2.0, 2.0]])
        predicted = SKF.path_predictions(path, [0.0, 1.0, 2.0], 60.0, 1.0)
        np.testing.assert_allclose(predicted, [0.0, 1.0, 2.0])

    def test_canonical_hash_excludes_runtime_only_fields(self) -> None:
        base = {"runtimeSeconds": 1.0, "peakRssMiB": 2.0, "fixtures": [{"methods": {"skf": {"runtimeSeconds": 1.0, "peakRssMiB": 2.0, "value": 3}}}]}
        changed = {"runtimeSeconds": 8.0, "peakRssMiB": 9.0, "fixtures": [{"methods": {"skf": {"runtimeSeconds": 8.0, "peakRssMiB": 9.0, "value": 3}}}]}
        self.assertEqual(SKF.canonical_hash(base), SKF.canonical_hash(changed))


if __name__ == "__main__":
    unittest.main()
