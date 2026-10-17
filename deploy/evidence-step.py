#!/usr/bin/env python3
import importlib.util
import os
from pathlib import Path
import sys


def main():
    command = ["/bin/bash", "--noprofile", "--norc", "-e", "-o", "pipefail", *sys.argv[1:]]
    run = os.environ.get("KEYSPILLI_EVIDENCE_RUN")
    if not run or os.environ.get("KEYSPILLI_EVIDENCE_FINISHING") == "1":
        os.execv(command[0], command)
    spec = importlib.util.spec_from_file_location("evidence", Path(__file__).with_name("keyspilli-evidence.py"))
    if spec is None or spec.loader is None:
        raise RuntimeError("lifecycle helper missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    store = module.Store(os.environ["KEYSPILLI_EVIDENCE_ROOT"])
    doc = store.path(run)[1]
    if doc["state"] != "running":
        raise ValueError("job run has already been released")
    module.durable_bytes(store.root / "evidence" / run / ("script-" + str(os.getpid()) + ".sh"), Path(sys.argv[1]).read_bytes())
    return module.run_command(store, doc["peakBytes"], command, existing_run=run)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"evidence step: {error}", file=sys.stderr)
        sys.exit(1)
