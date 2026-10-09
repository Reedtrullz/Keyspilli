#!/usr/bin/env python3
"""Read-only prerequisite check; does not certify import or musical readiness."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
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
    'host_workflow_script': 'apps/web/scripts/song-workflow.mts',
    'arrangement_script': 'apps/web/scripts/arrange-song.mts',
    'chords_render_script': 'apps/web/scripts/render-prepared-chords.mts',
    'audio_review_script': 'apps/web/scripts/review-song-audio.mts',
}

# Must match the finite driver's source scopes; schema checks alone do not pin the implementation.
WORKFLOW_SCOPES = ('packages/midi/src', 'packages/catalog/src', 'packages/catalog/scripts', 'packages/player-core/src',
                   'apps/web/scripts', 'apps/web/src/lib', 'apps/web/src/components/player', 'package-lock.json')


def implementation_fingerprint(root):
    paths = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', *WORKFLOW_SCOPES],
                           cwd=root, capture_output=True, timeout=10, check=True).stdout.decode().split('\0')
    values = [[p, hashlib.sha256((root / p).read_bytes()).hexdigest()] for p in sorted(set(filter(None, paths)))]
    return hashlib.sha256(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def check_workflow_capabilities(root, node_executable):
    script = root / OPTIONAL['host_workflow_script']
    if not script.is_file():
        return {'status': 'absent'}
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
        supports = value.get('supports', {}) if isinstance(value, dict) else {}
        compatible = (
            isinstance(value, dict)
            and value.get('schemaVersion') == 2
            and value.get('manifestSchemaVersion') == 2
            and value.get('reportSchemaVersion') == 2
            and value.get('provider') == 'anti.listen'
            and value.get('pairwiseAudio') is True
            and value.get('dryRun') is True
            and value.get('safeResume') is True
            and value.get('validatesCompleteOutput') is True
            and value.get('mapsSourceOutputAnchors') is True
            and value.get('symbolicEvidenceSeparate') is True
            and value.get('repairQueue') is True
            and value.get('requiresGatewayBackendAttemptLimit') == 1
            and value.get('validatesOrderedSubmissionReceipt') is True
            and value.get('validatesGatewayModelAllowlist') is True
            and value.get('strictLiveStdout') is True
            and supports.get('maxClipBytes') == 2 * 1024 * 1024
            and supports.get('maxPairBytes') == 4 * 1024 * 1024
            and supports.get('maxClipSeconds') == 30
            and supports.get('maxOutputTokens') == 4096
            and supports.get('maxProviderCallsPerJob') == 1
        )
        return {'status': 'compatible' if compatible else 'incompatible', 'capabilities': value}
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, AttributeError):
        return {'status': 'incompatible', 'reason': 'Pairwise Anti listen capabilities unavailable; do not infer route or provider access.'}


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
        errors.append(f'Node {engine if bounds else "matching package.json"} is required on PATH; found {node_version or "none"}.')
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
    return {
        'checkout': str(root), 'node_version': node_version,
        'missing': missing, 'errors': errors,
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
    parser.add_argument('--discover', action='store_true', help='Prefer this capable checkout; otherwise select a unique verified host workflow from its Git worktrees.')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        music_review_self_test()
        score_review_self_test()
        return 0
    if args.checkout is None or not args.checkout.is_dir():
        parser.error('Provide an existing Keyspilli checkout directory.')
    root = args.checkout.expanduser().resolve()
    node_version = ''
    node_executable = shutil.which(args.node or 'node')
    try:
        if node_executable:
            result = subprocess.run([node_executable, '--version'], capture_output=True, text=True, timeout=10, check=True)
            node_version = result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    inventory = []
    if args.discover:
        try:
            listing = subprocess.run(['git', 'worktree', 'list', '--porcelain'], cwd=root, capture_output=True, text=True, timeout=10, check=True).stdout
            for line in listing.splitlines():
                if not line.startswith('worktree '):
                    continue
                candidate = Path(line[9:]).resolve()
                if not (candidate / OPTIONAL['host_workflow_script']).is_file():
                    continue
                result = check_checkout(candidate, node_version)
                if not result['errors'] and check_sqlite(candidate, node_executable) is None and check_workflow_capabilities(candidate, node_executable)['status'] == 'compatible':
                    inventory.append(candidate)
            selected = choose_checkout(root, inventory)
            if selected is None:
                print(json.dumps({'status':'blocked', 'checkout':str(root), 'verified_candidates':[str(p) for p in inventory],
                                  'reason':'No unique capable host workflow. Select an explicit verified checkout; ordinary preparation requires a separate successful preflight.'}, indent=2))
                return 1
            root = selected
        except (OSError, subprocess.SubprocessError):
            print(json.dumps({'status':'blocked', 'reason':'Cannot inspect Git worktrees; supply an explicit checkout.'}))
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
    report['free_gib'] = round(shutil.disk_usage(root).free / 2**30, 2)
    if shutil.disk_usage(root).free < 30 * 2**30:
        report['errors'].append('Less than 30 GiB free; stop before build/test/render loops.')
    report['optional_tools'] = {name: shutil.which(name) is not None for name in ('ffmpeg', 'fluidsynth', 'yt-dlp')}
    report['status'] = 'blocked' if report['errors'] else 'prerequisites-present'
    report['scope'] = 'File/runtime availability and local adapter capability only. This does not contact a gateway or verify a route, audio processing, source alignment, or musical quality.'
    print(json.dumps(report, indent=2))
    return 1 if report['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
