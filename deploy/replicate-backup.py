#!/usr/bin/env python3
"""Replicate one immutable, committed backup pair; completion marker is uploaded last."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}-\d{6}$")
REMOTE = re.compile(r"^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9][A-Za-z0-9/_-]{0,199}$")


def pair(manifest_path, deadline):
    if not re.fullmatch(r"backup-manifest-\d{4}-\d{2}-\d{2}-\d{6}\.json", manifest_path.name):
        raise ValueError("invalid manifest name")
    if manifest_path.is_symlink() or manifest_path.stat().st_size > 32768:
        raise ValueError("invalid manifest")
    document = json.loads(manifest_path.read_text())
    if not isinstance(document, dict):
        raise ValueError("invalid manifest root")
    stamp = document.get("stamp")
    if document.get("complete") is not True or not isinstance(stamp, str) or not STAMP.fullmatch(stamp):
        raise ValueError("incomplete manifest")
    if manifest_path.name != f"backup-manifest-{stamp}.json":
        raise ValueError("invalid manifest name")
    files = []
    for key, name in (("db", f"db-{stamp}.sqlite"), ("archive", f"artifacts-{stamp}.tar.gz")):
        if document.get(f"{key}File") != name or not re.fullmatch(r"[a-f0-9]{64}", str(document.get(f"{key}Sha256", ""))):
            raise ValueError("invalid pair names or hashes")
        path = manifest_path.parent / name
        if path.is_symlink() or not stat.S_ISREG(path.stat().st_mode):
            raise ValueError("invalid pair file")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                if time.monotonic() >= deadline:
                    raise TimeoutError("validation deadline")
                digest.update(chunk)
        if digest.hexdigest() != document[f"{key}Sha256"]:
            raise ValueError("pair checksum mismatch")
        files.append(path)
    return stamp, files


def latest(root):
    # ponytail: bounded local snapshot inventory; raise the ceiling only if retention intentionally exceeds 512 pairs.
    files = list(root.glob("backup-manifest-*.json"))
    if not files or len(files) > 512:
        raise ValueError("no backup or excessive inventory")
    return max(files, key=lambda path: path.name)


def replicate(manifest, remote, run, deadline):
    if not REMOTE.fullmatch(remote) or "//" in remote or ".." in remote:
        raise ValueError("invalid dedicated remote directory")
    stamp, files = pair(manifest, deadline)
    destination = f"{remote.rstrip('/')}/{stamp}"
    # Hard links keep the immutable local pair alive if local retention unlinks it during a slow transfer.
    with tempfile.TemporaryDirectory(prefix=".keyspilli-offhost-", dir=manifest.parent) as scratch:
        root = Path(scratch)
        for source in [*files, manifest]:
            os.link(source, root / source.name)
        names = root / ".verify-files"
        names.write_text("\n".join(source.name for source in files) + "\n")
        for source in files:
            run("data-upload", ["copyto", str(root / source.name), f"{destination}/{source.name}", "--immutable"])
        run("data-verification", ["check", str(root), destination, "--download", "--one-way", "--files-from", str(names)])
        pair(root / manifest.name, deadline)
        run("completion-upload", ["copyto", str(root / manifest.name), f"{destination}/{manifest.name}", "--immutable"])
        names.write_text(names.read_text() + manifest.name + "\n")
        run("completion-verification", ["check", str(root), destination, "--download", "--one-way", "--files-from", str(names)])
    return stamp


def write_status(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".replication-status-", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(payload, stream); stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest", type=Path); source.add_argument("--latest", type=Path)
    parser.add_argument("--remote", default=os.environ.get("KEYSPILLI_BACKUP_REMOTE", ""))
    parser.add_argument("--config", default=os.environ.get("KEYSPILLI_RCLONE_CONFIG"))
    parser.add_argument("--rclone", default="/usr/bin/rclone")
    parser.add_argument("--status", type=Path, default=Path("/backups/keyspilli-replication-status.json"))
    args = parser.parse_args()
    deadline = time.monotonic() + 1800
    stage = "validation"
    status = {"schemaVersion": 1, "state": "running", "startedAt": time.time(), "retention": "no-remote-deletion"}
    try:
        write_status(args.status, status)
        manifest = args.manifest if args.manifest else latest(args.latest)
        def run(current_stage, command):
            nonlocal stage
            stage = current_stage
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("replication deadline")
            common = ["--retries", "2", "--low-level-retries", "3", "--contimeout", "10s", "--timeout", "60s"]
            if args.config:
                common += ["--config", args.config]
            # No subprocess output is relayed: account/path/provider errors can contain private material.
            subprocess.run([args.rclone, *command, *common], check=True, timeout=remaining, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        stamp = replicate(manifest, args.remote, run, deadline)
        write_status(args.status, {**status, "state": "success", "stamp": stamp, "finishedAt": time.time(), "verified": True})
        print("off-host backup pair verified; remote retention unchanged")
        return 0
    except (OSError, ValueError, TimeoutError, subprocess.SubprocessError):
        try:
            write_status(args.status, {**status, "state": "failed", "stage": stage, "finishedAt": time.time(), "verified": False})
        except OSError:
            pass
        print(f"off-host backup failed at {stage}; local backup remains available")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
