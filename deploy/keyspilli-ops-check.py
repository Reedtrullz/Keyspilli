#!/usr/bin/env python3
"""Bounded Keyspilli host health check; emits one non-secret JSON report."""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import socket
import sqlite3
import ssl
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

GIB = 1024 ** 3
DISK_FAIL = 30 * GIB
DISK_WARN = 34 * GIB
BACKUP_WARN_HOURS = 30
BACKUP_FAIL_HOURS = 48
TLS_WARN_DAYS = 21
TLS_FAIL_DAYS = 7


def run(*args: str, timeout: int = 15) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout).stdout.strip()


def inspect(name: str) -> dict[str, Any]:
    value = json.loads(run("docker", "inspect", name))
    return value[0] if value else {}


def env_map(container: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in container.get("Config", {}).get("Env", []):
        key, _, value = item.partition("=")
        result[key] = value
    return result


def age_hours(path: str | None) -> float | None:
    if not path:
        return None
    return round((datetime.now(timezone.utc).timestamp() - os.path.getmtime(path)) / 3600, 3)


def latest(pattern: str) -> str | None:
    paths = glob.glob(pattern)
    return max(paths, key=os.path.getmtime) if paths else None


def http_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.load(response)


def anonymous_status(url: str) -> int:
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def tls_days(host: str) -> float:
    context = ssl.create_default_context()
    with socket.create_connection((host, 443), timeout=10) as raw:
        with context.wrap_socket(raw, server_hostname=host) as wrapped:
            expiry = ssl.cert_time_to_seconds(wrapped.getpeercert()["notAfter"])
    return round((expiry - datetime.now(timezone.utc).timestamp()) / 86400, 3)


def event_count(logs: str, event: str) -> int:
    return len(re.findall(rf"event\s*[:=]\s*['\"]?{re.escape(event)}\b", logs))


def collect(mode: str) -> dict[str, Any]:
    web = inspect("keyspilli")
    worker = inspect("keyspilli-worker")
    web_env = env_map(web)
    health = http_json("http://127.0.0.1:3008/api/health")
    disk_free = os.statvfs("/").f_bavail * os.statvfs("/").f_frsize
    latest_db = latest("/backups/db-*.sqlite")
    latest_archive = latest("/backups/artifacts-*.tar.gz")
    logs = subprocess.run(
        ["docker", "logs", "--since", "24h", "keyspilli"],
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    logs = logs.stdout + logs.stderr
    snapshot: dict[str, Any] = {
        "diskFreeBytes": disk_free,
        "web": {
            "running": web.get("State", {}).get("Status") == "running",
            "healthy": web.get("State", {}).get("Health", {}).get("Status") == "healthy",
            "restarts": web.get("RestartCount"),
            "version": health.get("version"),
            "image": web.get("Config", {}).get("Image"),
            "versionMatches": health.get("version") == web_env.get("VERSION")
            and health.get("image") == web.get("Config", {}).get("Image"),
            "sourceDiscoveryConfigured": health.get("capabilities", {}).get("sourceDiscoveryConfigured"),
            "directAudioAmt": health.get("capabilities", {}).get("directAudioAmt"),
        },
        "worker": {
            "running": worker.get("State", {}).get("Status") == "running",
            "restarts": worker.get("RestartCount"),
            "image": worker.get("Config", {}).get("Image"),
        },
        "backup": {
            "timerEnabled": run("systemctl", "is-enabled", "keyspilli-backup.timer") == "enabled",
            "timerActive": run("systemctl", "is-active", "keyspilli-backup.timer") == "active",
            "lastResult": run("systemctl", "show", "keyspilli-backup.service", "-p", "Result", "--value"),
            "latestDb": Path(latest_db).name if latest_db else None,
            "latestDbAgeHours": age_hours(latest_db),
            "latestArchive": Path(latest_archive).name if latest_archive else None,
            "latestArchiveAgeHours": age_hours(latest_archive),
        },
        "tlsDaysRemaining": tls_days("keys.reidar.tech"),
        "caddyValid": subprocess.run(
            ["caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
        ).returncode == 0,
        "anonymousStatus": anonymous_status("https://keys.reidar.tech/api/health"),
        "providerCounts": {
            "candidatesFound": event_count(logs, "candidates-found"),
            "noCandidates": event_count(logs, "no-candidates"),
            "rateLimited": event_count(logs, "rate-limited"),
            "unavailable": event_count(logs, "provider-unavailable"),
            "notConfigured": event_count(logs, "provider-not-configured"),
        },
    }
    if mode == "deep":
        data_mount = next((item.get("Source") for item in web.get("Mounts", []) if item.get("Destination") == "/data"), None)
        db_path = str(Path(data_mount) / "db.sqlite") if data_mount else ""
        live_integrity = None
        backup_integrity = None
        if db_path and Path(db_path).is_file():
            with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as database:
                live_integrity = database.execute("PRAGMA integrity_check").fetchone()[0]
        if latest_db:
            with sqlite3.connect(f"file:{latest_db}?mode=ro", uri=True) as database:
                backup_integrity = database.execute("PRAGMA integrity_check").fetchone()[0]
        archive_valid = False
        if latest_archive:
            try:
                with tarfile.open(latest_archive, "r:gz") as archive:
                    archive_valid = next(iter(archive), None) is not None
            except (OSError, tarfile.TarError):
                archive_valid = False
        snapshot["deep"] = {
            "liveDatabaseIntegrity": live_integrity,
            "backupDatabaseIntegrity": backup_integrity,
            "archiveValid": archive_valid,
        }
    return snapshot


def evaluate(snapshot: dict[str, Any], mode: str) -> dict[str, Any]:
    failures: list[str] = []
    warnings: list[str] = []
    checks: dict[str, Any] = {}

    disk = snapshot.get("diskFreeBytes")
    disk_status = "failed" if not isinstance(disk, (int, float)) or disk < DISK_FAIL else "warning" if disk < DISK_WARN else "healthy"
    checks["disk"] = {"status": disk_status, "freeGiB": round(disk / GIB, 3) if isinstance(disk, (int, float)) else None}
    if disk_status == "failed": failures.append("disk_below_30_gib")
    elif disk_status == "warning": warnings.append("disk_below_preferred_34_gib")

    web = snapshot.get("web", {})
    web_ok = all(web.get(key) is value for key, value in {
        "running": True,
        "healthy": True,
        "versionMatches": True,
        "sourceDiscoveryConfigured": True,
        "directAudioAmt": False,
    }.items())
    checks["web"] = {"status": "healthy" if web_ok else "failed", **web}
    if not web_ok: failures.append("web_health_or_capability_mismatch")
    if isinstance(web.get("restarts"), int) and web["restarts"] > 0: warnings.append("web_restart_count_nonzero")

    worker = snapshot.get("worker", {})
    checks["worker"] = {"status": "healthy" if worker.get("running") is True else "failed", **worker}
    if worker.get("running") is not True: failures.append("worker_not_running")
    if isinstance(worker.get("restarts"), int) and worker["restarts"] > 0: warnings.append("worker_restart_count_nonzero")

    backup = snapshot.get("backup", {})
    backup_ok = backup.get("timerEnabled") is True and backup.get("timerActive") is True and backup.get("lastResult") == "success"
    for field, label in (("latestDbAgeHours", "latest_db_backup"), ("latestArchiveAgeHours", "latest_artifact_backup")):
        age = backup.get(field)
        if not isinstance(age, (int, float)) or age > BACKUP_FAIL_HOURS:
            backup_ok = False
            failures.append(f"{label}_older_than_48h")
        elif age > BACKUP_WARN_HOURS:
            warnings.append(f"{label}_older_than_30h")
    checks["backup"] = {"status": "healthy" if backup_ok else "failed", **backup}
    if not backup_ok and not any(value.startswith("latest_") for value in failures): failures.append("backup_timer_or_last_result_failed")

    tls = snapshot.get("tlsDaysRemaining")
    tls_status = "failed" if not isinstance(tls, (int, float)) or tls < TLS_FAIL_DAYS else "warning" if tls < TLS_WARN_DAYS else "healthy"
    checks["tls"] = {"status": tls_status, "daysRemaining": tls}
    if tls_status == "failed": failures.append("tls_expiry_below_7_days")
    elif tls_status == "warning": warnings.append("tls_expiry_below_21_days")

    caddy_ok = snapshot.get("caddyValid") is True
    checks["caddy"] = {"status": "healthy" if caddy_ok else "failed"}
    if not caddy_ok: failures.append("caddy_config_invalid")
    boundary_ok = snapshot.get("anonymousStatus") == 401
    checks["privateBoundary"] = {"status": "healthy" if boundary_ok else "failed", "anonymousStatus": snapshot.get("anonymousStatus")}
    if not boundary_ok: failures.append("anonymous_edge_not_401")
    checks["providerEvents24h"] = {"status": "observed", **snapshot.get("providerCounts", {})}

    if mode == "deep":
        deep = snapshot.get("deep", {})
        deep_ok = deep.get("liveDatabaseIntegrity") == "ok" and deep.get("backupDatabaseIntegrity") == "ok" and deep.get("archiveValid") is True
        checks["deepIntegrity"] = {"status": "healthy" if deep_ok else "failed", **deep}
        if not deep_ok: failures.append("deep_data_integrity_failed")

    status = "failed" if failures else "warning" if warnings else "healthy"
    return {
        "schemaVersion": 1,
        "check": "keyspilli-ops",
        "mode": mode,
        "status": status,
        "checks": checks,
        "failures": sorted(set(failures)),
        "warnings": sorted(set(warnings)),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("light", "deep"), default="light")
    parser.add_argument("--fixture", help="evaluate a synthetic snapshot instead of live state")
    args = parser.parse_args()
    try:
        snapshot = json.loads(Path(args.fixture).read_text()) if args.fixture else collect(args.mode)
        report = evaluate(snapshot, args.mode)
    except Exception as error:
        report = {
            "schemaVersion": 1,
            "check": "keyspilli-ops",
            "mode": args.mode,
            "status": "failed",
            "checks": {},
            "failures": [f"collector_error:{type(error).__name__}"],
            "warnings": [],
        }
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 1 if report["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main())
