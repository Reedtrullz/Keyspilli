#!/usr/bin/env python3
"""Render deploy/inventory/hosts.yml from hosts.example.yml and the environment.

Required: KEYSPILLI_VPS_HOST. Optional: KEYSPILLI_VPS_USER (default "deploy"),
KEYSPILLI_VPS_SSH_KEY (default "~/.ssh/keyspilli_deploy"). The output is
gitignored so the production host never needs to be committed.
"""
import json
import ipaddress
import os
import re
import stat
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXAMPLE = HERE / "inventory" / "hosts.example.yml"
TARGET = HERE / "inventory" / "hosts.yml"
SAFE = re.compile(r"^[A-Za-z0-9._:~/@-]+$")
HOST_LABEL = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?")
SSH_USER = re.compile(r"[A-Za-z_][A-Za-z0-9_.-]*\$?")


def valid_host(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return len(value) <= 253 and all(HOST_LABEL.fullmatch(label) for label in value.removesuffix(".").split("."))


def write_inventory(text: str) -> None:
    try:
        existing = TARGET.lstat()
    except FileNotFoundError:
        existing = None
    if existing is not None and (not stat.S_ISREG(existing.st_mode) or existing.st_nlink != 1):
        raise OSError("refusing linked or nonregular inventory destination")
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=TARGET.parent, prefix=".hosts.", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(TARGET)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> int:
    values = {
        "VPS_HOST": os.environ.get("KEYSPILLI_VPS_HOST", "").strip(),
        "VPS_USER": os.environ.get("KEYSPILLI_VPS_USER", "").strip() or "deploy",
        "VPS_SSH_KEY": os.environ.get("KEYSPILLI_VPS_SSH_KEY", "").strip() or "~/.ssh/keyspilli_deploy",
    }
    if not values["VPS_HOST"]:
        print("KEYSPILLI_VPS_HOST must be set to render the deploy inventory.", file=sys.stderr)
        return 1
    if not valid_host(values["VPS_HOST"]):
        print("VPS_HOST must be one IP address or DNS hostname.", file=sys.stderr)
        return 1
    if not SSH_USER.fullmatch(values["VPS_USER"]):
        print("VPS_USER must be one SSH username.", file=sys.stderr)
        return 1
    if not SAFE.fullmatch(values["VPS_SSH_KEY"]):
        print("VPS_SSH_KEY contains unsupported characters.", file=sys.stderr)
        return 1
    text = EXAMPLE.read_text()
    for name, value in values.items():
        placeholder = re.compile(rf"(:\s){name}$", re.M)
        if not placeholder.search(text):
            print(f"{EXAMPLE.name} is missing the {name} placeholder.", file=sys.stderr)
            return 1
        # JSON strings are valid YAML scalars, so the value is always quoted.
        text = placeholder.sub(lambda m: m.group(1) + json.dumps(value), text)
    try:
        write_inventory(text)
    except OSError as error:
        print(f"Unable to render inventory: {error}", file=sys.stderr)
        return 1
    print(f"Rendered {TARGET.relative_to(HERE.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
