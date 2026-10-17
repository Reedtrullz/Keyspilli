#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import re
import stat


def protected_snapshot():
    roots = [Path("/var/lib/keyspilli-evidence/305-native-20261016/preserved"),
             Path("/var/lib/keyspilli-evidence/305-readiness-15cpu-20261016/final-native/data"),
             Path("/var/lib/keyspilli-evidence/storage-cleanup-20261017T005832Z")]
    result = {}
    for root in roots:
        identity = hashlib.sha256()
        count = 0
        for path in sorted(root.rglob("*")):
            s = path.lstat()
            fields = (str(path.relative_to(root)), s.st_ino, s.st_size, s.st_mode, s.st_uid, s.st_gid, s.st_mtime_ns, s.st_nlink)
            identity.update(json.dumps(fields).encode())
            if stat.S_ISREG(s.st_mode):
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        identity.update(chunk)
                count += 1
        result[str(root)] = dict(files=count, identityAndBytesSha256=identity.hexdigest())
    result["containers"] = subprocess.check_output(["docker", "inspect", "--format", "{{.Id}} {{.Image}} {{.State.Pid}} {{.State.StartedAt}}", "keyspilli", "keyspilli-worker"], text=True)
    result["rollback"] = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", "keyspilli:rollback", "keyspilli-worker:rollback"], text=True)
    return result


def allocated(root):
    return sum(p.stat().st_blocks * 512 for p in root.rglob("*") if p.is_file())


def source_hashes():
    root = Path(__file__).resolve().parents[1]
    paths = [*root.glob("*.py"), *root.glob("test/*.py"), root / "restore-drill.sh", root / "evidence-bin/docker"]
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("destination")
    parser.add_argument("--image", required=True)
    parser.add_argument("--production-pins", action="store_true")
    parser.add_argument("--managed-root")
    parser.add_argument("--source-tree", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.source_tree):
        raise ValueError("qualification requires the exact reviewed Git source tree")
    sources = source_hashes()
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", args.image):
        raise ValueError("qualification requires an existing immutable image ID")
    actual = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", args.image], text=True).strip()
    if actual != args.image:
        raise ValueError("immutable image is unavailable")
    root = Path(args.destination).resolve()
    if shutil.disk_usage(root.parent).free < 7 * 1024 ** 3 + 32 * 1024 ** 2:
        raise ValueError("insufficient qualification fixture space")
    root.mkdir(mode=0o700)
    protected = protected_snapshot() if args.production_pins else None
    (root / "protected-before.json").write_text(json.dumps(protected, indent=2) + "\n")
    fixture = bytes(range(256)) * (128 * 1024)
    sha = hashlib.sha256(fixture).hexdigest()
    fixture_dir = root.parent / "immutable-fixtures"
    fixture_dir.mkdir(exist_ok=True, mode=0o700)
    source = fixture_dir / f"{sha}.mid"
    if not source.exists():
        with source.open("xb") as stream:
            stream.write(fixture)
        source.chmod(0o444)
    if hashlib.sha256(source.read_bytes()).hexdigest() != sha:
        raise ValueError("shared fixture checksum mismatch")
    script = Path(__file__).resolve().parents[1] / "keyspilli-evidence.py"
    managed = Path(args.managed_root).resolve() if args.managed_root else root / "managed"
    baseline_bytes = allocated(managed) if managed.exists() else 0
    baseline_runs = len(list((managed / "runs").glob("*/run.json")))
    new_input_bytes = 0 if (managed / "inputs" / sha).exists() else source.stat().st_size
    initial = shutil.disk_usage(root).free
    rows = []
    documents = []
    for index, exit_code in enumerate((0, 17, 0)):
        code = (
            "import os,pathlib,subprocess,sys; "
            "p=pathlib.Path(os.environ['KEYSPILLI_SCRATCH']); "
            f"subprocess.run([sys.executable,{str(script)!r},'copy',{str(source)!r},'input.mid'],check=True); "
            "(p/'recording.wav').write_bytes(b'RIFF'+b'a'*65536); "
            f"(p/'result.json').write_text({json.dumps(dict(case=index, exitCode=exit_code))!r}); "
            "(p/'payload').write_text('bounded Docker fixture'); "
            "(p/'Dockerfile').write_text('FROM scratch\\nCOPY payload /payload\\n'); "
            "subprocess.run(['docker','build','-t','keyspilli-lifecycle:fixture',str(p)],check=True); "
            f"subprocess.run(['docker','run','--network','none','--cpus','0.25','--memory','128m','--name','keyspilli-fixture',"
            f"'--entrypoint','node',{args.image!r},'-e','require(\"fs\").writeFileSync(\"/data/unique-volume\",\"unique-volume-result\"); console.error(\"stderr-result\"); console.log(JSON.stringify(process.argv.slice(1)))',"
            "'--','keyspilli-lifecycle:fixture','--rm','-v'],check=True); "
            "subprocess.run(['docker','rm','keyspilli-fixture'],check=True); "
            f"sys.exit({exit_code})"
        )
        before = shutil.disk_usage(root).free
        result = subprocess.run([sys.executable, str(script), "--root", str(managed), "run",
                                 "--peak-bytes", str(1024 ** 3), "--", sys.executable, "-c", code],
                                capture_output=True, text=True, timeout=180)
        (root / f"cycle-{index}.stdout").write_text(result.stdout)
        (root / f"cycle-{index}.stderr").write_text(result.stderr)
        if result.returncode != exit_code:
            raise ValueError(f"cycle {index} returned {result.returncode}, expected {exit_code}: {result.stderr}")
        documents = [json.loads(p.read_text()) for p in (managed / "runs").glob("*/run.json")]
        assert len(documents) == baseline_runs + index + 1
        assert all(d["state"] == "released" for d in documents)
        assert not list((managed / "scratch").iterdir())
        assert hashlib.sha256(source.read_bytes()).hexdigest() == sha
        latest = max(documents, key=lambda d: d["started"])
        latest_evidence = managed / "evidence" / latest["id"]
        assert '["keyspilli-lifecycle:fixture","--rm","-v"]' in (latest_evidence / "command.log").read_text()
        volume_results = list((latest_evidence / "files/docker-volumes").glob("**/unique-volume"))
        assert len(volume_results) == 1 and volume_results[0].read_text() == "unique-volume-result"
        states = list(latest_evidence.glob("container-*-state.json"))
        assert len(states) == 1 and json.loads(states[0].read_text())["ExitCode"] == 0
        assert not subprocess.check_output(["docker", "ps", "-aq", "--filter", "label=io.keyspilli.evidence.run"], text=True).strip()
        assert not subprocess.check_output(["docker", "image", "ls", "-q", "--filter", "label=io.keyspilli.evidence.run"], text=True).strip()
        assert "keyspilli-evidence-" not in subprocess.check_output(["docker", "buildx", "ls", "--format", "{{.Name}}"], text=True)
        assert not subprocess.check_output(["docker", "volume", "ls", "-q", "--filter", "name=buildx_buildkit_keyspilli-evidence-"], text=True).strip()
        rows.append(dict(cycle=index, expectedExit=exit_code, actualExit=result.returncode,
                         availableBefore=before, availableAfter=shutil.disk_usage(root).free,
                         retainedAllocatedBytes=allocated(managed), scratchBytes=0))
        (root / "measurements.json").write_text(json.dumps(dict(initialAvailable=initial, inputSha256=sha, cycles=rows), indent=2) + "\n")
    assert rows[-1]["retainedAllocatedBytes"] < baseline_bytes + new_input_bytes + 2 * 1024 ** 2
    assert rows[-1]["retainedAllocatedBytes"] - rows[0]["retainedAllocatedBytes"] < 2 * 1024 ** 2
    first = min(documents, key=lambda d: d["started"])
    reconstruction_run = json.loads(subprocess.check_output([sys.executable, str(script), "--root", str(managed),
        "begin", "--peak-bytes", str(128 * 1024 ** 2), "--owner-pid", "99999999"], text=True))
    reconstructed = managed / "scratch" / reconstruction_run["id"] / "reconstructed"
    subprocess.run([sys.executable, str(script), "--root", str(managed), "reconstruct", first["id"], str(reconstructed)], check=True)
    assert hashlib.sha256((reconstructed / "input.mid").read_bytes()).hexdigest() == sha
    assert (reconstructed / "recording.wav").read_bytes() == b"RIFF" + b"a" * 65536
    for path in reconstructed.rglob("*"):
        if path.is_file():
            assert path.stat().st_nlink == 1
    reconstructed_bytes = allocated(reconstructed)
    subprocess.run([sys.executable, str(script), "--root", str(managed), "finish", reconstruction_run["id"]], check=True, capture_output=True)
    assert not reconstructed.exists()
    orphan = json.loads(subprocess.check_output([sys.executable, str(script), "--root", str(managed), "begin", "--peak-bytes", str(128 * 1024 ** 2), "--owner-pid", "99999999"], text=True))
    env = {**os.environ, "KEYSPILLI_EVIDENCE_ROOT": str(managed), "KEYSPILLI_EVIDENCE_RUN": orphan["id"]}
    env.update(json.loads(subprocess.check_output([sys.executable, str(script), "environment"], env=env, text=True)))
    program = 'process.on("SIGTERM",()=>{console.error("final-stderr");process.exit(0)});console.error("initial-stderr");setInterval(()=>{},1000)'
    container = subprocess.check_output(["docker", "run", "-d", "--network", "none", "--cpus", "0.25", "--memory", "128m", "--entrypoint", "node", args.image, "-e", program], env=env, text=True).strip()
    deadline = time.monotonic() + 5
    stderr_text = ""
    while time.monotonic() < deadline:
        logs = subprocess.run(["docker", "logs", container], capture_output=True, text=True, check=True)
        stderr_text = logs.stderr
        if "initial-stderr" in logs.stderr:
            break
        time.sleep(.05)
    assert "initial-stderr" in stderr_text
    record = managed / "runs" / orphan["id"] / "run.json"
    valid = json.loads(record.read_text())
    mismatched = {**valid, "dockerIdentity": "different-daemon"}
    record.write_text(json.dumps(mismatched))
    refused = subprocess.run([sys.executable, str(script), "--root", str(managed), "recover"], capture_output=True, text=True)
    (root / "daemon-mismatch.stdout").write_text(refused.stdout)
    (root / "daemon-mismatch.stderr").write_text(refused.stderr)
    assert refused.returncode != 0
    assert subprocess.check_output(["docker", "ps", "-aq", "--filter", f"id={container}"], text=True).strip()
    record.write_text(json.dumps(valid))
    recovered = subprocess.run([sys.executable, str(script), "--root", str(managed), "recover"], capture_output=True, text=True, check=True)
    (root / "orphan-recovery.stdout").write_text(recovered.stdout)
    stderr_files = list((managed / "evidence" / orphan["id"]).glob("container-*.stderr"))
    assert len(stderr_files) == 1
    assert "initial-stderr" in stderr_files[0].read_text() and "final-stderr" in stderr_files[0].read_text()
    assert not subprocess.check_output(["docker", "ps", "-aq", "--filter", f"label=io.keyspilli.evidence.run={orphan['id']}"], text=True).strip()
    after = protected_snapshot() if args.production_pins else None
    (root / "protected-after.json").write_text(json.dumps(after, indent=2) + "\n")
    assert after == protected
    assert source_hashes() == sources
    receipt = dict(status="passed", observedAt=time.time(), sourceTree=args.source_tree, sourceFilesSha256=sources, inputBytes=source.stat().st_size,
                   inputSha256=sha, cycles=rows, reconstruction="byte-exact, independent files", baselineManagedBytes=baseline_bytes,
                   reconstructionAllocatedBytes=reconstructed_bytes, reconstructionScratchReleased=True,
                   retainedAllocatedBytes=allocated(managed), finalAvailable=shutil.disk_usage(root).free,
                   orphanStderrAndFinalOutput="preserved", implicitVolumeData="preserved", applicationArgv="unchanged",
                   daemonMismatch="refused without removing owned container",
                   protectedProductionAndRecoveryInputs="unchanged" if protected is not None else "not_run")
    (root / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    main()
