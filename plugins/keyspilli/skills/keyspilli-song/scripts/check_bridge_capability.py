#!/usr/bin/env python3
"""Run the real phrase-plan capabilities command and print one verdict line.

Prints "Bridge support available: source-gap-bridges-v1" (exit 0) or
"Bridge support unavailable: <reason>." (exit 1). Use that exact line in the answer.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

SCRIPT = 'apps/web/scripts/phrase-plan.mts'
WANTED = 'source-gap-bridges-v1'


def find_checkout(start=None):
    """Explicit KEYSPILLI_CHECKOUT, else the nearest parent of start (default: current directory) that holds the script."""
    env = os.environ.get('KEYSPILLI_CHECKOUT')
    if env and (Path(env) / SCRIPT).is_file():
        return Path(env).resolve()
    here = Path(start or '.').resolve()
    for folder in (here, *here.parents):
        if (folder / SCRIPT).is_file():
            return folder
    return None


def verdict(checkout, node):
    if checkout is None:
        found = find_checkout()
        if found is None:
            return False, f'{SCRIPT} not found in {Path.cwd()} or any parent directory'
        checkout = found
    root = Path(checkout).resolve()
    if not (root / SCRIPT).is_file():
        return False, f'{SCRIPT} not found in {root}'
    try:
        done = subprocess.run([node, '--import', 'tsx', SCRIPT, 'capabilities'], cwd=root, capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, f'capabilities command could not run: {error}'
    if done.returncode != 0:
        lines = [x for x in (done.stderr or done.stdout).strip().splitlines() if x.strip()]
        return False, 'capabilities command failed: ' + (lines[0][:200] if lines else f'exit {done.returncode}')
    try:
        value = json.loads(done.stdout).get('sourceGapBridges')
    except (ValueError, AttributeError):
        return False, 'capabilities output was not JSON'
    if value != WANTED:
        return False, f'sourceGapBridges is {value!r}, not {WANTED}'
    return True, WANTED


def self_test():
    import tempfile
    with tempfile.TemporaryDirectory() as folder:
        assert verdict(folder, 'node')[0] is False
        nested = Path(folder, 'repo/apps/web/scripts');nested.mkdir(parents=True);Path(nested, 'phrase-plan.mts').write_text('')
        deep = Path(folder, 'repo/plugins/x');deep.mkdir(parents=True)
        saved = os.environ.pop('KEYSPILLI_CHECKOUT', None)
        try:
            assert find_checkout(deep) == Path(folder, 'repo').resolve()
            assert find_checkout(Path(folder, 'repo/..')) is None
        finally:
            if saved is not None:
                os.environ['KEYSPILLI_CHECKOUT'] = saved
        script = Path(folder, SCRIPT)
        script.parent.mkdir(parents=True)
        script.write_text('')
        fake = Path(folder, 'fake-node')
        fake.write_text('#!/bin/sh\necho \'{"sourceGapBridges":"source-gap-bridges-v1"}\'\n')
        fake.chmod(0o755)
        assert verdict(folder, str(fake)) == (True, WANTED)
        fake.write_text('#!/bin/sh\necho \'{}\'\n')
        assert verdict(folder, str(fake))[0] is False
    print(json.dumps({'selfTest': 'passed'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', default=None, help='Keyspilli checkout (default: KEYSPILLI_CHECKOUT, else the nearest parent of the current directory that contains it)')
    parser.add_argument('--node', default=os.environ.get('KEYSPILLI_NODE') or 'node')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    ok, detail = verdict(args.checkout, args.node)
    print(f'Bridge support available: {detail}' if ok else f'Bridge support unavailable: {detail}.')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
