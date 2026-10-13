#!/usr/bin/env python3
"""Read-only prerequisite check; does not certify import or musical readiness."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile


REQUIRED = (
    'packages/catalog/src/ingest.ts',
    'apps/web/src/components/player/chords-backing.ts',
    'apps/web/scripts/prepare-song.mts',
    'apps/web/scripts/prepare-catalog-chords.mts',
    'apps/web/scripts/song-bundle.mts',
)
OPTIONAL = {
    'deterministic_workflow_script': 'apps/web/scripts/prepare-workflow.mts',
    'host_workflow_script': 'apps/web/scripts/song-workflow.mts',
    'arrangement_script': 'apps/web/scripts/arrange-song.mts',
    'chords_render_script': 'apps/web/scripts/render-prepared-chords.mts',
    'audio_review_script': 'apps/web/scripts/review-song-audio.mts',
}

# Must match the finite driver's source scopes; schema checks alone do not pin the implementation.
WORKFLOW_SCOPES = ('packages/midi/src', 'packages/catalog/src', 'packages/catalog/scripts', 'packages/player-core/src',
                   'apps/web/scripts', 'apps/web/src/lib', 'apps/web/src/components/player', 'package-lock.json')
# Actual generator fingerprint inputs in prepare-catalog-chords.mts.
PREPARATION_SCOPES = ('packages/midi/src', 'packages/player-core/src', 'packages/catalog/src',
                      'apps/web/src/lib', 'apps/web/src/components/player', 'package-lock.json')

# Independently match the deterministic wrapper's working-byte fingerprint, including
# catalog maps and module-resolution configuration omitted by the experimental protocol.
DETERMINISTIC_SCOPES = WORKFLOW_SCOPES + (
    'catalog', 'package.json', 'tsconfig.base.json',
    'apps/web/package.json', 'apps/web/tsconfig.json', 'apps/web/tsconfig.song-tools.json',
    'packages/midi/package.json', 'packages/midi/tsconfig.json',
    'packages/catalog/package.json', 'packages/catalog/tsconfig.json',
    'packages/player-core/package.json', 'packages/player-core/tsconfig.json',
)
DETERMINISTIC_REQUIRED = (
    'apps/web/scripts/prepare-workflow.mts', 'apps/web/scripts/prepare-song.mts',
    'apps/web/scripts/prepare-catalog-chords.mts', 'apps/web/scripts/song-bundle.mts',
    'apps/web/src/lib/prepare-workflow.ts', 'apps/web/src/lib/prepare-workflow-pins.ts',
    'apps/web/src/lib/prepare-workflow-process.ts', 'package.json', 'package-lock.json',
    'catalog/chord-sources.json',
)


def deterministic_probe_environment():
    """Capability discovery cannot inherit alternate hooks or production/provider settings."""
    allowed = ('PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TMP', 'TEMP',
               'SYSTEMROOT', 'SystemRoot')
    return {**{key: os.environ[key] for key in allowed if key in os.environ}, 'GIT_OPTIONAL_LOCKS': '0'}


def deterministic_implementation_fingerprint(root):
    root = Path(root).resolve()
    result = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', *DETERMINISTIC_SCOPES],
                            cwd=root, capture_output=True, timeout=10, check=True, stdin=subprocess.DEVNULL,
                            env=deterministic_probe_environment()).stdout
    if len(result) > 1024 * 1024:
        raise ValueError('deterministic source inventory exceeds its metadata bound')
    names = sorted(set(filter(None, result.decode('ascii').split('\0'))))
    if not names or len(names) > 4096:
        raise ValueError('deterministic source inventory exceeds its file-count bound')
    rows, total = [], 0
    for name in names:
        parts = name.split('/')
        if (len(name) > 4096 or any(part in ('', '.', '..') for part in parts)
                or '\\' in name or any(ord(char) < 32 or ord(char) > 126 for char in name)):
            raise ValueError('invalid deterministic source path')
        path = root
        for part in parts:
            path = path / part
            if path.is_symlink():
                raise ValueError('deterministic source symlink refused')
        descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        with os.fdopen(descriptor, 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode):
                raise ValueError('deterministic source must be a regular file')
            if info.st_size > 16 * 1024 * 1024 or total + info.st_size > 128 * 1024 * 1024:
                raise ValueError('deterministic source bytes exceed their bound')
            data = source.read(16 * 1024 * 1024 + 1)
        total += len(data)
        if len(data) > 16 * 1024 * 1024 or total > 128 * 1024 * 1024:
            raise ValueError('deterministic source bytes exceed their bound')
        rows.append([name, hashlib.sha256(data).hexdigest()])
    if any(name not in names for name in DETERMINISTIC_REQUIRED):
        raise ValueError('deterministic source inventory must include its entrypoint and required implementation files')
    return hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def check_deterministic_preparation_capabilities(root, node_executable):
    script = root / OPTIONAL['deterministic_workflow_script']
    try:
        # Validate the executable path and the working source before running any
        # capability code. A broken symlink is incompatible, not an absent host.
        path = root
        for part in Path(OPTIONAL['deterministic_workflow_script']).parts:
            path = path / part
            if path.is_symlink():
                raise ValueError('deterministic entrypoint symlink refused')
        if not script.exists():
            return {'status': 'absent', 'reason': 'Optional deterministic checkpoints absent; ordinary preparation remains available.'}
        if not stat.S_ISREG(script.stat().st_mode):
            raise ValueError('deterministic entrypoint must be a regular file')
        implementation = deterministic_implementation_fingerprint(root)
        output = subprocess.run([node_executable, '--import', 'tsx', str(script), 'capabilities'],
                                cwd=root, capture_output=True, text=True, timeout=15, check=True,
                                stdin=subprocess.DEVNULL, env=deterministic_probe_environment()).stdout
        if len(output.encode()) > 64 * 1024:
            raise ValueError('deterministic capability response exceeds its bound')
        value = json.loads(output)
        if not isinstance(value, dict):
            raise ValueError('deterministic capabilities must be an object')
        expected = {'schemaVersion': 1, 'deterministicPreparationContractVersions': [1],
                    'sourceFormats': ['midi'], 'resume': True, 'readOnlyVerify': True,
                    'maxPreparationAttempts': 3, 'automaticRetries': False, 'providerCalls': 0,
                    'productionAdmission': False,
                    'implementationSha256': implementation}
        # V1 has an exact shallow shape. Never retain arbitrary nested child
        # output in the ordinary preflight report, which must remain printable.
        if value.keys() != expected.keys():
            raise ValueError('deterministic capabilities contain missing or unknown fields')
        for key, required in expected.items():
            actual = value[key]
            if type(actual) is not type(required):
                raise ValueError('deterministic capability has the wrong JSON type')
            if isinstance(required, list) and (len(actual) > 8 or any(type(item) is not type(required[0]) for item in actual)):
                raise ValueError('deterministic capability list has an invalid shape')
        if deterministic_implementation_fingerprint(root) != implementation:
            raise ValueError('deterministic working source changed during capability discovery')
        # JSON equality preserves booleans versus numbers, including inside version lists.
        mismatches = [{'field': key, 'expected': required, 'actual': value.get(key)}
                      for key, required in expected.items()
                      if json.dumps(value.get(key), sort_keys=True) != json.dumps(required, sort_keys=True)]
        compatible = not mismatches
        return {'status': 'compatible' if compatible else 'incompatible', 'capabilities': value,
                'incompatibilities': mismatches,
                'command': [node_executable, '--import', 'tsx', str(script)] if compatible else None,
                'scope': 'Optional deterministic MIDI checkpoints and read-only saved-output verification; no experimental decision/selection contract, audio review or musical admission.'}
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, UnicodeError, RecursionError):
        return {'status': 'incompatible', 'reason': 'Deterministic contract or independent implementation fingerprint unavailable; use the checked ordinary path.'}


def implementation_fingerprint(root):
    paths = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', *WORKFLOW_SCOPES],
                           cwd=root, capture_output=True, timeout=10, check=True).stdout.decode().split('\0')
    values = [[p, hashlib.sha256((root / p).read_bytes()).hexdigest()] for p in sorted(set(filter(None, paths)))]
    return hashlib.sha256(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def check_workflow_capabilities(root, node_executable):
    script = root / OPTIONAL['host_workflow_script']
    if not script.is_file():
        return {'status': 'absent', 'reason': 'Optional experimental driver absent; ordinary preparation remains available.'}
    try:
        value = json.loads(subprocess.run([node_executable, '--import', 'tsx', str(script), 'capabilities'],
                           cwd=root, capture_output=True, text=True, timeout=15, check=True).stdout)
        compatible = (isinstance(value, dict) and 1 in value.get('workflowContractVersions', [])
                      and 2 in value.get('decisionContractVersions', []) and 1 in value.get('selectionContractVersions', [])
                      and value.get('resume') is True and value.get('implementationSha256') == implementation_fingerprint(root))
        return {'status': 'compatible' if compatible else 'incompatible', 'capabilities': value}
    except (OSError, subprocess.SubprocessError, ValueError, TypeError):
        return {'status': 'incompatible', 'reason': 'Host contract/fingerprint unavailable; use the checked ordinary path.'}


def choose_checkout(requested, candidates):
    return requested if requested in candidates else candidates[0] if len(candidates) == 1 else None


def check_sqlite(root, node_executable):
    try:
        subprocess.run([node_executable, '-e', "new (require('better-sqlite3'))(':memory:').close()"],
                       cwd=root, capture_output=True, text=True, timeout=10, check=True)
        return None
    except (OSError, subprocess.SubprocessError):
        return 'Selected Node cannot load/open better-sqlite3. Check its native ABI; retry --node /absolute/path/to/compatible/node, or follow the checkout lockfile/runtime instructions. Do not reinstall blindly.'


def check_arrangement_capabilities(root, node_executable):
    script = root / OPTIONAL['arrangement_script']
    if not script.is_file():
        return {'status': 'absent', 'selection_supported': False}
    try:
        result = subprocess.run([node_executable, '--import', 'tsx', str(script), 'capabilities'],
                                cwd=root, capture_output=True, text=True, timeout=15, check=True)
        value = json.loads(result.stdout)
        compatible = (isinstance(value, dict) and 2 in value.get('arrangementContractVersions', [])
                      and value.get('deliveredAudit') is True and value.get('checkedVoicingReplay') is True)
        return {'status': 'compatible' if compatible else 'incompatible', 'capabilities': value,
                'selection_supported': compatible and 1 in value.get('selectionContractVersions', [])}
    except (OSError, subprocess.SubprocessError, ValueError, TypeError):
        return {'status': 'incompatible', 'selection_supported': False,
                'reason': 'Optional arranger capabilities unavailable. Ordinary preparation remains usable; do not guess its contract.'}


def check_audio_review_capabilities(root, node_executable):
    script = root / OPTIONAL['audio_review_script']
    if not script.is_file():
        return {'status': 'absent'}
    try:
        result = subprocess.run([node_executable, '--import', 'tsx', str(script), 'capabilities'],
                                cwd=root, capture_output=True, text=True, timeout=15, check=True)
        value = json.loads(result.stdout)
        if not isinstance(value, dict):
            return {'status': 'incompatible', 'reason': 'Audio review capabilities must be a JSON object.'}
        expected = {
            'schemaVersion': 2, 'manifestSchemaVersion': 2, 'reportSchemaVersion': 2,
            'provider': 'anti.listen', 'pairwiseAudio': True, 'dryRun': True,
            'safeResume': True, 'validatesCompleteOutput': True,
            'mapsSourceOutputAnchors': True, 'symbolicEvidenceSeparate': True,
            'repairQueue': True, 'requiresGatewayBackendAttemptLimit': 1,
            'validatesOrderedSubmissionReceipt': True,
            'validatesGatewayModelAllowlist': True, 'strictLiveStdout': True,
        }
        support_limits = {'maxClipBytes': 2 * 1024 * 1024, 'maxPairBytes': 4 * 1024 * 1024,
                          'maxClipSeconds': 30, 'maxOutputTokens': 4096, 'maxProviderCallsPerJob': 1}
        mismatches = [{'field': key, 'expected': required, 'actual': value.get(key)}
                      for key, required in expected.items() if type(value.get(key)) is not type(required) or value.get(key) != required]
        supports = value.get('supports') if isinstance(value.get('supports'), dict) else {}
        mismatches += [{'field': 'supports.' + key, 'expected': required, 'actual': supports.get(key)}
                       for key, required in support_limits.items() if type(supports.get(key)) is not int or supports.get(key) != required]
        return {'status': 'incompatible' if mismatches else 'compatible', 'capabilities': value,
                'incompatibilities': mismatches,
                'scope': 'Optional contract only; ordinary preparation remains separate. Do not substitute a route or infer hearing.'}

    except (OSError, subprocess.SubprocessError, ValueError, TypeError, AttributeError):
        return {'status': 'incompatible', 'reason': 'Pairwise Anti listen capabilities unavailable; do not infer route or provider access.'}


def check_git_checkout(root):
    """Ordinary preparation reads Git-owned source paths before producing backing."""
    try:
        top = subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=root,
                             capture_output=True, text=True, timeout=10, check=True).stdout.strip()
        if Path(top).resolve() != root.resolve():
            raise ValueError('the selected directory is not its own Git checkout root')
        paths = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', *PREPARATION_SCOPES],
                               cwd=root, capture_output=True, text=True, timeout=10, check=True).stdout.split('\0')
        names = sorted(set(filter(None, paths)))
        if not names:
            raise ValueError('ordinary generator fingerprint source inventory is empty')
        for name in names:
            (root / name).read_bytes()
        return {'status': 'compatible', 'root': str(root), 'fingerprint_source_files': len(names)}
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        return {'status': 'blocked', 'reason': 'Ordinary preparation requires Git and a readable Keyspilli Git checkout/worktree rooted at this directory. Clone/select a supported checkout or repair its fingerprint source files. ' + str(error)}


def check_checkout(root, node_version):
    errors = []
    def version(value):
        match = re.fullmatch(r'v?(\d+)(?:\.(\d+))?(?:\.(\d+))?', value.strip())
        return (int(match[1]), int(match[2] or 0), int(match[3] or 0)) if match else None

    try:
        package = json.loads((root / 'package.json').read_text())
        if package.get('name') != 'keyspilli':
            errors.append('package.json must identify Keyspilli.')
        # ponytail: supports this repo's simple engine range; inspect new semver syntax before extending it.
        engine = package.get('engines', {}).get('node', '')
        bounds = re.fullmatch(r'>=(\d+(?:\.\d+){0,2})(?:\s+<(\d+(?:\.\d+){0,2}))?', engine)
        if not bounds:
            errors.append('Unrecognized Node requirement; inspect package.json and runtime pins.')
    except (OSError, ValueError, TypeError, AttributeError):
        errors.append('Missing or invalid package.json.')
        bounds = None
    actual = version(node_version)
    if not actual or (bounds and (actual < version(bounds[1]) or (bounds[2] and actual >= version(bounds[2])))):
        errors.append(f'Selected Node must satisfy {engine if bounds else "package.json"}; found {node_version or "none"}.')
    for pin in ('.nvmrc', '.node-version'):
        if (root / pin).exists():
            pinned = version((root / pin).read_text())
            if not pinned or actual != pinned:
                errors.append(f'Node must match {pin}; found {node_version or "none"}.')
    if (root / '.tool-versions').exists():
        errors.append('Inspect .tool-versions and verify its runtime requirement before proceeding.')
    missing = [path for path in REQUIRED if not (root / path).is_file()]
    if missing:
        errors.append('Required workflow files are missing; select a capable checkout.')
    tsx = root / 'node_modules/.bin/tsx'
    if not tsx.is_file() or not os.access(tsx, os.X_OK):
        errors.append('Install dependencies using this checkout\'s lockfile/runtime instructions; tsx is unavailable.')
    git_checkout = check_git_checkout(root)
    if git_checkout['status'] != 'compatible':
        errors.append(git_checkout['reason'])
    return {
        'checkout': str(root), 'node_version': node_version,
        'missing': missing, 'errors': errors, 'git_checkout': git_checkout,
        'optional_files': {key: (root / path).is_file() for key, path in OPTIONAL.items()},
    }


def check_music_review_capabilities(root, node_executable):
    """Read-only host discovery. Never import an analyzer or contact a gateway."""
    script = root / 'apps/web/scripts/report-music-review.mts'
    if not script.is_file():
        return {'status': 'absent', 'backends': {}, 'anti_bridge': 'optional-absent'}
    required = ('packages/catalog/src/acoustic-receipt.ts',
                'packages/catalog/src/acoustic-receipt-v1.schema.json',
                'packages/catalog/src/music-benchmark.ts',
                'apps/web/scripts/benchmark-music-review.mts',
                'apps/web/scripts/preview-music-repair.mts',
                'apps/web/src/lib/music-evidence-v1.schema.json')
    if not all((root / path).is_file() for path in required):
        return {'status': 'incompatible', 'reason': 'Music review host files/schema incomplete.'}
    try:
        result = subprocess.run([node_executable, '--import', 'tsx', str(script), 'capabilities'],
                                cwd=root, capture_output=True, text=True, timeout=15, check=True)
        value = json.loads(result.stdout)
        if not isinstance(value, dict):
            return {'status': 'incompatible', 'reason': 'Music review capabilities must be a JSON object.'}
        compatible = (isinstance(value, dict) and 1 in value.get('musicReviewContractVersions', [])
                      and 1 in value.get('acousticReceiptVersions', []) and value.get('providerCalls') == 0
                      and value.get('implicitInference') is False and value.get('humanAttestation') is False)
        names = value.get('optionalBackends', [])
        return {'status': 'compatible' if compatible else 'incompatible', 'capabilities': value,
                'implementation_files': {path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in required},
                'backends': {name: 'unchecked' for name in names if isinstance(name, str)},
                'anti_bridge': 'optional-unchecked',
                'paired_player_software': 'compatible' if 1 in value.get('playerInputEvidenceVersions', []) and (root/'packages/catalog/src/player-input-evidence.ts').is_file() else 'unavailable',
                'player_analyzer': 'optional-present-unqualified' if (root/'services/transcribe/src/player_input_evidence.py').is_file() else 'absent',
                'reference_bank': 'operator-selected-unchecked',
                'acoustic_admission': 'not-established',
                'scope': 'Contract discovery only; no model/weight/route availability or listening claim.'}
    except (OSError, subprocess.SubprocessError, ValueError, TypeError):
        return {'status': 'incompatible', 'reason': 'Read-only music review capability probe failed.'}


def music_review_self_test():
    from unittest.mock import patch
    with tempfile.TemporaryDirectory(prefix='keyspilli-music-preflight-') as directory:
        root = Path(directory)
        assert check_music_review_capabilities(root, '/explicit/node')['status'] == 'absent'
        paths = ('apps/web/scripts/report-music-review.mts', 'packages/catalog/src/acoustic-receipt.ts',
                 'packages/catalog/src/acoustic-receipt-v1.schema.json', 'packages/catalog/src/music-benchmark.ts',
                 'apps/web/scripts/benchmark-music-review.mts', 'apps/web/scripts/preview-music-repair.mts',
                 'apps/web/src/lib/music-evidence-v1.schema.json')
        for path in paths:
            target = root / path; target.parent.mkdir(parents=True, exist_ok=True); target.write_text('fixture')
        caps = {'musicReviewContractVersions':[1], 'acousticReceiptVersions':[1], 'providerCalls':0,
                'implicitInference':False, 'humanAttestation':False, 'optionalBackends':['basic-pitch','transkun']}
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([],0,stdout=json.dumps(caps))) as run:
            result = check_music_review_capabilities(root, '/explicit/node')
            assert result['status'] == 'compatible' and result['backends']['basic-pitch'] == 'unchecked'
            assert run.call_args.args[0][-1] == 'capabilities'
            assert run.call_args.args[0][0] == '/explicit/node'
        caps['implicitInference'] = True
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([],0,stdout=json.dumps(caps))):
            assert check_music_review_capabilities(root, '/explicit/node')['status'] == 'incompatible'


def check_score_review_capabilities(root, node_executable):
    script = root / 'apps/web/scripts/review-score.mts'
    if not script.is_file():
        return {'status': 'absent'}
    try:
        result = subprocess.run([node_executable, '--import', 'tsx', str(script), 'capabilities'],
                                cwd=root, capture_output=True, text=True, timeout=15, check=True)
        value = json.loads(result.stdout)
        compatible = (isinstance(value, dict) and value.get('schemaVersion') == 1
                      and value.get('inputSchemaVersion') == 1 and value.get('reportSchemaVersion') == 1
                      and value.get('symbolicReceiptSchemaVersion') == 1 and value.get('offline') is True
                      and value.get('offlineProviderCalls') == 0 and value.get('boundAudio') is True
                      and value.get('evidenceProfile') == 'evidence-v2' and value.get('maxRequests') == 1
                      and value.get('automaticStructuralPlayability') is True
                      and value.get('requiresOwnerListening') is False and value.get('productionAdmission') is False)
        return {'status': 'compatible' if compatible else 'incompatible', 'capabilities': value,
                'scope': 'Offline software contract only; provider and musical acceptance unverified.'}
    except (OSError, subprocess.SubprocessError, ValueError, TypeError):
        return {'status': 'incompatible', 'reason': 'Score review contract probe failed.'}


def score_review_self_test():
    from unittest.mock import patch
    with tempfile.TemporaryDirectory(prefix='keyspilli-score-preflight-') as directory:
        root = Path(directory)
        assert check_score_review_capabilities(root, '/explicit/node')['status'] == 'absent'
        script = root / 'apps/web/scripts/review-score.mts'
        script.parent.mkdir(parents=True)
        script.write_text('fixture')
        caps = {'schemaVersion': 1, 'inputSchemaVersion': 1, 'reportSchemaVersion': 1,
                'symbolicReceiptSchemaVersion': 1, 'offline': True, 'offlineProviderCalls': 0,
                'boundAudio': True, 'evidenceProfile': 'evidence-v2', 'maxRequests': 1,
                'automaticStructuralPlayability': True, 'requiresOwnerListening': False,
                'productionAdmission': False}
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([],0,stdout=json.dumps(caps))) as run:
            assert check_score_review_capabilities(root, '/explicit/node')['status'] == 'compatible'
            assert run.call_args.args[0][0] == '/explicit/node'
        caps['requiresOwnerListening'] = True
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([],0,stdout=json.dumps(caps))):
            assert check_score_review_capabilities(root, '/explicit/node')['status'] == 'incompatible'


def self_test():
    with tempfile.TemporaryDirectory(prefix='.check-', dir=Path(__file__).parent) as directory:
        root = Path(directory)
        subprocess.run(['git', 'init', '-q', str(root)], capture_output=True, check=True)
        (root / 'package.json').write_text(json.dumps({'name': 'keyspilli', 'engines': {'node': '>=20'}}))
        for name in (*REQUIRED, 'node_modules/.bin/tsx'):
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('')
        (root / 'node_modules/.bin/tsx').chmod(0o700)
        assert not check_checkout(root, 'v22.22.3')['errors']
        sqlite = root / 'node_modules/better-sqlite3/index.js'
        sqlite.parent.mkdir(parents=True)
        sqlite.write_text("module.exports=class {constructor(path){if(path!==':memory:')throw Error('disk write')}close(){}}")
        assert check_sqlite(root, shutil.which('node')) is None
        sqlite.write_text("throw Error('simulated native ABI mismatch')")
        assert 'native ABI' in check_sqlite(root, shutil.which('node'))
        assert check_arrangement_capabilities(root, shutil.which('node'))['status'] == 'absent'
        assert check_audio_review_capabilities(root, shutil.which('node'))['status'] == 'absent'
        assert not check_checkout(root, 'v22.22.3')['optional_files']['arrangement_script']
        arranger = root / OPTIONAL['arrangement_script']
        arranger.write_text('')
        from unittest.mock import patch
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps({'arrangementContractVersions': [1]}))):
            assert check_arrangement_capabilities(root, '/absolute/node')['status'] == 'incompatible'
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps({'arrangementContractVersions': [2], 'deliveredAudit': True, 'checkedVoicingReplay': True, 'selectionContractVersions': [1]}))) as run:
            assert check_arrangement_capabilities(root, '/absolute/node')['selection_supported']
            assert run.call_args.args[0][0] == '/absolute/node'
        assert check_checkout(root, 'v22.22.3')['optional_files']['arrangement_script']
        audio_review = root / OPTIONAL['audio_review_script']
        audio_review.write_text('authored audio review test')
        audio_caps = {
            'schemaVersion': 2, 'manifestSchemaVersion': 2, 'reportSchemaVersion': 2,
            'provider': 'anti.listen', 'pairwiseAudio': True, 'dryRun': True,
            'safeResume': True, 'validatesCompleteOutput': True,
            'mapsSourceOutputAnchors': True, 'symbolicEvidenceSeparate': True,
            'repairQueue': True, 'requiresGatewayBackendAttemptLimit': 1,
            'validatesOrderedSubmissionReceipt': True, 'validatesGatewayModelAllowlist': True, 'strictLiveStdout': True,
            'supports': {'maxClipBytes': 2 * 1024 * 1024, 'maxPairBytes': 4 * 1024 * 1024,
                         'maxClipSeconds': 30, 'maxOutputTokens': 4096, 'maxProviderCallsPerJob': 1},
        }
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(audio_caps))) as run:
            assert check_audio_review_capabilities(root, '/absolute/node')['status'] == 'compatible'
            assert run.call_args.args[0][0] == '/absolute/node'
        incompatible_audio_caps = {**audio_caps, 'requiresGatewayBackendAttemptLimit': 2}
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(incompatible_audio_caps))):
            assert check_audio_review_capabilities(root, '/absolute/node')['status'] == 'incompatible'
        workflow = root / 'apps/web/scripts/song-workflow.mts'
        workflow.write_text('authored workflow test')
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps({'workflowContractVersions':[1], 'decisionContractVersions':[2], 'selectionContractVersions':[1], 'resume':True, 'implementationSha256':'a'*64}))), patch(__name__+'.implementation_fingerprint', return_value='a'*64):
            assert check_workflow_capabilities(root, '/absolute/node')['status'] == 'compatible'
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps({'workflowContractVersions':[1], 'decisionContractVersions':[2], 'selectionContractVersions':[1], 'resume':True, 'implementationSha256':'b'*64}))), patch(__name__+'.implementation_fingerprint', return_value='a'*64):
            assert check_workflow_capabilities(root, '/absolute/node')['status'] == 'incompatible'
        assert choose_checkout('requested', ['other']) == 'other'
        assert choose_checkout('requested', ['requested','other']) == 'requested'
        assert choose_checkout('requested', ['one','two']) is None
        assert not check_checkout(root, 'v22.22.3')['errors']
        assert check_checkout(root, 'v18.20.0')['errors']
        (root / 'package.json').write_text(json.dumps({'name': 'keyspilli', 'engines': {'node': '>=22.22.3 <23'}}))
        (root / '.nvmrc').write_text('22.22.3\n')
        assert not check_checkout(root, 'v22.22.3')['errors']
        assert check_checkout(root, 'v20.20.2')['errors']
        assert check_checkout(root, 'v23.0.0')['errors']
        (root / REQUIRED[2]).unlink()
        assert REQUIRED[2] in check_checkout(root, 'v22.22.3')['missing']
        (root / 'package.json').write_text('[]')
        assert 'Missing or invalid package.json.' in check_checkout(root, 'v22.22.3')['errors']
    print('Checkout self-test passed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkout', nargs='?', type=Path)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--node', help='Select a compatible Node executable; default is PATH.')
    parser.add_argument('--discover', action='store_true', help='Keep this supported ordinary checkout; otherwise select one verified ordinary checkout from its Git worktrees.')
    parser.add_argument('--minimum-free-gib', type=float, default=0, help='Explicit disk budget for the planned job. Default 0 checks read-only prerequisites, not capacity for a render/build batch.')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        music_review_self_test()
        score_review_self_test()
        return 0
    if args.checkout is None or not args.checkout.is_dir():
        parser.error('Provide an existing Keyspilli checkout directory.')
    if not math.isfinite(args.minimum_free_gib) or args.minimum_free_gib < 0:
        parser.error('--minimum-free-gib must be a finite nonnegative number.')
    root = args.checkout.expanduser().resolve()
    node_version = ''
    node_executable = shutil.which(args.node or 'node')
    if node_executable:
        node_executable = os.path.abspath(node_executable)
    try:
        if node_executable:
            result = subprocess.run([node_executable, '--version'], capture_output=True, text=True, timeout=10, check=True)
            node_version = result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    inventory = []
    if args.discover:
        requested = check_checkout(root, node_version)
        if not requested['errors']:
            sqlite_error = check_sqlite(root, node_executable)
            if sqlite_error:
                requested['errors'].append(sqlite_error)
            else:
                inventory.append(root)
        try:
            # A supported explicit checkout needs neither Git worktree discovery
            # nor an experimental driver to use its ordinary preparation route.
            listing = '' if inventory else subprocess.run(['git', 'worktree', 'list', '--porcelain'], cwd=root, capture_output=True, text=True, timeout=10, check=True).stdout
            for line in listing.splitlines():
                if not line.startswith('worktree '):
                    continue
                candidate = Path(line[9:]).resolve()
                if candidate == root:
                    continue
                result = check_checkout(candidate, node_version)
                if not result['errors'] and check_sqlite(candidate, node_executable) is None:
                    inventory.append(candidate)
            selected = choose_checkout(root, inventory)
            if selected is None:
                print(json.dumps({'status':'blocked', 'checkout':str(root), 'verified_candidates':[str(p) for p in inventory],
                                  'errors':requested['errors'],
                                  'reason':'No unique supported ordinary checkout. Correct the reported runtime/files or select one of the verified candidates explicitly.'}, indent=2))
                return 1
            root = selected
        except (OSError, subprocess.SubprocessError):
            print(json.dumps({'status':'blocked', 'checkout':str(root), 'errors':requested['errors'], 'reason':'This checkout is unsupported and Git worktrees cannot be inspected. Correct its runtime/files or supply an explicit supported checkout.'}))
            return 1
    report = check_checkout(root, node_version)
    if args.discover:
        report['verified_candidates'] = [str(p) for p in inventory]
    report['node_executable'] = node_executable
    if not report['errors']:
        sqlite_error = check_sqlite(root, node_executable)
        report['sqlite_runtime'] = 'blocked' if sqlite_error else 'compatible'
        if sqlite_error:
            report['errors'].append(sqlite_error)
    report['arrangement'] = check_arrangement_capabilities(root, node_executable) if not report['errors'] else {'status': 'unchecked', 'selection_supported': False}
    report['audio_review'] = check_audio_review_capabilities(root, node_executable) if not report['errors'] else {'status': 'unchecked'}
    report['music_review'] = check_music_review_capabilities(root, node_executable) if not report['errors'] else {'status': 'unchecked'}
    report['score_review'] = check_score_review_capabilities(root, node_executable) if not report['errors'] else {'status': 'unchecked'}
    report['host_workflow'] = check_workflow_capabilities(root, node_executable) if not report['errors'] else {'status': 'unchecked'}
    report['deterministic_workflow'] = check_deterministic_preparation_capabilities(root, node_executable) if not report['errors'] else {'status': 'unchecked'}
    free_gib = shutil.disk_usage(root).free / 2**30
    report['free_gib'] = round(free_gib, 2)
    report['disk_budget'] = {'minimum_free_gib': args.minimum_free_gib, 'status': 'not-requested' if args.minimum_free_gib == 0 else 'sufficient' if free_gib >= args.minimum_free_gib else 'insufficient'}
    if free_gib < args.minimum_free_gib:
        report['errors'].append(f'Planned job requires {args.minimum_free_gib:g} GiB free; found {free_gib:.2f}. Reduce its bounded workload or choose suitable storage.')
    report['optional_tools'] = {name: shutil.which(name) is not None for name in ('ffmpeg', 'fluidsynth', 'yt-dlp')}
    report['status'] = 'blocked' if report['errors'] else 'prerequisites-present'
    report['preparation'] = {
        'route': 'ordinary', 'status': 'blocked' if report['errors'] else 'compatible',
        'command': None if report['errors'] else [node_executable, '--import', 'tsx', str(root / 'apps/web/scripts/prepare-song.mts')],
        'argument_names': ['INPUT.mid|INPUT.musicxml|INPUT.mxl', 'NEW_RUN_DIR', 'TITLE', 'ARTIST'],
        'next_action': 'Resolve errors before preparation.' if report['errors'] else 'Use this command prefix with the four arguments from the selected checkout. Use a new run directory inside it; output stays provisional until delivery checks pass.',
    }
    report['scope'] = 'File/runtime availability and local adapter capability only. This does not contact a gateway or verify a route, audio processing, source alignment, or musical quality.'
    print(json.dumps(report, indent=2))
    return 1 if report['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
