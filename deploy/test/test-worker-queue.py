#!/usr/bin/env python3
"""The host queue sample must survive a stopped worker without writing the catalog."""
import importlib.util
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ops", Path(__file__).parents[1] / "keyspilli-ops-check.py")
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)

class WorkerQueue(unittest.TestCase):
    def test_stopped_worker_collection_reads_catalog_and_refuses_missing_or_broken_databases(self):
        with tempfile.TemporaryDirectory(prefix="keyspilli-queue-test-") as directory:
            root = Path(directory)
            database = root / "db.sqlite"
            with sqlite3.connect(database) as connection:
                connection.execute("CREATE TABLE conversion_jobs (id TEXT, status TEXT, created_at TEXT)")
                connection.executemany("INSERT INTO conversion_jobs VALUES (?, ?, ?)", [(f"private-{i}", "queued", "2026-01-01T00:00:00Z") for i in range(7)])
            before = database.read_bytes()
            web = {"Mounts": [{"Destination": "/data", "Source": directory}]}
            with patch.object(ops, "inspect", side_effect=lambda name: web if name == "keyspilli" else {"State": {"Status": "exited"}}), \
                 patch.object(ops, "http_json", return_value={}), patch.object(ops, "latest_coherent_pair", return_value=None), \
                 patch.object(ops, "worker_heartbeat", return_value={"heartbeatState": "unknown", "heartbeatHealthy": False}), \
                 patch.object(ops, "tls_days", return_value=42), patch.object(ops, "anonymous_status", return_value=401), \
                 patch.object(ops, "run", return_value=""), \
                 patch.object(ops.subprocess, "run", return_value=SimpleNamespace(stdout="", stderr="", returncode=0)):
                collected = ops.collect("routine")
            self.assertEqual(collected["worker"]["queuedSample"], 5)
            self.assertEqual(collected["worker"]["queueSampleState"], "available")
            self.assertGreater(collected["worker"]["oldestQueuedAgeMs"], 0)
            self.assertIn("queued_without_worker", ops.evaluate(collected, "routine")["failures"])
            self.assertNotIn("private-", str(collected))
            self.assertEqual(database.read_bytes(), before)
            with patch.object(ops, "inspect", side_effect=[web, ops.subprocess.CalledProcessError(1, "docker inspect")]), \
                 patch.object(ops, "http_json", return_value={}), patch.object(ops, "latest_coherent_pair", return_value=None), \
                 patch.object(ops, "worker_heartbeat", return_value={"heartbeatHealthy": False}), \
                 patch.object(ops, "tls_days", return_value=42), patch.object(ops, "anonymous_status", return_value=401), \
                 patch.object(ops, "run", return_value=""), \
                 patch.object(ops.subprocess, "run", return_value=SimpleNamespace(stdout="", stderr="", returncode=0)):
                self.assertIn("queued_without_worker", ops.evaluate(ops.collect("routine"), "routine")["failures"])

            with sqlite3.connect(database) as writer:
                writer.execute("BEGIN EXCLUSIVE")
                started = time.monotonic()
                self.assertIsNone(ops.queue_sample(database)["queuedSample"])
                self.assertLess(time.monotonic() - started, 0.5)
                writer.rollback()
            missing = root / "missing.sqlite"
            self.assertIsNone(ops.queue_sample(missing)["queuedSample"])
            self.assertFalse(missing.exists())
            database.write_bytes(b"invalid database")
            self.assertIsNone(ops.queue_sample(database)["queuedSample"])

if __name__ == "__main__":
    unittest.main()
