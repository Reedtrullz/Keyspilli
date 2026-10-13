import importlib.util
import unittest
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
            [{"tool": "prepare_song", "exitCode": 1, "previewAttempted": True, "deliveryStatus": "incomplete"}]))
        self.assertFalse(self.module.qualifies("truncated-preview", {"status": "complete-provisional"},
            [{"tool": "prepare_song", "exitCode": 1, "previewAttempted": True, "deliveryStatus": "incomplete"}]))

    def test_deadline_prevents_tool_execution(self):
        with self.assertRaises(TimeoutError):
            self.module.remaining_seconds(0)


if __name__ == "__main__":
    unittest.main()
