#!/usr/bin/env python3
"""One isolated pair proves completion ordering, resume safety, corruption refusal and redaction."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

spec = importlib.util.spec_from_file_location("replicate", Path(__file__).resolve().parents[1] / "replicate-backup.py")
replicate = importlib.util.module_from_spec(spec); spec.loader.exec_module(replicate)
with tempfile.TemporaryDirectory(prefix="keyspilli-offhost-check-") as scratch:
    root = Path(scratch); local = root / "local"; remote = root / "remote"; local.mkdir(); remote.mkdir()
    stamp = "2026-10-02-030000"
    db = local / f"db-{stamp}.sqlite"; archive = local / f"artifacts-{stamp}.tar.gz"
    db.write_bytes(b"authored database fixture"); archive.write_bytes(b"authored archive fixture")
    manifest = local / f"backup-manifest-{stamp}.json"
    manifest.write_text(json.dumps({"complete": True, "stamp": stamp, "dbFile": db.name, "archiveFile": archive.name,
        "dbSha256": hashlib.sha256(db.read_bytes()).hexdigest(), "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest()}))
    stages = []
    def run(stage, command):
        stages.append(stage)
        if command[0] == "copyto":
            source = Path(command[1]); target = remote / source.name
            if target.exists() and target.read_bytes() != source.read_bytes(): raise ValueError("immutable conflict")
            shutil.copyfile(source, target)
        else:
            for name in Path(command[command.index("--files-from") + 1]).read_text().splitlines():
                assert (Path(command[1]) / name).read_bytes() == (remote / name).read_bytes()
            if stage == "data-verification": assert not (remote / manifest.name).exists() or (remote / manifest.name).read_bytes() == manifest.read_bytes()
    assert replicate.replicate(manifest, "drive:Keyspilli/backups", run, time.monotonic() + 60) == stamp
    assert stages == ["data-upload", "data-upload", "data-verification", "completion-upload", "completion-verification"]
    replicate.replicate(manifest, "drive:Keyspilli/backups", run, time.monotonic() + 60)
    for target in remote.iterdir(): target.unlink()
    def fail_verify(stage, command):
        if stage == "data-verification": raise ValueError("provider unavailable")
        run(stage, command)
    try: replicate.replicate(manifest, "drive:Keyspilli/backups", fail_verify, time.monotonic() + 60)
    except ValueError: pass
    else: raise AssertionError("failed remote verification accepted")
    assert not (remote / manifest.name).exists()
    assert not list(local.glob(".keyspilli-offhost-*"))
    replicate.replicate(manifest, "drive:Keyspilli/backups", run, time.monotonic() + 60)
    archive.write_bytes(b"corrupt")
    count = len(stages)
    try: replicate.replicate(manifest, "drive:Keyspilli/backups", run, time.monotonic() + 60)
    except ValueError: pass
    else: raise AssertionError("corruption accepted")
    assert len(stages) == count
    status = root / "status.json"
    result = subprocess.run(["python3", str(Path(spec.origin)), "--manifest", str(manifest), "--remote", "drive:Keyspilli/backups", "--status", str(status)], capture_output=True, text=True)
    assert result.returncode == 1
    assert "failed at validation" in result.stdout and str(root) not in result.stdout + result.stderr
    assert json.loads(status.read_text())["verified"] is False
    assert not list(local.glob(".keyspilli-offhost-*"))
print("backup replication fixture passed")

ops_spec = importlib.util.spec_from_file_location("ops", Path(spec.origin).parent / "keyspilli-ops-check.py")
ops = importlib.util.module_from_spec(ops_spec); ops_spec.loader.exec_module(ops)
with tempfile.TemporaryDirectory(prefix="keyspilli-offhost-status-") as scratch:
    status = Path(scratch) / "status.json"
    assert ops.offhost_status(status, False) == {"enabled": False, "state": "disabled"}
    assert ops.offhost_status(status, True)["state"] == "unknown"
    status.write_text(json.dumps({"schemaVersion": 1, "state": "success", "verified": True, "finishedAt": time.time(), "secret": "do not relay"}))
    assert ops.offhost_status(status, True)["verified"] is True
    assert "secret" not in ops.offhost_status(status, True)
    status.write_text("x" * 32769); assert ops.offhost_status(status, True)["state"] == "unknown"
print("off-host status checks passed")

for state, age, verified, expected in [("success", 1, True, "healthy"), ("failed", 1, False, "failed"), ("success", 49, True, "failed")]:
    report = ops.evaluate({"offHost": {"enabled": True, "state": state, "ageHours": age, "verified": verified}}, "shallow")
    assert report["checks"]["offHost"]["status"] == expected
print("off-host freshness/failure checks passed")
