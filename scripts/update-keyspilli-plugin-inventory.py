#!/usr/bin/env python3
"""Refresh only the reviewed exact member list; never bless undeclared release files."""
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('keyspilli_packager', Path(__file__).with_name('package-keyspilli-plugin.py'))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)

def refresh(source, update=False):
    source = Path(source)
    resolved = source.resolve()
    if update and (resolved == Path.home() / 'plugins/keyspilli' or any(part == 'cache' for part in resolved.parts) and '.codex' in resolved.parts):
        raise ValueError('installed/canonical plugin updates are outside this workflow')
    rows, _ = packager.collect_members(source, check_hashes=not update)
    inventory = json.loads((source / 'source-members.json').read_text())
    hashes = {row['name']: row['sha256'] for row in rows if row['name'] != 'source-members.json'}
    if update:
        inventory['sha256'] = hashes
        (source / 'source-members.json').write_text(json.dumps(inventory, sort_keys=True, indent=2) + '\n')
    return {'status': 'updated' if update else 'verified', 'members': len(rows), 'installedAdoption': False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--update', action='store_true')
    args = parser.parse_args()
    print(json.dumps(refresh(args.source, args.update)))
