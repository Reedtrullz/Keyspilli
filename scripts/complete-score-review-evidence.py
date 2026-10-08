"""Assemble exclusive local candidate artifacts, never a live provider request."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    with path.open("x") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
    path.chmod(0o600)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "package", "finalize"))
    parser.add_argument("--keyspilli", required=True, type=Path)
    parser.add_argument("--anti", required=True, type=Path)
    parser.add_argument("--node", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--final-name", default="final")
    parser.add_argument("--verification-name", default="verification-final")
    parser.add_argument("--capture-name", default="final/controls/capture")
    args = parser.parse_args()
    k, a, root, node = args.keyspilli.resolve(), args.anti.resolve(), args.root.resolve(), args.node.resolve()
    root.relative_to(k / "output/music-review")
    if Path(args.final_name).name != args.final_name or Path(args.verification_name).name != args.verification_name or ".." in Path(args.capture_name).parts:
        raise SystemExit("evidence names must stay within this run root")
    python = a / ".venv/bin/python"
    final = root / args.final_name
    env = {**os.environ, "PATH": str(node.parent) + os.pathsep + os.environ["PATH"]}
    results = []

    def run(name, cwd, command, timeout=600):
        log = root / (name + ".log")
        print("Starting " + name, flush=True)
        with log.open("xb") as output:
            result = subprocess.run([str(v) for v in command], cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=timeout)
        row = {"name": name, "exitCode": result.returncode, "log": log.name, "sha256": sha(log)}
        results.append(row)
        print(json.dumps(row), flush=True)
        if result.returncode:
            raise SystemExit("Failed " + name + "; retained log: " + str(log))

    if args.phase == "prepare":
        final.mkdir(mode=0o700)
        run(args.final_name + "-inputs", k, [node, "--import", "tsx", "apps/web/scripts/create-score-review-evidence.mts", final])
        smoke = final / "live-smoke"
        smoke.mkdir(mode=0o700)
        synthetic = smoke / "synthetic-binding.json"
        write(synthetic, {"schemaVersion": 1, "gatewayInstance": "a" * 32, "accountRef": "acct_" + "b" * 12, "inventorySha256": "c" * 64})
        run(args.final_name + "-dry-run", k, [node, "--import", "tsx", "apps/web/scripts/review-song-audio.mts", final / "queen/manifest.json", smoke / "dry-run", "--dry-run", "--max-requests", "0", "--review-profile", "evidence-v2", "--anti-python", python, "--anti-script", a / "codex_antigravity_auth/skills/anti/scripts/anti.py", "--base-url", "http://127.0.0.1:51123/v1", "--model", "gemini-3.1-pro", "--account-binding-json", synthetic])
        state = json.loads((smoke / "dry-run/state.json").read_text())
        assert state["attemptsUsed"] == 0
        write(smoke / "LIVE_SMOKE.json", {"schemaVersion": 1, "status": "blocked-before-dispatch", "reason": "Prior authorized account references are process-local HMACs; row index cannot establish identity after gateway restart. Ordinary gateway startup forces refresh-ahead scheduling, forbidden by this run's no-refresh constraint.", "attemptsReserved": 0, "helperDryRunJobs": 1, "newProviderGenerations": 0, "gatewayStarted": False, "accountStoreRead": False, "accountStoreMutated": False, "syntheticBindingDispatched": False, "liveContractReady": False, "dryRunStateSha256": sha(smoke / "dry-run/state.json"), "sourceEvidence": [{"path": name, "sha256": sha(a / name)} for name in ("codex_antigravity_auth/process_logs.py", "codex_antigravity_auth/server.py")], "nextAgentAction": "Inspect an already safely running source-pinned gateway and establish exact authorized account correspondence, or implement/test a no-refresh bound-only startup separately; never remap by row index or substitute an account.", "productionAdmission": False})
        write(final / "PREPARATION.json", results)
    elif args.phase == "package":
        packages = root / "packages"
        packages.mkdir(mode=0o700)
        run("plugin-inventory", k, ["python3", "scripts/update-keyspilli-plugin-inventory.py", "--source", "plugins/keyspilli", "--check"])
        run("plugin-unit-tests", k, ["python3", "-m", "unittest", "discover", "-s", "scripts", "-p", "test*keyspilli*py"])
        run("plugin-self-tests", k, ["python3", "plugins/keyspilli/skills/keyspilli-song/scripts/check_checkout.py", "--self-test"])
        for label in ("a", "b"):
            run("plugin-package-" + label, k, ["python3", "scripts/package-keyspilli-plugin.py", "--source", "plugins/keyspilli", "--output", packages / ("keyspilli-" + label + ".zip"), "--manifest", packages / ("keyspilli-" + label + ".json")])
        assert sha(packages / "keyspilli-a.zip") == sha(packages / "keyspilli-b.zip")
        extracted = packages / "extracted-keyspilli"
        extracted.mkdir(mode=0o700)
        with zipfile.ZipFile(packages / "keyspilli-a.zip") as archive:
            declared = json.loads((k / "plugins/keyspilli/source-members.json").read_text())["members"]
            assert archive.namelist() == declared
            for name in declared:
                payload = archive.read(name)
                assert payload == (k / "plugins/keyspilli" / name).read_bytes()
                assert b"/Users/reidar" not in payload and b"/home/reidar" not in payload
                if name.endswith(".md"):
                    for target in re.findall(rb"\]\(([^)]+)\)", payload):
                        target = target.decode().split("#")[0]
                        if target and not target.startswith(("http:", "https:", "/")):
                            assert (k / "plugins/keyspilli" / Path(name).parent / target).is_file(), target
            archive.extractall(extracted)
        run("plugin-extracted-preflight", k, ["python3", extracted / "skills/keyspilli-song/scripts/check_checkout.py", k, "--node", node])
        preflight = json.loads((root / "plugin-extracted-preflight.log").read_text())
        assert preflight["score_review"]["status"] == "compatible" and preflight["audio_review"]["status"] == "compatible"
        run("anti-build", a, [python, "-m", "build", "--sdist", "--wheel", "--outdir", packages / "anti"])
        run("anti-artifacts", a, [python, "scripts/check_artifacts.py", "--dist", packages / "anti"])
        run("anti-installed", a, [python, "scripts/check_installed.py", "--dist", packages / "anti"], timeout=900)
        write(root / "PACKAGES.json", {"status": "verified", "runs": results, "artifacts": [{"path": str(p.relative_to(root)), "sha256": sha(p)} for p in sorted(packages.rglob("*")) if p.is_file() and (p.suffix in (".zip", ".whl", ".gz"))], "exactPluginMembers": len(declared), "extractedParity": True, "installedAdoption": False})
    else:
        verification = json.loads((root / args.verification_name / "results.json").read_text())
        assert all(r["exitCode"] == 0 for r in verification)
        packages = json.loads((root / "PACKAGES.json").read_text())
        repair = json.loads((final / "controls/REPAIR_PROOF.json").read_text())
        assert packages["status"] == "verified" and repair["status"] == "passed"
        for mode in ("before", "after"):
            capture = json.loads((root / args.capture_name / f"capture-receipts/repair-{mode}-paired.json").read_text())
            for name in ("input", "output", "forwardOutput"):
                assert sha(Path(capture[name]["path"])) == capture[name]["sha256"]
        assert json.loads((root / args.capture_name / "capture-fixtures/bundle.json").read_text()) == json.loads((final / "controls/capture/capture-fixtures/bundle.json").read_text())
        for width in (390, 1280):
            assert json.loads((final / f"queen/offline/browser-{width}.json").read_text())["overflow"] is False
            assert json.loads((final / f"queen/result/browser-{width}.json").read_text())["overflow"] is False
        for report in final.glob("**/symbolic-review.json"):
            code = json.loads(report.read_text())["code"]
            assert all(sha(k / row["path"]) == row["sha256"] for row in code["inventory"])
        heads = {label: subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=cwd, text=True).strip() for label, cwd in (("keyspilli", k), ("anti", a))}
        write(root / "VERIFICATION.json", {"status": "software-candidate-verified", "heads": heads, "verification": verification, "live": json.loads((final / "live-smoke/LIVE_SMOKE.json").read_text()), "providerListening": "unverified", "sourceFidelity": "authority-unknown for Queen", "expertKeyboardJudgment": "not-established", "productionAdmission": False, "installedAdoption": False, "publication": False})
        write(root / "EVIDENCE_INDEX.json", {"schemaVersion": 1, "heads": heads, "finalReport": args.final_name + "/queen/result/index.html", "repairProof": args.final_name + "/controls/REPAIR_PROOF.json", "captures": args.capture_name + "/capture-receipts", "live": args.final_name + "/live-smoke/LIVE_SMOKE.json", "packages": "PACKAGES.json", "verification": "VERIFICATION.json", "drafts": "Earlier controls/queen/control-r2/final paths are retained development evidence, not final checker receipts. Paired captures remain valid for byte-identical repair fixtures; finalizer checks the exact fixture and captured stream hashes.", "checksumPolicy": "All root files except checksum file itself and the synthetic private fixture; no recursive self-hash"})
        lines = []
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.name not in ("SHA256SUMS_NATIVE.txt", "synthetic-binding.json"):
                lines.append(sha(path) + "  " + path.relative_to(root).as_posix())
        with (root / "SHA256SUMS_NATIVE.txt").open("x") as handle:
            handle.write("\n".join(lines) + "\n")
        print(json.dumps({"status": "finalized", "checksummedFiles": len(lines), "heads": heads}), flush=True)


if __name__ == "__main__":
    main()
