#!/usr/bin/env python3
"""Render deploy/inventory/hosts.yml from hosts.example.yml and the environment.

Required: KEYSPILLI_VPS_HOST. Optional: KEYSPILLI_VPS_USER (default "deploy"),
KEYSPILLI_VPS_SSH_KEY (default "~/.ssh/keyspilli_deploy"). The output is
gitignored so the production host never needs to be committed.
"""
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXAMPLE = HERE / "inventory" / "hosts.example.yml"
TARGET = HERE / "inventory" / "hosts.yml"
SAFE = re.compile(r"^[A-Za-z0-9._:~/@-]+$")


def main() -> int:
    values = {
        "VPS_HOST": os.environ.get("KEYSPILLI_VPS_HOST", "").strip(),
        "VPS_USER": os.environ.get("KEYSPILLI_VPS_USER", "").strip() or "deploy",
        "VPS_SSH_KEY": os.environ.get("KEYSPILLI_VPS_SSH_KEY", "").strip() or "~/.ssh/keyspilli_deploy",
    }
    if not values["VPS_HOST"]:
        print("KEYSPILLI_VPS_HOST must be set to render the deploy inventory.", file=sys.stderr)
        return 1
    for name, value in values.items():
        if not SAFE.match(value):
            print(f"{name} contains unsupported characters.", file=sys.stderr)
            return 1
    text = EXAMPLE.read_text()
    for name, value in values.items():
        placeholder = re.compile(rf"(:\s){name}$", re.M)
        if not placeholder.search(text):
            print(f"{EXAMPLE.name} is missing the {name} placeholder.", file=sys.stderr)
            return 1
        # JSON strings are valid YAML scalars, so the value is always quoted.
        text = placeholder.sub(lambda m: m.group(1) + json.dumps(value), text)
    TARGET.write_text(text)
    TARGET.chmod(0o600)
    print(f"Rendered {TARGET.relative_to(HERE.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
