#!/usr/bin/env python3
"""Opt-in restore proof using a local immutable web image; never starts a worker."""
import json
import os
import platform
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path


def verify(manifest_path, destination, image_id, revision, song_id, sampled=False, measure_images=False):
    if measure_images and not sampled:
        raise ValueError("image size qualification requires sampled verification")
    if sampled and (platform.system() != "Linux" or platform.machine() not in ("x86_64", "amd64")):
        raise ValueError("sampled verification requires native Linux amd64")
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
    uses_node = docker("image", "inspect", "--format", "{{.Config.User}}", image_id).strip() == "node"
    name = f"keyspilli-restore-{uuid.uuid4().hex[:12]}"
    mounts = []
    native_output = report_path.parent / "native-player"
    if sampled:
        if docker("image", "inspect", "--format", "{{.Architecture}}", image_id).strip() != "amd64":
            raise ValueError("sampled verification requires an amd64 image")
        checkout = Path(__file__).resolve().parents[1]
        bank_path = os.environ.get("KEYSPILLI_NATIVE_PIANO_DIR", "")
        bank = Path(bank_path)
        if not bank_path or not bank.is_absolute() or bank.is_symlink() or not bank.is_dir() or bank.resolve() != bank or ":" in bank_path:
            raise ValueError("canonical read-only native piano input is required")
        mounts.extend(("-v", f"{bank}:/piano-input:ro"))
        for relative in ("node_modules", "packages", "package.json", "tsconfig.base.json", "apps/web/e2e",
                         "apps/web/scripts/verify-native-player.mts", "apps/web/src/lib/native-player-assets.ts",
                         "apps/web/src/lib/player-reference-bank.ts", "apps/web/scripts/fixtures/native-piano-assets.json"):
            source = checkout / relative
            if not source.exists() or source.is_symlink() or ":" in str(source):
                raise ValueError("native browser probe source is unavailable")
            mounts.extend(("-v", f"{source}:/qualification-source/{relative}:ro"))
        native_output.mkdir(mode=0o700)
        mounts.extend(("-v", f"{native_output}:/browser-results",
                       "-e", "KEYSPILLI_NATIVE_PROBE_SCOPE=owned-restore",
                       "-e", "KEYSPILLI_API_TOKEN=test-token-for-e2e"))

    def own_restore_paths(owner: str, paths: tuple[str, ...]) -> None:
        helper = f"{name}-ownership-{uuid.uuid4().hex[:8]}"
        binds = ["-v", f"{runtime}:/data"]
        if sampled:
            binds.extend(("-v", f"{native_output}:/browser-results"))
        docker("create", "--pull=never", "--name", helper, "--network", "none",
               "--read-only", "--user", "0:0", "--cpus", "1", "--memory", "128m", "--pids-limit", "32",
               *binds, "--entrypoint", "chown", image_id, "-R", owner, *paths)
        try:
            docker("start", "-a", helper, timeout=120)
            if docker("inspect", "--format", "{{.State.ExitCode}}", helper).strip() != "0":
                raise RuntimeError("restore ownership preparation failed")
        finally:
            docker("rm", "-f", helper)

    created = False
    return_native_owner = False
    started = time.monotonic()
    report["applicationVerification"] = "failed"
    try:
        if measure_images:
            image_limit = int(os.environ.get("KEYSPILLI_EVIDENCE_LIMIT_BYTES", str(16 * 1024 ** 3)))
            if image_limit <= 0:
                raise ValueError("invalid native image size budget")
            image_sizes = {}
            for role in ("web", "worker"):
                recorded_image = (manifest.get("images") or {}).get(role)
                if (not isinstance(recorded_image, dict)
                        or not re.fullmatch(r"sha256:[a-f0-9]{64}", str(recorded_image.get("id", "")))
                        or recorded_image.get("revision") != revision):
                    raise ValueError("native image size requires pinned image metadata")
                identity = recorded_image["id"]
                if docker("image", "inspect", "--format", "{{.Id}}", identity).strip() != identity:
                    raise ValueError("native image size requires the local immutable image")
                raw_size = docker("image", "inspect", "--format", "{{.Size}}", identity).strip()
                if not re.fullmatch(r"[0-9]+", raw_size) or int(raw_size) <= 0:
                    raise ValueError("native image size is unavailable or invalid")
                image_sizes[role] = {"id": identity, "bytes": int(raw_size)}
            if sum(item["bytes"] for item in image_sizes.values()) > image_limit:
                raise ValueError("native image size total exceeds the existing scratch budget")
            report["nativeImageSizes"] = image_sizes
            report["nativeImageSizeLimitBytes"] = image_limit
        docker("create", "--pull=never", "--name", name, "--network", "none",
               "--cpus", "1.5", "--memory", "1g", "--pids-limit", "128",
               "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=512m",
               "-v", f"{runtime}:/data", "-v", f"{verifier}:/restore-app-verifier.mjs:ro",
               "-e", "HOSTNAME=127.0.0.1", "-e", "PORT=3000", "-e", "HOME=/tmp",
               "-e", "KEYSPILLI_DATA_DIR=/data", "-e", "KEYSPILLI_ORIGIN=http://127.0.0.1:3000",
               "-e", "KEYSPILLI_TUTORIAL_BETA=0", *mounts, image_id)
        created = True
        limits = json.loads(docker("inspect", "--format", "{{json .HostConfig}}", name))
        if limits.get("NanoCpus") != 1_500_000_000:
            raise ValueError("restored application CPU limit does not match 1.5 CPUs")
        if limits.get("Memory") != 1_073_741_824 or limits.get("PidsLimit") != 128:
            raise ValueError("restored application memory/PID limits do not match the contract")
        report["runtimeLimits"] = {key: limits[key] for key in ("NanoCpus", "Memory", "PidsLimit")}
        if uses_node:
            if runtime.is_symlink() or not runtime.is_dir() or runtime.resolve() != runtime:
                raise ValueError("restore ownership requires a canonical runtime directory")
            # Only the extracted copy and generated outputs change; backup sources stay untouched.
            return_native_owner = sampled
            own_restore_paths("1000:1000", ("/data", "/browser-results") if sampled else ("/data",))
        docker("start", name)
        if sampled:
            ready = json.loads(docker("exec", name, "node", "/restore-app-verifier.mjs",
                                      revision, song_id, str(report["catalogSchemaEpoch"]), "--ready-only", timeout=240))
            if ready != {"startupReadiness": "passed"}:
                raise ValueError("restored application startup readiness is incomplete")
            native = json.loads(docker("exec", "-e", "DEBUG=pw:browser", name, "node", "--import",
                                       "/qualification-source/node_modules/tsx/dist/loader.mjs",
                                       "/qualification-source/apps/web/scripts/verify-native-player.mts",
                                       revision, timeout=240))
            if native.get("kind") != "keyspilli-native-sampled" or native.get("revision") != revision or native.get("status") != "passed":
                raise ValueError("native sampled browser proof is incomplete")
            report["sampledBrowser"] = native
        proof = json.loads(docker("exec", name, "node", "/restore-app-verifier.mjs",
                                  revision, song_id, str(report["catalogSchemaEpoch"]), timeout=240))
        report.update(applicationVerification="passed", application=proof, webImageId=image_id,
                      restoredRevision=revision)
    finally:
        report["applicationElapsedSeconds"] = round(time.monotonic() - started, 3)
        if created:
            try:
                try:
                    docker("rm", "-f", name)
                finally:
                    if return_native_owner:
                        own_restore_paths(f"{os.getuid()}:{os.getgid()}", ("/browser-results",))
            except Exception:
                report["applicationVerification"] = "failed"
                report["cleanup"] = "failed"
                report_path.write_text(json.dumps(report, indent=2) + "\n")
                raise
        report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    try:
        flags = sys.argv[6:]
        if len(sys.argv) < 6 or len(flags) != len(set(flags)) or set(flags) - {"--sampled", "--image-sizes"}:
            raise ValueError("expected manifest, fresh destination, image ID, revision, song ID and optional --sampled --image-sizes")
        verify(*sys.argv[1:6], sampled="--sampled" in flags, measure_images="--image-sizes" in flags)
    except Exception:
        print("restore app verification failed; inspect the isolated restore report", file=sys.stderr)
        sys.exit(1)
