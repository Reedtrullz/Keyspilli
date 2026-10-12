import hashlib
import json
import subprocess
from pathlib import Path

BASE = 'ed0b138e33a787bf12220b0239730761225d9d06'
FEATURE = 'b491252f230da1829de4b08344f74c758543976c'
APPLICATION = {
    'apps/web/e2e/correctness-pass.spec.ts',
    'apps/web/e2e/home-navigation.spec.ts',
    'apps/web/e2e/key-holds.spec.ts',
    'apps/web/playwright.roadmap.config.ts',
    'apps/web/src/components/SongBrowser.test.ts',
    'apps/web/src/components/SongBrowser.tsx',
    'apps/web/src/components/player/DownloadDialog.tsx',
    'apps/web/src/components/player/LibraryReturnLink.tsx',
    'apps/web/src/components/player/Player.tsx',
    'apps/web/src/components/player/PracticeSetupDialog.tsx',
    'apps/web/src/components/player/active-arrangement-export.ts',
    'apps/web/src/components/player/player-ui-improvements.test.tsx',
    'apps/web/src/components/player/transpose-parity.test.tsx',
    'apps/web/src/lib/library-navigation.test.ts',
    'apps/web/src/lib/library-navigation.ts',
    'packages/player-core/src/keyboard-range.ts',
    'packages/player-core/test/keyboard-range.test.ts',
}
RELEASE = {
    '.github/workflows/correctness-maintenance.yml',
    'deploy/correctness-maintenance.json',
    'deploy/check-correctness-maintenance.py',
    'deploy/test-correctness-maintenance.py',
    'docs/correctness-maintenance-release.md',
}

def validate(manifest, changed, hashes):
    if (manifest.get('schemaVersion') != 1
        or manifest.get('kind') != 'keyspilli-player-ui-maintenance'
        or manifest.get('baselineCommit') != BASE
        or manifest.get('mergedFeature') != FEATURE
        or manifest.get('operation') != 'web_only_preserve_catalog'
        or manifest.get('musicalQualification') != 'unchanged; no new acceptance claimed'
        or set(manifest.get('applicationFiles', {})) != APPLICATION):
        raise ValueError('Invalid bounded correctness maintenance manifest')
    if set(changed) != APPLICATION | RELEASE:
        raise ValueError('Out-of-scope source change or incomplete release')
    if hashes != manifest['applicationFiles']:
        raise ValueError('Reviewed correctness bytes changed')
    return True

def main():
    subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
    if subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no']):
        raise ValueError('Tracked worktree is dirty')
    manifest = json.loads(Path('deploy/correctness-maintenance.json').read_text())
    changed = subprocess.check_output(['git', 'diff', '--name-only', BASE, 'HEAD'], text=True).splitlines()
    hashes = {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in APPLICATION}
    validate(manifest, changed, hashes)
    print(json.dumps({'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
                      'baseline': BASE, 'mergedFeature': FEATURE, 'operation': manifest['operation'],
                      'applicationFiles': hashes, 'scopePassed': True}))

if __name__ == '__main__':
    main()
