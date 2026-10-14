import importlib.util
import unittest
import tempfile
import time
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch
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

    def test_exact_account_transport_and_streaming_mimo_configuration(self):
        luna = self.module.request_configuration("gpt-6-luna", [])
        self.assertEqual(luna["model"], "main/gpt-6-luna")
        self.assertEqual(luna["reasoning_effort"], "low")
        mimo = self.module.request_configuration("B.AI/mimo-v2.6-flash", [])
        self.assertNotIn("thinking", mimo)
        self.assertEqual(mimo["model"], "B.AI/mimo-v2.6-flash")
        self.assertEqual(mimo["max_tokens"], 2048)
        self.assertTrue(mimo["stream"])
        with self.assertRaises(ValueError):
            self.module.request_configuration("unapproved-fallback", [])

    def test_stream_joins_actual_content_tools_reasoning_and_final_usage(self):
        chunks = [
            {"model": "mimo-v2.6-flash", "choices": [{"index": 0, "delta": {"role": "assistant", "reasoning_content": "inspect "}}]},
            {"model": "mimo-v2.6-flash", "choices": [{"index": 0, "delta": {"reasoning_content": "source", "tool_calls": [{"index": 0, "id": "call-1", "type": "function", "function": {"name": "prepare_", "arguments": "{\"previews\":"}}]}}]},
            {"model": "mimo-v2.6-flash", "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"name": "song", "arguments": "true}"}}]}, "finish_reason": "tool_calls"}]},
            {"model": "mimo-v2.6-flash", "choices": [], "usage": {"prompt_tokens": 100, "completion_tokens": 30}},
        ]
        wire = ("\n\n".join("data: " + json.dumps(chunk) for chunk in chunks) + "\n\ndata: [DONE]\n\n").encode()
        result = self.module.parse_chat_stream(wire)
        self.assertEqual(result["model"], "mimo-v2.6-flash")
        self.assertEqual(result["usage"], {"prompt_tokens": 100, "completion_tokens": 30})
        message = result["choices"][0]["message"]
        self.assertEqual(message["reasoning_content"], "inspect source")
        self.assertEqual(message["tool_calls"][0]["function"], {"name": "prepare_song", "arguments": '{"previews":true}'})
        for damaged in [wire.replace(b"tool_calls\"}]", b"length\"}]"), wire.replace(b"data: [DONE]", b""),
                        wire.replace(b'"index": 0', b'"index": -1'), wire.replace(b'"model": "mimo-v2.6-flash"', b'"model": "another-model"', 1)]:
            with self.assertRaises(ValueError): self.module.parse_chat_stream(damaged)

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

    def test_malformed_protocol_keeps_failed_cell_result(self):
        for content in ("[]", "null"):
            with self.subTest(content=content), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                skill = root / "skills/keyspilli-song/SKILL.md"
                skill.parent.mkdir(parents=True)
                skill.write_text("# Owned control")
                admitted = SimpleNamespace(experiment={"skillSnapshots": {"old": {"path": str(root)}}}, admission_count=lambda _id: 0)
                cell = {"id": "owned", "task": "unqualified-url", "model": "gpt-6-luna", "skill": "old", "repetition": 1}
                with patch.object(self.module, "model_request", return_value={"role": "assistant", "content": content}):
                    result = self.module.evaluate_cell(cell, {"description": "No qualified source"}, root, self.module.CORE.Budget(5), admitted)
                self.assertFalse(result["verified"])
                self.assertIn("object", result["error"])
                self.assertEqual(json.loads((root / "owned/result.json").read_text())["status"], "failed")

    def test_empty_choices_is_a_protocol_error(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def read(self, _bound):
                return b'{"model":"gpt-6-luna","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}'
        admitted = SimpleNamespace(recheck=lambda _task: None, fixtures={"simple-midi": {"ocxExecutable": "/owned"}},
            bind_runtime=lambda *_args: None, append=lambda _record: None)
        with tempfile.TemporaryDirectory() as directory, patch.object(self.module, "qualify_runtime", return_value={"nativeQuotaIncluded": True}), patch.object(self.module.urllib.request, "urlopen", return_value=Response()):
            with self.assertRaisesRegex(ValueError, "choices"):
                self.module.model_request("gpt-6-luna", {}, {"id": "owned", "task": "simple-midi", "model": "gpt-6-luna"},
                    Path(directory), time.monotonic() + 10, 0, self.module.CORE.Budget(5), admitted)

    def test_real_chunked_response_cannot_extend_absolute_deadline(self):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *_args): pass
            def do_POST(self):
                payload = b'{"model":"gpt-6-luna","choices":[{"message":{"role":"assistant","content":"{}"}}]}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                try:
                    for offset in range(0, len(payload), 10):
                        self.wfile.write(payload[offset:offset + 10])
                        self.wfile.flush()
                        time.sleep(.06)
                except (BrokenPipeError, ConnectionResetError): pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=.01), daemon=True)
        thread.start()
        original_open = self.module.urllib.request.urlopen
        def owned_open(request, timeout):
            return original_open(self.module.urllib.request.Request(f"http://127.0.0.1:{server.server_port}", data=request.data), timeout=timeout)
        admitted = SimpleNamespace(recheck=lambda _task: None, fixtures={"simple-midi": {"ocxExecutable": "/owned"}},
            bind_runtime=lambda *_args: None, append=lambda _record: None)
        try:
            with tempfile.TemporaryDirectory() as directory, patch.object(self.module, "qualify_runtime", return_value={"nativeQuotaIncluded": True}), patch.object(self.module.urllib.request, "urlopen", side_effect=owned_open):
                started = time.monotonic()
                with self.assertRaises(TimeoutError):
                    self.module.model_request("gpt-6-luna", {}, {"id": "owned", "task": "simple-midi", "model": "gpt-6-luna"},
                        Path(directory), started + .2, 0, self.module.CORE.Budget(5), admitted)
                self.assertLess(time.monotonic() - started, .4)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_late_final_response_cannot_qualify(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            skill = root / "skills/keyspilli-song/SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text("# Owned control")
            admitted = SimpleNamespace(experiment={"skillSnapshots": {"old": {"path": str(root)}}}, admission_count=lambda _id: 0)
            cell = {"id": "owned", "task": "unqualified-url", "model": "gpt-6-luna", "skill": "old", "repetition": 1}
            clock = [0.0]
            def late_response(*_args):
                clock[0] = 901
                return {"role": "assistant", "content": '{"status":"refused-or-incomplete","musicalAcceptance":"not-established","productionAdmission":false}'}
            with patch.object(self.module.time, "monotonic", side_effect=lambda: clock[0]), patch.object(self.module, "model_request", side_effect=late_response):
                result = self.module.evaluate_cell(cell, {"description": "No qualified source"}, root, self.module.CORE.Budget(5), admitted)
            self.assertFalse(result["verified"])
            self.assertIn("deadline", result["error"])


if __name__ == "__main__":
    unittest.main()
