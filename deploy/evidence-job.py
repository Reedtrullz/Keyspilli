#!/usr/bin/env python3
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys

spec = importlib.util.spec_from_file_location("evidence", Path(__file__).with_name("keyspilli-evidence.py"))
if spec is None or spec.loader is None:
    raise RuntimeError("evidence lifecycle module is unavailable")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    root = Path(os.environ["RUNNER_TEMP"]) / "keyspilli-evidence"
    store = module.Store(root.resolve())
    if sys.argv[1:] == ["finish"]:
        return store.recover()
    pid = os.getppid()
    for _ in range(15):
        command = Path(f"/proc/{pid}/comm").read_text().strip()
        if command == "Runner.Worker":
            break
        status = Path(f"/proc/{pid}/status").read_text()
        pid = int(next(line.split()[1] for line in status.splitlines() if line.startswith("PPid:")))
        if pid <= 1:
            raise ValueError("GitHub runner owner process not found")
    else:
        raise ValueError("GitHub runner owner process not found")
    store.recover()
    doc = store.begin(12 * module.GIB, pid, export_required=True)
    env = store.environment(doc["id"])
    with Path(os.environ["GITHUB_ENV"]).open("a") as output:
        for key in ("KEYSPILLI_EVIDENCE_ROOT", "KEYSPILLI_EVIDENCE_RUN", "KEYSPILLI_SCRATCH", "KEYSPILLI_EVIDENCE", "KEYSPILLI_REAL_DOCKER", "TMPDIR"):
            output.write(f"{key}={env[key]}\n")
    with Path(os.environ["GITHUB_PATH"]).open("a") as output:
        output.write(str(Path(__file__).with_name("evidence-bin").resolve()) + "\n")
    print(json.dumps(dict(id=doc["id"], peakBytes=doc["peakBytes"], realDocker=shutil.which("docker"))))
    return 0


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["finish"]:
            root = Path(os.environ["RUNNER_TEMP"]) / "keyspilli-evidence"
            store = module.Store(root.resolve())
            try:
                if "KEYSPILLI_EVIDENCE_RUN" in os.environ:
                    store.finish(os.environ["KEYSPILLI_EVIDENCE_RUN"], os.environ.get("JOB_STATUS", "finished"))
                result = store.recover()
            finally:
                spec = importlib.util.spec_from_file_location("evidence_bundle", Path(__file__).with_name("evidence_bundle.py"))
                if spec is None or spec.loader is None:
                    raise RuntimeError("bundle helper missing")
                bundle = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(bundle)
                bundle.export_bundle(store, Path(os.environ["RUNNER_TEMP"]) / "keyspilli-evidence.tar.gz")
            sys.exit(result)
        sys.exit(main())
    except Exception as error:
        print(f"evidence job: {error}", file=sys.stderr)
        sys.exit(1)
