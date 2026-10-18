#!/usr/bin/env python3
"""Exercise the real restore controller against an isolated Docker boundary."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "restore-app.py"
SPEC = importlib.util.spec_from_file_location("restore_app", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
restore = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(restore)
IMAGE = "sha256:" + "a" * 64
REVISION = "b" * 40


class RestoreRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="keyspilli-restore-controller-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.manifest = self.root / "manifest.json"
        self.manifest.write_text(json.dumps({"images": {"web": {"id": IMAGE, "revision": REVISION}}}))
        self.destination = self.root / "restored"
        (self.destination / "runtime").mkdir(parents=True)
        self.report = self.destination / "restore-report.json"
        self.report.write_text(json.dumps({"catalogSchemaEpoch": 1}))
        self.calls = []

    def invoke(self, quota=1_500_000_000, fail_exec=False, sampled=False, native=None, exec_error=None, fail_cleanup=False):
        def docker(argv, **_kwargs):
            self.calls.append(argv)
            operation = argv[1]
            if operation == "image":
                output = "amd64" if "{{.Architecture}}" in argv else IMAGE
            elif operation == "inspect":
                output = json.dumps({"NanoCpus": quota, "Memory": 1_073_741_824, "PidsLimit": 128})
            elif operation == "exec":
                if exec_error:
                    raise exec_error
                if fail_exec:
                    raise subprocess.CalledProcessError(73, argv)
                output = json.dumps(native if any("verify-native-player.mts" in arg for arg in argv) else {"exportValidation": "framing_only", "browserPlaybackAcceptance": "not_tested"})
            elif operation == "rm" and fail_cleanup:
                raise subprocess.CalledProcessError(74, argv)
            else:
                output = ""
            return subprocess.CompletedProcess(argv, 0, output, "")
        with patch.object(restore.subprocess, "run", side_effect=docker), contextlib.redirect_stdout(io.StringIO()), \
                patch.object(restore.platform, "system", return_value="Linux"), patch.object(restore.platform, "machine", return_value="x86_64"):
            restore.verify(self.manifest, self.destination, IMAGE, REVISION, "fixture", sampled=sampled)

    def test_actual_container_creation_uses_qualified_one_and_half_cpu_limit(self):
        self.invoke()
        create = next(call for call in self.calls if call[1] == "create")
        self.assertIn("--cpus", create)
        self.assertEqual(create[create.index("--cpus") + 1], "1.5")

    def test_reported_wrong_quota_refuses_before_start_and_releases_owned_container(self):
        with self.assertRaisesRegex(ValueError, "CPU"):
            self.invoke(quota=2_000_000_000)
        self.assertFalse(any(call[1] == "start" for call in self.calls))
        self.assertTrue(any(call[1:3] == ["rm", "-f"] for call in self.calls))
        self.assertEqual(json.loads(self.report.read_text())["applicationVerification"], "failed")

    def test_failed_verifier_retains_failure_and_releases_owned_container(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke(fail_exec=True)
        self.assertEqual(json.loads(self.report.read_text())["applicationVerification"], "failed")
        self.assertTrue(any(call[1:3] == ["rm", "-f"] for call in self.calls))


    def test_native_probe_is_distinct_from_framing_only_http_receipt(self):
        native = {"kind": "keyspilli-native-sampled", "revision": REVISION, "status": "passed"}
        self.invoke(sampled=True, native=native)
        report = json.loads(self.report.read_text())
        self.assertEqual(report["application"]["browserPlaybackAcceptance"], "not_tested")
        self.assertEqual(report["sampledBrowser"], native)
        create = next(call for call in self.calls if call[1] == "create")
        self.assertIn("KEYSPILLI_NATIVE_PROBE_SCOPE=owned-restore", create)
        self.assertTrue(any(arg.endswith("/qualification-source/node_modules:ro") for arg in create))
        self.assertFalse(any(arg.endswith(":/qualification-source") for arg in create))

    def test_missing_failed_or_wrong_revision_native_receipts_fail_closed(self):
        for native in ({}, {"kind": "keyspilli-native-sampled", "revision": "c" * 40, "status": "passed"},
                       {"kind": "keyspilli-native-sampled", "revision": REVISION, "status": "failed"}):
            with self.subTest(native=native):
                with self.assertRaisesRegex(ValueError, "incomplete"):
                    self.invoke(sampled=True, native=native)
                self.assertEqual(json.loads(self.report.read_text())["applicationVerification"], "failed")
                self.assertTrue(any(call[1:3] == ["rm", "-f"] for call in self.calls))
                (self.destination / "native-player").rmdir()
                self.calls.clear()

    def test_timeout_and_cancellation_release_container_without_marking_success(self):
        for error in (subprocess.TimeoutExpired(["docker", "exec"], 240), KeyboardInterrupt()):
            with self.subTest(error=type(error).__name__):
                with self.assertRaises(type(error)):
                    self.invoke(exec_error=error)
                self.assertEqual(json.loads(self.report.read_text())["applicationVerification"], "failed")
                self.assertTrue(any(call[1:3] == ["rm", "-f"] for call in self.calls))
                self.calls.clear()

    def test_cleanup_failure_cannot_be_reported_as_passed(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke(fail_cleanup=True)
        report = json.loads(self.report.read_text())
        self.assertEqual(report["applicationVerification"], "failed")
        self.assertEqual(report["cleanup"], "failed")

    def test_non_native_sampled_probe_refuses_before_docker(self):
        with patch.object(restore.platform, "system", return_value="Darwin"), \
                patch.object(restore.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "native Linux amd64"):
                restore.verify(self.manifest, self.destination, IMAGE, REVISION, "fixture", sampled=True)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
