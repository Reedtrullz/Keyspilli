#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys
import time


def main():
    root, run, parent, *command = sys.argv[1:]
    expected_parent = int(parent)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if os.getppid() != expected_parent:
            raise RuntimeError("supervisor exited before child ownership was committed")
        document = json.loads((Path(root) / "runs" / run / "run.json").read_text())
        if document.get("id") != run or document.get("childLauncherPid", document.get("ownerPid")) != expected_parent:
            raise RuntimeError("child launch ownership mismatch")
        if document.get("childPid") == os.getpid() and document.get("childIdentity"):
            os.execvpe(command[0], command, os.environ)
        time.sleep(.02)
    raise RuntimeError("child ownership acknowledgement timed out")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"evidence child: {error}", file=sys.stderr)
        sys.exit(125)
