import importlib.util
import json
import hashlib
import subprocess
import tempfile
import unittest
import sys
from unittest.mock import patch
from pathlib import Path
from types import ModuleType


class WorkflowAdmissionTests(unittest.TestCase):
    module = ModuleType("not_loaded")
    core = ModuleType("not_loaded")

    def setUp(self):
        path = Path(__file__).with_name("keyspilli_workflow_api_admission.py")
        self.assertTrue(path.is_file(), "durable exact-input admission is missing")
        spec = importlib.util.spec_from_file_location("api_admission", path)
        assert spec is not None and spec.loader is not None
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        spec = importlib.util.spec_from_file_location("workflow_core", path.with_name("evaluate-keyspilli-workflow.py"))
        assert spec is not None and spec.loader is not None
        self.core = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.core)

    def make_inputs(self, root):
        checkout = root / "checkout"
        checkout.mkdir()
        subprocess.run(["git", "init", "-q", str(checkout)], check=True)
        subprocess.run(["git", "-C", str(checkout), "-c", "commit.gpgsign=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                        "commit", "-q", "--allow-empty", "-m", "Fixture"], check=True)
        old, new = root / "old", root / "new"
        for source in (old, new):
            skill = source / "skills/keyspilli-song/SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text("# Fixture\n")
            (source / "source-members.json").write_text(json.dumps({"members": ["skills/keyspilli-song/SKILL.md", "source-members.json"],
                "sha256": {"skills/keyspilli-song/SKILL.md": hashlib.sha256(skill.read_bytes()).hexdigest()}}))
        asset = root / "source.mid"
        asset.write_bytes(b"owned fixture")
        fixture = {"source": str(asset), "instruction": str(asset), "node": str(asset), "soundfont": str(asset),
                   "renderer": str(asset), "ocxExecutable": str(asset), "description": "Owned admission fixture", "title": "Fixture", "artist": "Software control"}
        fixture = self.module.pin_fixture(fixture)
        fixtures_path = root / "fixtures.json"
        fixtures_path.write_text(json.dumps({task: fixture for task in self.core.TASKS}))
        experiment_path = root / "experiment.json"
        self.core.freeze(checkout, old, new, experiment_path)
        return experiment_path, fixtures_path, new, asset

    def test_same_experiment_cannot_reset_budget_with_new_results_or_manifest_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            experiment, fixtures, _new, _asset = self.make_inputs(root)
            first = self.module.Admission(experiment, fixtures, root / "results")
            with first:
                budget = self.core.Budget(5)
                reservation = budget.reserve("B.AI/mimo-v2.6-flash", 35_710_000, 0)
                first.append({"kind": "admitted", "reservedUsd": reservation.cost})
            with self.module.Admission(experiment, fixtures, root / "results") as resumed:
                self.assertGreater(resumed.accounted_usd, 4.99)
            with self.assertRaises(ValueError):
                self.module.Admission(experiment, fixtures, root / "new-results")
            self.assertFalse((root / "new-results").exists())
            copied = root / "copied-experiment.json"
            copied.write_bytes(experiment.read_bytes())
            with self.assertRaises(ValueError):
                self.module.Admission(copied, fixtures, root / "another-results")
            self.assertFalse((root / "another-results").exists())

    def test_snapshot_or_escaping_cell_destination_refused_before_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            experiment, fixtures, new, _asset = self.make_inputs(root)
            before = sorted(str(p.relative_to(new)) for p in new.rglob("*"))
            with self.assertRaises(ValueError):
                self.module.Admission(experiment, fixtures, new)
            self.assertEqual(sorted(str(p.relative_to(new)) for p in new.rglob("*")), before)
            payload = json.loads(experiment.read_text())
            payload["cells"][0]["id"] = "../outside"
            experiment.write_text(json.dumps(payload))
            with self.assertRaises(ValueError):
                self.module.Admission(experiment, fixtures, root / "results")
            self.assertFalse((root / "results").exists())

    def test_changed_payload_refused_at_admission_and_consumption(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            experiment, fixtures, _new, asset = self.make_inputs(root)
            original = asset.read_bytes()
            asset.write_bytes(b"changed with unchanged manifest")
            with self.assertRaises(ValueError):
                self.module.Admission(experiment, fixtures, root / "results")
            self.assertFalse((root / "results").exists())
            asset.write_bytes(original)
            with self.module.Admission(experiment, fixtures, root / "results") as admitted:
                asset.write_bytes(b"changed after admission")
                with self.assertRaises(ValueError):
                    admitted.recheck("simple-midi")

    def test_relative_consumed_path_refused_with_different_parent_and_checkout_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            experiment, fixtures, _new, asset = self.make_inputs(root)
            (root / "checkout/source.mid").write_bytes(b"different consumed bytes")
            payload = json.loads(fixtures.read_text())
            for fixture in payload.values(): fixture["source"] = "source.mid"
            fixtures.write_text(json.dumps(payload))
            with patch("os.getcwd", return_value=str(root)), patch.object(self.module, "pin_asset", return_value={"path": str(asset), "sha256": self.module.sha(asset)}):
                with self.assertRaisesRegex(ValueError, "absolute"):
                    self.module.Admission(experiment, fixtures, root / "results")
            self.assertFalse((root / "results").exists())

    def test_explicit_route_retry_preserves_campaign_money_and_original_block(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            experiment, fixtures, _new, _asset = self.make_inputs(root)
            results = root / "results"
            with self.module.Admission(experiment, fixtures, results) as admission:
                admission.append({"kind": "admitted", "reservedUsd": .09212504})
                admission.block_route("gpt-6-luna", "retained HTTP401")
            with self.module.Admission(experiment, fixtures, results) as admission:
                before = admission.accounted_usd
                admission.retry_route("gpt-6-luna")
                self.assertEqual(admission.accounted_usd, before)
                self.assertNotIn("gpt-6-luna", admission.blocked_routes)
                with self.assertRaisesRegex(ValueError, "already"):
                    admission.retry_route("gpt-6-luna")
            with self.module.Admission(experiment, fixtures, results) as admission:
                self.assertEqual(admission.accounted_usd, .09212504)
                self.assertIn("gpt-6-luna", admission.blocked_routes)
                admission.stopped = True
                with self.assertRaises(ValueError):
                    admission.retry_route("B.AI/mimo-v2.6-flash")

    def test_verified_transport_recovery_reuses_the_frozen_experiment_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            experiment, fixtures, _new, _asset = self.make_inputs(root)
            results = root / "results"
            with self.module.Admission(experiment, fixtures, results) as admitted:
                admitted.append({"kind": "admitted", "reservedUsd": .09212504})
                admitted.block_route("gpt-6-luna", "retained401")
                admitted.retry_route("gpt-6-luna")
                response = results / "response.json"
                response.write_text('{"model":"main/gpt-6-luna"}')
                admitted.record_success("gpt-6-luna", response)
            with self.module.Admission(experiment, fixtures, results) as admitted:
                self.assertNotIn("gpt-6-luna", admitted.blocked_routes)
                self.assertEqual(admitted.accounted_usd, .09212504)
            response.write_text("tampered")
            with self.assertRaisesRegex(ValueError, "proof"):
                self.module.Admission(experiment, fixtures, results)

    def test_later_block_invalidates_success_cache_before_explicit_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            experiment, fixtures, _new, _asset = self.make_inputs(root)
            results = root / "results"
            with self.module.Admission(experiment, fixtures, results) as admitted:
                admitted.append({"kind": "admitted", "reservedUsd": .09212504})
                first = results / "first.json"; first.write_text('{"model":"main/gpt-6-luna"}')
                admitted.record_success("gpt-6-luna", first)
                admitted.block_route("gpt-6-luna", "later429")
            with self.module.Admission(experiment, fixtures, results) as admitted:
                self.assertIn("gpt-6-luna", admitted.blocked_routes)
                admitted.retry_route("gpt-6-luna")
                second = results / "second.json"; second.write_text('{"model":"main/gpt-6-luna","recovered":true}')
                admitted.record_success("gpt-6-luna", second)
            with self.module.Admission(experiment, fixtures, results) as admitted:
                self.assertNotIn("gpt-6-luna", admitted.blocked_routes)
                self.assertEqual(admitted.accounted_usd, .09212504)

    def test_legacy_invalid_usage_stays_unknown_on_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            experiment, fixtures, _new, _asset = self.make_inputs(root)
            with self.module.Admission(experiment, fixtures, root / "results") as admitted:
                admitted.append({"kind": "admitted", "reservedUsd": .04})
                admitted.append({"kind": "settled", "usage": {"prompt_tokens": -1, "completion_tokens": 0}, "deltaUsd": 0})
            with self.module.Admission(experiment, fixtures, root / "results") as admitted:
                self.assertEqual(admitted.accounted_usd, .04)
                self.assertEqual(admitted.unknown_usage_calls, 1)

    def test_streamed_quota_and_auth_errors_stop_only_the_affected_route(self):
        api = self.module.load_module("run-keyspilli-workflow-api")
        for error_type, code in (("rate_limit_error", "rate_limit_exceeded"), ("authentication_error", "invalid_api_key")):
            with self.subTest(error_type=error_type), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                experiment, fixtures, _new, _asset = self.make_inputs(root)
                requests = []
                raw = ("data: " + json.dumps({"error": {"type": error_type, "code": code, "message": "Owned stream refusal"}}) + "\n\n").encode()
                class Response:
                    def __init__(self, request, timeout): requests.append(json.loads(request.data)["model"])
                    def __enter__(self): return self
                    def __exit__(self, *_args): pass
                    def read(self, _bound): return raw
                runtime = {"nativeQuotaIncluded": True}
                argv = ["executor", "--experiment", str(experiment), "--fixtures", str(fixtures), "--results", str(root / "results"), "--limit", "2"]
                with patch.object(sys, "argv", argv), patch.object(api, "qualify_runtime", return_value=runtime), patch.object(api.urllib.request, "urlopen", side_effect=Response):
                    api.main()
                self.assertEqual(requests, ["main/gpt-6-luna"])
                with self.module.Admission(experiment, fixtures, root / "results") as admitted:
                    self.assertIn("gpt-6-luna", admitted.blocked_routes)
                    self.assertEqual(admitted.unknown_usage_calls, 1)

    def test_invalid_usage_keeps_unknown_counts_and_money_after_actual_resume(self):
        api = self.module.load_module("run-keyspilli-workflow-api")
        for usage in ({"prompt_tokens": -1, "completion_tokens": 0}, {"prompt_tokens": 1}, {"prompt_tokens": "1", "completion_tokens": 1}, {"prompt_tokens": True, "completion_tokens": 0}):
            with self.subTest(usage=usage), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                experiment, fixtures, _new, _asset = self.make_inputs(root)
                raw = json.dumps({"model": "mimo-v2.6-flash", "usage": usage, "choices": [{"message": {"role": "assistant", "content": "{}"}}]}).encode()
                class Response:
                    def __enter__(self): return self
                    def __exit__(self, *_args): pass
                    def read(self, _bound): return raw
                with self.module.Admission(experiment, fixtures, root / "results") as admitted:
                    cell = next(c for c in admitted.experiment["cells"] if c["model"] == "B.AI/mimo-v2.6-flash")
                    budget = api.CORE.Budget(5)
                    with patch.object(api, "qualify_runtime", return_value={"nativeQuotaIncluded": False}), patch.object(api.urllib.request, "urlopen", return_value=Response()):
                        api.evaluate_cell(cell, admitted.fixtures[cell["task"]], root / "results", budget, admitted)
                    self.assertEqual(budget.unknown_usage_calls, 1)
                    money = budget.spent
                with self.module.Admission(experiment, fixtures, root / "results") as admitted:
                    self.assertEqual(admitted.unknown_usage_calls, 1)
                    self.assertEqual(admitted.accounted_usd, money)

    def test_native_quota_entitlement_rejects_paid_backend_and_after_limit_spending(self):
        runtime = self.module.load_module("keyspilli_workflow_api_runtime")
        catalog = {"data": [{"id": "gpt-6-luna", "owned_by": "openai", "api_types": ["chat_completions"], "capabilities": {"supports_tool_use": True}}]}
        provider = {"name": "openai", "baseUrl": "https://chatgpt.com/backend-api/codex", "adapter": "openai-responses", "authMode": "forward"}
        account = {"id": "__main__", "provider": "openai", "active": True, "type": "codex", "plan": "prolite", "needsReauth": False,
            "paused": False, "creditsAfterLimit": False, "health": "Healthy", "quota": {"weeklyPercent": 30}, "quotaRefresh": {"status": "ok"}}
        result = runtime.validate_runtime("gpt-6-luna", catalog, [provider], {"accounts": [account]}, {"enabled": False}, {})
        self.assertEqual(result["model"], "gpt-6-luna")
        self.assertTrue(result["nativeQuotaIncluded"])
        with self.assertRaises(ValueError):
            runtime.validate_runtime("gpt-6-luna", catalog, [{**provider, "baseUrl": "https://api.openai.com/v1"}], {"accounts": [account]}, {"enabled": False}, {})
        for replacement in [{"creditsAfterLimit": True}, {"quota": {}}, {"quota": {"weeklyPercent": 100}}, {"quotaRefresh": {"status": "unknown"}}]:
            with self.assertRaises(ValueError):
                runtime.validate_runtime("gpt-6-luna", catalog, [provider], {"accounts": [{**account, **replacement}]}, {"enabled": False}, {})

    def test_executor_main_resumes_shared_budget_and_refuses_a_new_destination_before_dispatch(self):
        api = self.module.load_module("run-keyspilli-workflow-api")
        requests = []
        def qualified(model, _executable):
            return {"model": model, "checkedAt": "owned-offline-control", "nativeQuotaIncluded": model == "gpt-6-luna",
                "nativeAccountIdentitySha256": "control", "nativePlan": "control", "nativeWeeklyUsedPercent": 0,
                "routes": {}, "ratesUsdPerMillion": {}, "shadowCallsDisabled": True, "ocxExecutable": "control", "ocxVersion": "control"}
        class Response:
            def __init__(self, request, timeout):
                assert 0 < timeout <= 180
                self.model = json.loads(request.data)["model"]
                requests.append(self.model)
            def __enter__(self): return self
            def __exit__(self, *_args): pass
            def read(self, _bound):
                final = {"status": "refused-or-incomplete", "explanation": "Owned offline control", "playbackIndex": None,
                         "musicalAcceptance": "not-established", "productionAdmission": False}
                return json.dumps({"model": self.model.removeprefix("main/"), "usage": {"prompt_tokens": 1, "completion_tokens": 1},
                    "choices": [{"message": {"role": "assistant", "content": json.dumps(final)}}]}).encode()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            experiment, fixtures, _new, _asset = self.make_inputs(root)
            results = root / "results"
            with self.module.Admission(experiment, fixtures, results) as admitted:
                admitted.append({"kind": "admitted", "reservedUsd": 4.9994})
            def invoke(destination, limit):
                argv = ["run-keyspilli-workflow-api.py", "--experiment", str(experiment), "--fixtures", str(fixtures), "--results", str(destination), "--limit", str(limit)]
                with patch.object(sys, "argv", argv), patch.object(api, "qualify_runtime", side_effect=qualified), patch.object(api.urllib.request, "urlopen", side_effect=Response):
                    api.main()
            invoke(results, 1)
            invoke(results, 4)
            self.assertEqual(requests, ["main/gpt-6-luna", "main/gpt-6-luna"])
            summary = json.loads((results / "summary-4.json").read_text())
            self.assertLessEqual(summary["accountedUsd"], 5)
            self.assertEqual(summary["summary"]["executed"], 2)
            with self.assertRaises(ValueError): invoke(root / "new-results", 4)
            self.assertFalse((root / "new-results").exists())


if __name__ == "__main__":
    unittest.main()
