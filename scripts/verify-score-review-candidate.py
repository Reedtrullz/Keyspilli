"""Retain bounded, source-checkout verification logs without activating providers."""
import argparse
import json
from pathlib import Path
import os
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keyspilli", type=Path, required=True)
    parser.add_argument("--anti", type=Path, required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if shutil.disk_usage(args.keyspilli).free < 30 * 1024**3:
        raise SystemExit("less than 30 GiB free; verification not started")
    args.output.mkdir(mode=0o700)
    env = {**os.environ, "PATH": str(args.node.parent) + os.pathsep + os.environ["PATH"]}
    commands = [
        ("keyspilli-tests", args.keyspilli, ["npm", "test"]),
        ("keyspilli-types", args.keyspilli, ["npm", "run", "typecheck"]),
        ("keyspilli-build", args.keyspilli, ["npm", "run", "build"]),
        ("anti-tests", args.anti, [str(args.anti / ".venv/bin/python"), "-m", "pytest"]),
    ]
    results = []
    for name, cwd, command in commands:
        log = args.output / (name + ".log")
        with log.open("xb") as output:
            try:
                result = subprocess.run(command, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=900)
                code = result.returncode
            except subprocess.TimeoutExpired:
                code = 124
        results.append({"name": name, "cwd": str(cwd), "command": command, "exitCode": code, "log": str(log)})
        print(json.dumps(results[-1]), flush=True)
    (args.output / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    raise SystemExit(1 if any(row["exitCode"] for row in results) else 0)


if __name__ == "__main__":
    main()
