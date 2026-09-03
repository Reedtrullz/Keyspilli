import importlib.util
import pathlib
import unittest

import numpy as np


SCRIPT = pathlib.Path(__file__).with_name("calibrate-real-alignment.py")
SPEC = importlib.util.spec_from_file_location("keyspilli_alignment_calibrator_test", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
CAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CAL)


class ProductionAlignmentV2Tests(unittest.TestCase):
    def test_corridor_dtw_handles_dense_equivalent_without_dense_allocation(self) -> None:
        frames = 6_000
        time_axis = np.arange(frames, dtype=np.float32)
        features = np.vstack((np.sin(time_axis / 13), np.cos(time_axis / 17))).astype(np.float32)
        bounds = [(max(0, index - 8), min(frames - 1, index + 8)) for index in range(frames)]

        path, cost, diagnostics = CAL.corridor_dtw(features, features, bounds)

        self.assertEqual(tuple(path[0]), (0, 0))
        self.assertEqual(tuple(path[-1]), (frames - 1, frames - 1))
        self.assertLess(diagnostics["evaluatedCells"], frames * frames)
        self.assertLess(diagnostics["evaluatedCells"], 200_000)
        self.assertTrue(np.isfinite(cost))

    def test_production_v2_reports_coarse_fine_resource_and_confidence_signals(self) -> None:
        notes = [
            {
                "midi": 60 + (index % 5),
                "velocity": 100,
                "native_seconds": index * 0.25,
                "duration_seconds": 0.2,
            }
            for index in range(24)
        ]
        audio_frames = 420
        axis = np.arange(audio_frames, dtype=np.float32)
        audio_features = np.vstack((np.sin(axis / 5), np.cos(axis / 7))).astype(np.float32)

        path, cost, diagnostics = CAL.production_alignment_features(
            notes,
            audio_features,
            audio_frames * CAL.FRAME_SECONDS,
        )

        self.assertGreater(len(path), 0)
        self.assertTrue(np.isfinite(cost))
        self.assertEqual(diagnostics["method"], "coarse-to-fine-corridor-dtw")
        self.assertGreater(diagnostics["coarse"]["evaluatedCells"], 0)
        self.assertGreater(diagnostics["fine"]["evaluatedCells"], 0)
        self.assertLess(
            diagnostics["fine"]["evaluatedCells"],
            diagnostics["fine"]["denseEquivalentCells"],
        )
        self.assertIn(diagnostics["confidence"]["state"], {
            "ALIGNED_HIGH_CONFIDENCE",
            "ALIGNED_PARTIAL",
            "ALIGNMENT_REJECTED",
        })


if __name__ == "__main__":
    unittest.main()
