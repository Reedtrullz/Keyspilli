import importlib.util
import unittest
import tempfile
import time
from pathlib import Path
from types import ModuleType


class WorkflowApiTests(unittest.TestCase):
    module = ModuleType("not_loaded")
    def setUp(self):
        path = Path(__file__).with_name("run-keyspilli-workflow-api.py")
        self.assertTrue(path.is_file(), "restricted API executor missing")
        spec = importlib.util.spec_from_file_location("workflow_api", path)
        assert spec is not None and spec.loader is not None
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_request_bound_covers_serialized_tool_and_history_bytes(self):
        body = {"model": "B.AI/mimo-v2.6-flash", "messages": [{"role": "user", "content": "ø" * 100}]}
        wire, bound = self.module.encode_request(body)
        self.assertGreaterEqual(bound, len(wire) * 4)
        with self.assertRaises(ValueError):
            self.module.encode_request({"messages": [{"content": "x" * 131073}]})

    def test_restricted_tool_arguments_reject_unknown_keys_and_model_paths(self):
        self.module.validate_tool("prepare_song", {"previews": True, "level": "e"})
        for name, args in [("shell", {"cmd": "id"}), ("prepare_song", {"source": "/etc/passwd"}),
                           ("read_reference", {"path": "../../outside"}), ("deliver_song", {"level": "invented"}),
                           ("checkout_preflight", {"command": "npm install"})]:
            with self.assertRaises(ValueError):
                self.module.validate_tool(name, args)

    def test_failure_or_model_claim_is_not_a_verified_delivery(self):
        self.assertFalse(self.module.qualifies("simple-midi", {"status": "complete-provisional"}, []))
        self.assertFalse(self.module.qualifies("missing-renderer", {"status": "refused-or-incomplete"}, []))
        self.assertTrue(self.module.qualifies("missing-renderer", {"status": "refused-or-incomplete"},
            [{"tool": "prepare_song", "exitCode": 1, "previewAttempted": True, "deliveryStatus": "incomplete",
              "modes": {"original": {"status": "blocked", "error": "FluidSynth unavailable. Install FluidSynth or set KEYSPILLI_FLUIDSYNTH."}}}]))
        self.assertFalse(self.module.qualifies("truncated-preview", {"status": "complete-provisional"},
            [{"tool": "prepare_song", "exitCode": 1, "previewAttempted": True, "deliveryStatus": "incomplete"}]))

    def test_deadline_prevents_tool_execution(self):
        with self.assertRaises(TimeoutError):
            self.module.remaining_seconds(0)

    def test_wrong_audio_failure_does_not_qualify_the_truncated_case(self):
        trace = {"tool": "prepare_song", "exitCode": 1, "previewAttempted": True, "deliveryStatus": "incomplete",
                 "modes": {"original": {"status": "blocked", "error": "FluidSynth unavailable. Install FluidSynth or set KEYSPILLI_FLUIDSYNTH."}}}
        self.assertFalse(self.module.qualifies("truncated-preview", {"status": "refused-or-incomplete"}, [trace]))
        self.assertFalse(self.module.qualifies("silent-clipped-preview", {"status": "refused-or-incomplete"}, [trace]))

    def test_real_restricted_request_pinning_creates_exact_source_request(self):
        checkout = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            cell = Path(directory).resolve()
            midi = cell / "source.mid"
            midi.write_bytes(b"MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xe0MTrk\x00\x00\x00\x04\x00\xff\x2f\x00")
            instruction = cell / "instruction.md"
            instruction.write_text("Use the supplied bytes provisionally.")
            fixture = {"source": str(midi), "instruction": str(instruction), "title": "Fixture", "artist": "Software control",
                       "node": "/unused", "soundfont": "/unused", "renderer": "/unused"}
            trace = self.module.execute_tool("pin_request", {}, fixture, cell, checkout, checkout / "plugins/keyspilli", time.monotonic() + 30, 1)
            self.assertEqual(trace["exitCode"], 0)
            self.assertTrue((cell / "request.json").is_file())


if __name__ == "__main__":
    unittest.main()
