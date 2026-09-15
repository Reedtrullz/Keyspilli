#!/usr/bin/env python3
"""Fixture tests for the host backup runner and data-only backup script."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import tarfile
import tempfile
import textwrap
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKUP = ROOT / "deploy/backup.sh"
RUNNER_TEMPLATE = ROOT / "deploy/templates/keyspilli-backup-runner.sh.j2"
RESTORE = ROOT / "deploy/restore-drill.sh"


def make_data(root: Path) -> Path:
    data = root / "data"
    (data / "artifacts" / ".test.reconciliation.json").parent.mkdir(parents=True)
    (data / "artifacts" / ".test.reconciliation.json").write_text('{"baseId":"test"}')
    (data / "artifacts" / ".test.old" / "kept").parent.mkdir()
    (data / "artifacts" / ".test.old" / "kept").write_text("old")
    (data / "seed-midi").mkdir()
    (data / "seed-midi" / "source.mid").write_bytes(b"MThd" + b"\0" * 20)
    with sqlite3.connect(data / "db.sqlite") as db:
        db.execute("CREATE TABLE songs (id TEXT PRIMARY KEY, base_id TEXT, tempo INTEGER)")
        db.execute("INSERT INTO songs VALUES ('s1', 'test-song', 120)")
    return data


def make_runner(root: Path) -> Path:
    rendered = RUNNER_TEMPLATE.read_text().replace("{{ app_dir }}", str(ROOT))
    rendered = rendered.replace("{% raw %}", "").replace("{% endraw %}", "")
    runner = root / "backup-runner.sh"
    runner.write_text(rendered)
    runner.chmod(0o755)
    return runner


def make_docker(root: Path, states: dict[str, str] | None = None) -> tuple[Path, Path]:
    state_dir = root / "states"
    state_dir.mkdir(exist_ok=True)
    for name, state in (states or {}).items():
        (state_dir / name).write_text(state)
    log = root / "docker.log"
    docker = root / "docker"
    flock = root / "flock"
    flock.write_text("#!/usr/bin/env bash\nexit 0\n")
    flock.chmod(0o755)
    timeout = root / "timeout"
    timeout.write_text(textwrap.dedent("""\
        #!/usr/bin/env bash
        set -eu
        while [[ "$1" == --* ]]; do shift; done
        shift
        if [ "${FAKE_TIMEOUT_EXPIRE:-0}" = 1 ]; then
          exit 124
        fi
        exec "$@"
    """))
    timeout.chmod(0o755)
    docker.write_text(textwrap.dedent(f"""\
        #!/usr/bin/env bash
        set -eu
        echo "$@" >> "{log}"
        if [ "$1" = inspect ]; then
          name="${{@: -1}}"
          format="${{4-${{3-}}}}"
          if [[ "$name" == keyspilli-backup-* ]]; then
            if [ "${{FAKE_DOCKER_CONTAINER_EXISTS:-0}}" != 1 ]; then exit 1; fi
            echo "running false"
            exit 0
          fi
          if [[ "$format" == *Config.Image* ]]; then
            echo fake-image
          else
            cat "{state_dir}/$name" 2>/dev/null || echo "running false"
          fi
          exit 0
        fi
        if [ "$1" = pause ]; then
          echo "paused true" > "{state_dir}/$2"
          exit 0
        fi
        if [ "$1" = unpause ]; then
          if [ "${{FAKE_DOCKER_FAIL_UNPAUSE:-}}" = "$2" ]; then exit 77; fi
          echo "running false" > "{state_dir}/$2"
          exit 0
        fi
        if [ "$1" = rm ]; then
          if [ "${{FAKE_DOCKER_FAIL_RM:-0}}" = 1 ]; then exit 77; fi
          exit 0
        fi
        if [ "$1" = run ]; then
          if printf '%s\n' "$@" | grep -q 'docker.sock'; then exit 91; fi
          if [ "${{FAKE_DOCKER_HANG:-0}}" = 1 ]; then trap 'exit 143' TERM INT; sleep 30; fi
          bash "$KEYSPILLI_BACKUP_SCRIPT"
          exit $?
        fi
        exit 92
    """))
    docker.chmod(0o755)
    return docker, log


def run_runner(root: Path, states: dict[str, str] | None = None, missing_db: bool = False, retention_days: int = 14, extra_env: dict[str, str] | None = None) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
    data = root / "data"
    if not data.exists():
        data = make_data(root)
    if missing_db:
        (data / "db.sqlite").unlink()
    backups = root / "backups"
    backups.mkdir(exist_ok=True)
    docker, log = make_docker(root, states)
    runner = make_runner(root)
    env = os.environ.copy()
    env.update({
        "KEYSPILLI_DOCKER_BIN": str(docker),
        "KEYSPILLI_BACKUP_LOCK": str(root / "backup.lock"),
        "KEYSPILLI_BACKUP_SCRIPT": str(BACKUP),
        "KEYSPILLI_BACKUP_DIR": str(backups),
        "KEYSPILLI_DATA_DIR": str(data),
        "KEYSPILLI_RETENTION_DAYS": str(retention_days),
        "PATH": f"{root}:{env['PATH']}",
    })
    env.update(extra_env or {})
    result = subprocess.run(["bash", str(runner)], env=env, capture_output=True, text=True, timeout=30)
    return result, backups, log


def manifests(backups: Path) -> list[Path]:
    return sorted(backups.glob("backup-manifest-*.json"))


def test_runner_pauses_pair_and_restores_only_its_pauses() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        result, backups, log = run_runner(root)
        assert result.returncode == 0, result.stderr
        lines = log.read_text().splitlines()
        assert sum(line.startswith("pause ") for line in lines) == 2
        assert sum(line.startswith("unpause ") for line in lines) == 2
        assert all("docker.sock" not in line for line in lines)
        assert "--user 0:0" in next(line for line in lines if line.startswith("run "))
        manifest = json.loads(manifests(backups)[0].read_text())
        assert manifest["complete"] is True
        assert hashlib.sha256((backups / manifest["dbFile"]).read_bytes()).hexdigest() == manifest["dbSha256"]
        with tarfile.open(backups / manifest["archiveFile"], "r:gz") as archive:
            names = archive.getnames()
        assert "artifacts/.test.reconciliation.json" in names
        assert "artifacts/.test.old/kept" in names
        print("  PASS: host runner pauses pair, runs socket-free backup, and commits checksummed pair")


def test_runner_unpauses_only_containers_paused_by_this_run() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        result, _backups, log = run_runner(root, {"keyspilli": "paused true"})
        assert result.returncode == 0, result.stderr
        lines = log.read_text().splitlines()
        assert "pause keyspilli" not in lines
        assert any(line.startswith("pause keyspilli-worker") for line in lines)
        assert "unpause keyspilli" not in lines
        assert any(line.startswith("unpause keyspilli-worker") for line in lines)
        print("  PASS: prior paused state is preserved")


def test_runner_failure_has_no_manifest_and_unpauses() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        result, backups, log = run_runner(root, missing_db=True)
        assert result.returncode != 0, result.stderr
        assert not manifests(backups)
        lines = log.read_text().splitlines()
        assert sum(line.startswith("unpause ") for line in lines) == 2
        print("  PASS: failed backup has no completion manifest and releases only its pauses")


def test_runner_timeout_cleans_named_container_and_unpauses() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        result, backups, log = run_runner(root, extra_env={"FAKE_TIMEOUT_EXPIRE": "1"})
        assert result.returncode != 0
        assert not manifests(backups)
        lines = log.read_text().splitlines()
        assert any(line.startswith("rm -f keyspilli-backup-") for line in lines)
        assert sum(line.startswith("unpause ") for line in lines) == 2
        print("  PASS: timeout cleans the named backup container and releases pauses")


def test_runner_returns_failure_when_unpause_fails() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        result, _backups, log = run_runner(root, extra_env={"FAKE_DOCKER_FAIL_UNPAUSE": "keyspilli-worker"})
        assert result.returncode != 0
        assert "unpause keyspilli-worker" in log.read_text().splitlines()
        print("  PASS: unpause failure cannot report a successful backup")


def test_runner_returns_failure_when_container_cleanup_fails() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        result, _backups, log = run_runner(root, extra_env={
            "FAKE_DOCKER_FAIL_RM": "1",
            "FAKE_DOCKER_CONTAINER_EXISTS": "1",
        })
        assert result.returncode != 0
        assert any(line.startswith("rm -f keyspilli-backup-") for line in log.read_text().splitlines())
        print("  PASS: container cleanup failure cannot report a successful backup")


def test_retention_deletes_only_verified_whole_cohorts() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        result, backups, _log = run_runner(root)
        assert result.returncode == 0, result.stderr
        old_manifest = manifests(backups)[0]
        old_data = json.loads(old_manifest.read_text())
        old_files = [old_manifest, backups / old_data["dbFile"], backups / old_data["archiveFile"]]
        old_time = time.time() - 3 * 86400
        for path in old_files:
            os.utime(path, (old_time, old_time))
        orphan = backups / "db-orphan.sqlite"
        orphan.write_bytes(b"keep")
        time.sleep(1.1)
        result, _backups, _log = run_runner(root, retention_days=1)
        assert result.returncode == 0, result.stderr
        assert not any(path.exists() for path in old_files)
        assert orphan.exists()
        print("  PASS: retention removes only a verified committed cohort")


def test_retention_rejects_traversal_manifest_paths() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        result, backups, _log = run_runner(root, retention_days=1)
        assert result.returncode == 0, result.stderr
        outside = root / "outside"
        outside.mkdir()
        stamp = "2020-01-01-000000"
        db = outside / f"db-{stamp}.sqlite"
        archive = outside / f"artifacts-{stamp}.tar.gz"
        db.write_bytes(b"keep-db")
        archive.write_bytes(b"keep-archive")
        manifest = backups / f"backup-manifest-{stamp}.json"
        manifest.write_text(json.dumps({
            "stamp": stamp,
            "dbFile": f"../outside/{db.name}",
            "dbSha256": hashlib.sha256(db.read_bytes()).hexdigest(),
            "archiveFile": f"../outside/{archive.name}",
            "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "complete": True,
        }))
        old_time = time.time() - 3 * 86400
        for path in (manifest, db, archive):
            os.utime(path, (old_time, old_time))
        result, _backups, _log = run_runner(root, retention_days=1)
        assert result.returncode == 0, result.stderr
        assert manifest.exists() and db.exists() and archive.exists()
        print("  PASS: retention rejects traversal manifest paths")


def test_restore_drill_is_non_destructive() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        result, backups, _log = run_runner(root)
        assert result.returncode == 0, result.stderr
        manifest = manifests(backups)[0]
        destination = root / "restore"
        drill = subprocess.run(["bash", str(RESTORE), str(manifest), str(destination)], capture_output=True, text=True, timeout=30)
        assert drill.returncode == 0, drill.stderr
        assert (destination / json.loads(manifest.read_text())["dbFile"]).exists()
        assert (destination / "artifacts" / ".test.reconciliation.json").exists()
        again = subprocess.run(["bash", str(RESTORE), str(manifest), str(destination)], capture_output=True, text=True, timeout=30)
        assert again.returncode != 0
        print("  PASS: restore drill verifies a fresh destination without mutating source backups")


def test_restore_rejects_archive_links() -> None:
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        result, backups, _log = run_runner(root)
        assert result.returncode == 0, result.stderr
        manifest_path = manifests(backups)[0]
        manifest = json.loads(manifest_path.read_text())
        archive_path = backups / manifest["archiveFile"]
        with tarfile.open(archive_path, "w:gz") as archive:
            link = tarfile.TarInfo("outside")
            link.type = tarfile.SYMTYPE
            link.linkname = str(root.parent)
            archive.addfile(link)
        manifest["archiveSha256"] = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        manifest_path.write_text(json.dumps(manifest))
        drill = subprocess.run(["bash", str(RESTORE), str(manifest_path), str(root / "restore")], capture_output=True, text=True, timeout=30)
        assert drill.returncode != 0
        assert "unsafe archive member" in drill.stderr
        print("  PASS: restore rejects archive links outside the fresh destination")


if __name__ == "__main__":
    print("Running F08 backup tests...")
    test_runner_pauses_pair_and_restores_only_its_pauses()
    test_runner_unpauses_only_containers_paused_by_this_run()
    test_runner_failure_has_no_manifest_and_unpauses()
    test_runner_timeout_cleans_named_container_and_unpauses()
    test_runner_returns_failure_when_unpause_fails()
    test_runner_returns_failure_when_container_cleanup_fails()
    test_retention_deletes_only_verified_whole_cohorts()
    test_retention_rejects_traversal_manifest_paths()
    test_restore_drill_is_non_destructive()
    test_restore_rejects_archive_links()
    print("All F08 backup tests passed.")
