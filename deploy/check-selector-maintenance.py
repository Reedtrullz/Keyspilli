import hashlib
import json
import subprocess
from pathlib import Path

BASE = '678a6068b14490598b9f3e50dd7b3849591c5b49'
APPLICATION = {
    'apps/web/src/components/player/Player.tsx',
    'apps/web/src/components/player/VersionSelector.tsx',
    'apps/web/src/lib/catalog-api.ts',
    'apps/web/src/lib/player-versions.test.ts',
    'apps/web/src/lib/player-versions.ts',
}
RELEASE = {
    '.github/workflows/selector-maintenance.yml',
    'deploy/selector-maintenance.json',
    'deploy/check-selector-maintenance.py',
    'deploy/test-selector-maintenance.py',
    'docs/selector-maintenance-release.md',
}

def validate(manifest, changed, hashes):
    if (manifest.get('schemaVersion') != 1
        or manifest.get('kind') != 'keyspilli-player-ui-maintenance'
        or manifest.get('baselineCommit') != BASE
        or manifest.get('operation') != 'web_only_preserve_catalog'
        or manifest.get('musicalQualification') != 'unchanged; no new acceptance claimed'
        or set(manifest.get('applicationFiles', {})) != APPLICATION):
        raise ValueError('Invalid bounded maintenance manifest')
    if set(changed) != APPLICATION | RELEASE:
        raise ValueError('Out-of-scope source change or incomplete release')
    if hashes != manifest['applicationFiles']:
        raise ValueError('Reviewed selector bytes changed')
    return True

def main():
    subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no']):
        raise ValueError('Tracked worktree is dirty')
    manifest = json.loads(Path('deploy/selector-maintenance.json').read_text())
    changed = subprocess.check_output(['git', 'diff', '--name-only', BASE, 'HEAD'], text=True).splitlines()
    hashes = {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in APPLICATION}
    validate(manifest, changed, hashes)
    print(json.dumps({'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
                      'baseline': BASE, 'operation': manifest['operation'],
                      'applicationFiles': hashes, 'scopePassed': True}))

if __name__ == '__main__':
    main()
