#!/usr/bin/env python3
"""Opt-in restore proof using a local immutable web image; never starts a worker."""
import json
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path


def verify(manifest_path, destination, image_id, revision, song_id):
    manifest = json.loads(Path(manifest_path).read_text())
    report_path = Path(destination).resolve() / "restore-report.json"
    report = json.loads(report_path.read_text())
    recorded = (manifest.get("images") or {}).get("web", {})
    if (not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id)
            or not re.fullmatch(r"[a-f0-9]{40}", revision)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", song_id)
            or recorded.get("id") != image_id or recorded.get("revision") != revision):
        raise ValueError("pinned web image/revision must match the backup metadata")
    runtime = report_path.parent / "runtime"
    verifier = Path(__file__).with_name("restore-app-verifier.mjs").resolve()
    if ":" in str(runtime) or ":" in str(verifier):
        raise ValueError("restore paths cannot contain a Docker volume separator")

    def docker(*args, timeout=30):
        # Never relay container output that may contain restored private metadata.
        return subprocess.run(["docker", *args], check=True, capture_output=True, timeout=timeout, text=True).stdout

    actual = docker("image", "inspect", "--format", "{{.Id}}", image_id).strip()
    if actual != image_id:
        raise ValueError("local immutable image is unavailable")
    name = f"keyspilli-restore-{uuid.uuid4().hex[:12]}"
    created = False
    started = time.monotonic()
    report["applicationVerification"] = "failed"
    try:
        docker("create", "--pull=never", "--name", name, "--network", "none",
               "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=512m",
               "-v", f"{runtime}:/data", "-v", f"{verifier}:/restore-app-verifier.mjs:ro",
               "-e", "HOSTNAME=127.0.0.1", "-e", "PORT=3000", "-e", "HOME=/tmp",
               "-e", "KEYSPILLI_DATA_DIR=/data", "-e", "KEYSPILLI_ORIGIN=http://127.0.0.1:3000",
               "-e", "KEYSPILLI_TUTORIAL_BETA=0", image_id)
        created = True
        docker("start", name)
        proof = json.loads(docker("exec", name, "node", "/restore-app-verifier.mjs",
                                  revision, song_id, str(report["catalogSchemaEpoch"]), timeout=240))
        report.update(applicationVerification="passed", application=proof, webImageId=image_id,
                      restoredRevision=revision)
    finally:
        report["applicationElapsedSeconds"] = round(time.monotonic() - started, 3)
        if created:
            try:
                docker("rm", "-f", name)
            except Exception:
                report["applicationVerification"] = "failed"
                report["cleanup"] = "failed"
                report_path.write_text(json.dumps(report, indent=2) + "\n")
                raise
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    try:
        if len(sys.argv) != 6:
            raise ValueError("expected manifest, fresh destination, image ID, revision and song ID")
        verify(*sys.argv[1:])
    except Exception:
        print("restore app verification failed; inspect the isolated restore report", file=sys.stderr)
        sys.exit(1)
