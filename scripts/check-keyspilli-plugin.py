#!/usr/bin/env python3
"""Check an extracted plugin and real ordinary preparation offline; never install or release it."""
import argparse
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import zipfile


HELPERS = ('check_bridge_capability.py', 'check_checkout.py', 'check_tutorial_delivery.py', 'find_chords_gaps.py', 'normalize_ug_score.py',
           'pin_preparation_request.py', 'plan_chords_bridges.py', 'prepare_syntheory.py', 'recover_vocal.py')
LEVELS = ('a', 'b', 'e', 'm', 'vb', 've')
ARTIFACTS = ('manifest.json', *[f'{level}/{name}' for level in LEVELS for name in ('notes.json', 'variant.mid', 'variant.xml')])
BUNDLE_FILES = (*['artifacts/' + name for name in ARTIFACTS], 'rows.json', 'timeline.json', 'playback.json', 'chords.mid', 'chords.musicxml')
HOST_SCOPES = ('packages/midi/src', 'packages/catalog/src', 'packages/catalog/scripts',
               'packages/player-core/src', 'apps/web/scripts', 'apps/web/src/lib',
               'apps/web/src/components/player', 'package-lock.json')
MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
MAX_OUTPUT_BYTES = 65536


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def read_json(path):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError(f'duplicate JSON field: {key}')
            value[key] = item
        return value
    return json.loads(Path(path).read_text(), object_pairs_hook=unique)


def packager():
    path = Path(__file__).with_name('package-keyspilli-plugin.py')
    spec = importlib.util.spec_from_file_location('keyspilli_package_checker', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_metadata(root):
    root = Path(root)
    plugin = read_json(root / '.codex-plugin/plugin.json')
    if (not isinstance(plugin, dict) or plugin.get('name') != 'keyspilli'
            or plugin.get('skills') != './skills/'
            or not isinstance(plugin.get('version'), str)
            or not re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?', plugin['version'])
            or not isinstance(plugin.get('description'), str) or not plugin['description'].strip()):
        raise ValueError('invalid plugin metadata or skills directory')
    skill = root / 'skills/keyspilli-song'
    frontmatter = re.match(r'\A---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)', (skill / 'SKILL.md').read_text())
    if (not frontmatter or not re.search(r'^name:\s*keyspilli-song\s*$', frontmatter[1], re.M)
            or not re.search(r'^description:\s*\S[^\r\n]+$', frontmatter[1], re.M)):
        raise ValueError('invalid keyspilli-song skill frontmatter')
    agent = (skill / 'agents/openai.yaml').read_text()
    if not re.search(r'^interface:\s*$', agent, re.M) or any(
            not re.search(r'^  ' + key + r':\s*["\']?\S[^\r\n]+$', agent, re.M)
            for key in ('display_name', 'short_description', 'default_prompt')) or '$keyspilli-song' not in agent:
        raise ValueError('invalid skill agent interface metadata')
    helpers = sorted(path.name for path in (skill / 'scripts').glob('*.py'))
    if helpers != list(HELPERS):
        raise ValueError('packaged helper inventory differs from the declared offline entries')
    return {'pluginName': plugin['name'], 'pluginVersion': plugin['version'], 'skillName': 'keyspilli-song',
            'helpers': helpers, 'references': packager().validate_references(root)}


def extract_package(archive, target, manifest):
    archive, target = Path(archive), Path(target)
    if archive.stat().st_size > MAX_ARCHIVE_BYTES or sha256(archive.read_bytes()) != manifest['archiveSha256']:
        raise ValueError('archive size or digest differs from the package manifest')
    rows = manifest['members']
    if not 1 <= len(rows) <= 128:
        raise ValueError('archive member count exceeds bounds')
    expected = {row['name']: row for row in rows}
    if len(expected) != len(rows):
        raise ValueError('duplicate archive member')
    payload = []
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        if sorted(item.filename for item in entries) != sorted(expected):
            raise ValueError('archive members differ from exact source inventory')
        if sum(item.file_size for item in entries) > MAX_ARCHIVE_BYTES:
            raise ValueError('extracted package exceeds bounds')
        for item in entries:
            path = PurePosixPath(item.filename)
            if (path.is_absolute() or '..' in path.parts or '\\' in item.filename
                    or item.is_dir() or stat.S_ISLNK(item.external_attr >> 16)
                    or item.compress_type != zipfile.ZIP_STORED or item.file_size > 1024 * 1024):
                raise ValueError('unsafe or unsupported archive member path/type')
            content = package.read(item)
            row = expected[item.filename]
            if len(content) != row['bytes'] or sha256(content) != row['sha256']:
                raise ValueError('extracted member hash differs from the pinned source')
            payload.append((item.filename, content))
    target.mkdir()
    for name, content in payload:
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as handle:
            handle.write(content)


def run_command(command, cwd, env, checks, timeout=60):
    started = time.monotonic()
    process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, start_new_session=os.name == 'posix')
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        if os.name == 'posix':
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        stdout, stderr = process.communicate()
    checks.append({'command': [str(value) for value in command], 'cwd': str(cwd),
                   'exitCode': process.returncode, 'timedOut': timed_out,
                   'elapsedSeconds': round(time.monotonic() - started, 3),
                   'stdout': stdout[:MAX_OUTPUT_BYTES], 'stderr': stderr[:MAX_OUTPUT_BYTES],
                   'outputTruncated': len(stdout) > MAX_OUTPUT_BYTES or len(stderr) > MAX_OUTPUT_BYTES})
    if timed_out or process.returncode:
        raise ValueError(f'command {"timeout" if timed_out else "failed"}: {Path(command[0]).name} {command[-1]}')
    return stdout


def validate_preflight(value, checkout, node):
    expected = [str(node), '--import', 'tsx', str(Path(checkout) / 'apps/web/scripts/prepare-song.mts')]
    if not isinstance(value, dict) or value.get('checkout') != str(checkout):
        raise ValueError('preflight selected a different checkout; rerun with that checkout explicitly')
    preparation = value.get('preparation', {})
    if (value.get('errors') or value.get('node_executable') != str(node)
            or preparation.get('route') != 'ordinary' or preparation.get('status') != 'compatible'
            or preparation.get('command') != expected):
        raise ValueError('ordinary preflight command/runtime is unavailable or differs from the selected checkout')
    return expected


def synthetic_midi():
    """28 self-authored piano keys in two tracks, 16 beats, no media/provider dependency."""
    def varint(value):
        result = [value & 127]
        while value > 127:
            value >>= 7
            result.insert(0, (value & 127) | 128)
        return bytes(result)
    chords = [(48, 52, 55), (47, 50, 55), (48, 52, 55), (43, 47, 50)]
    left = [(pitch, index * 4, 3.5) for index, chord in enumerate(chords) for pitch in chord]
    right = [(pitch, index, .75) for index, pitch in enumerate([60, 64, 67, 64, 62, 67, 71, 67, 60, 64, 67, 64, 62, 67, 71, 67])]
    tracks = []
    for channel, (name, notes) in enumerate(((b'Piano LH', left), (b'Piano RH', right))):
        events = [(0, -1, b'\xff\x03' + varint(len(name)) + name)]
        if channel == 0:
            events += [(0, -1, b'\xff\x51\x03\x07\xa1\x20'), (0, -1, b'\xff\x58\x04\x04\x02\x18\x08')]
        for pitch, start, duration in notes:
            events += [(round(start * 480), 1, bytes((0x90 | channel, pitch, 80))),
                       (round((start + duration) * 480), 0, bytes((0x80 | channel, pitch, 0)))]
        events.append((16 * 480, 2, b'\xff\x2f\x00'))
        body, previous = bytearray(), 0
        for tick, _, content in sorted(events, key=lambda event: (event[0], event[1])):
            body.extend(varint(tick - previous) + content)
            previous = tick
        tracks.append(b'MTrk' + len(body).to_bytes(4, 'big') + body)
    return b'MThd\x00\x00\x00\x06\x00\x01\x00\x02\x01\xe0' + b''.join(tracks)


def inspect_preparation(run, source_sha):
    run = Path(run)
    result = read_json(run / 'result.json')
    base = 'upload-' + source_sha
    bundle, installed = run / 'bundle', run / 'installed'
    if (result.get('status') != 'provisional' or result.get('sourceSha256') != source_sha
            or result.get('baseId') != base or result.get('bundle') != str(bundle)
            or result.get('installed') != str(installed)
            or any(result.get('checks', {}).get(key) is not True for key in ('freshImport', 'musicalIdempotence'))):
        raise ValueError('ordinary preparation must retain provisional status, exact source and verified freshImport/idempotence')
    manifest = read_json(bundle / 'bundle.json')
    if manifest.get('schemaVersion') != 1 or manifest.get('baseId') != base or set(manifest.get('files', {})) != set(BUNDLE_FILES):
        raise ValueError('unexpected ordinary preparation bundle manifest')
    for name in BUNDLE_FILES:
        path = bundle / name
        if path.is_symlink() or not path.is_file() or sha256(path.read_bytes()) != manifest['files'][name]:
            raise ValueError('changed bundled artifact hash: ' + name)
    expected_rows = [(base + '-' + level, base, level) for level in LEVELS]
    rows = read_json(bundle / 'rows.json')
    if sorted((row.get('id'), row.get('baseId'), row.get('level')) for row in rows) != sorted(expected_rows):
        raise ValueError('bundle must contain the exact six synthetic variants')
    catalog_rows = {}
    for label, directory in (('source', run / 'data'), ('installed', installed)):
        with closing(sqlite3.connect((directory / 'db.sqlite').as_uri() + '?mode=ro', uri=True)) as database:
            actual = database.execute('SELECT id, base_id, level FROM songs ORDER BY level').fetchall()
        if actual != expected_rows:
            raise ValueError(label + ' catalog must contain exactly six synthetic variants')
        catalog_rows[label] = len(actual)
        for name in ARTIFACTS:
            path = directory / 'artifacts' / base / name
            if path.is_symlink() or not path.is_file() or sha256(path.read_bytes()) != manifest['files']['artifacts/' + name]:
                raise ValueError(label + ' artifact hash differs after ordinary import: ' + name)
    marker = read_json(installed / 'bundle-install.json')
    digest = sha256((bundle / 'bundle.json').read_bytes())
    if marker.get('status') != 'verified' or marker.get('baseId') != base or marker.get('bundleHash') != digest:
        raise ValueError('second catalog lacks its verified exact-bundle installation marker')
    return {'status': 'provisional', 'sourceSha256': source_sha, 'baseId': base,
            'checks': result['checks'], 'catalogRows': catalog_rows, 'levels': list(LEVELS),
            'bundleSha256': digest, 'artifactSha256': manifest['files'],
            'scope': 'Real ordinary prepare, fresh six-row import and repeated exact bundle install; no musical approval.'}


@contextmanager
def smoke_directory(checkout):
    if not os.environ.get('KEYSPILLI_EVIDENCE_RUN'):
        with tempfile.TemporaryDirectory(prefix='keyspilli-plugin-smoke-', dir=checkout) as temporary:
            yield Path(temporary)
        return
    smoke = Path(tempfile.mkdtemp(prefix='keyspilli-plugin-smoke-', dir=checkout))
    created = smoke.stat()
    lifecycle_env = {key: os.environ[key] for key in ('PATH', 'KEYSPILLI_EVIDENCE_ROOT', 'KEYSPILLI_EVIDENCE_RUN')}
    lifecycle_env['KEYSPILLI_REAL_DOCKER'] = os.environ.get('KEYSPILLI_REAL_DOCKER', shutil.which('docker') or 'docker')
    command = [sys.executable, '-B', str(checkout / 'deploy/keyspilli-evidence.py')]
    try:
        subprocess.run([*command, 'register-external', str(smoke)], env=lifecycle_env, check=True, timeout=15)
    except BaseException:
        if not smoke.is_symlink() and smoke.exists() and (smoke.stat().st_dev, smoke.stat().st_ino) == (created.st_dev, created.st_ino) and not any(smoke.iterdir()):
            smoke.rmdir()
        raise
    try:
        yield smoke
    finally:
        subprocess.run([*command, 'collect-external', str(smoke)], env=lifecycle_env, check=True, timeout=15)


def check(source, checkout, node, report):
    # Resolve report aliases before either mkdir or file reservation can alter source.
    source, checkout, report = Path(source), Path(checkout).resolve(), Path(report).resolve()
    if report.is_relative_to(source.resolve()):
        raise ValueError('report must be outside the packaged source')
    report.parent.mkdir(parents=True, exist_ok=True)
    # Reserve the caller's exclusive report before packaging or creating any catalog.
    with report.open('x') as output:
        value = {'schemaVersion': 1, 'kind': 'keyspilli-plugin-offline-compatibility', 'status': 'failed',
                 'checkedAt': datetime.now(timezone.utc).isoformat(), 'source': str(source.absolute()),
                 'checkout': str(checkout), 'commands': [], 'installedAdoption': False,
                 'productionAdmission': False, 'musicalAcceptance': 'not-established',
                 'limits': {'maxPackageBytes': MAX_ARCHIVE_BYTES, 'maxPackageMembers': 128,
                            'commandTimeoutSeconds': 60, 'preparationTimeoutSeconds': 180,
                            'capturedOutputCharactersPerStream': MAX_OUTPUT_BYTES,
                            'providerCallsRequested': 0, 'sampledPianoRendered': False,
                            'scope': 'Synthetic software compatibility only; no provider, SF2, source truth, listening or release qualification.'}}
        try:
            executable = shutil.which(str(node))
            if not executable:
                raise ValueError('selected Node executable is unavailable')
            executable = str(Path(executable).resolve())
            # Do not inherit provider credentials, production catalog paths or Node startup hooks.
            env = {'PATH': str(Path(executable).parent) + os.pathsep + os.environ.get('PATH', ''),
                   'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1', 'NODE_ENV': 'test'}
            runtime = json.loads(run_command([executable, '-e', 'console.log(JSON.stringify({node:process.version,executable:process.execPath,platform:process.platform,arch:process.arch,modules:process.versions.modules}))'], checkout, env, value['commands']))
            if runtime['node'] != 'v22.22.3':
                raise ValueError('offline compatibility currently requires the pinned Node 22.22.3')
            value['runtime'] = {**runtime, 'python': sys.version.split()[0], 'pythonExecutable': sys.executable}
            value['checkerSha256'] = sha256(Path(__file__).read_bytes())
            value['packagerSha256'] = sha256(Path(__file__).with_name('package-keyspilli-plugin.py').read_bytes())
            value['checkoutCommit'] = run_command(['git', 'rev-parse', 'HEAD'], checkout, env, value['commands']).strip()
            names = run_command(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', *HOST_SCOPES], checkout, env, value['commands']).split('\0')
            host_rows = [[name, sha256((checkout / name).read_bytes())] for name in sorted(set(filter(None, names)))]
            value['hostImplementation'] = {'sha256': sha256(json.dumps(host_rows, separators=(',', ':')).encode()),
                                           'fileCount': len(host_rows), 'scopes': list(HOST_SCOPES)}
            builder = packager()
            with tempfile.TemporaryDirectory(prefix='keyspilli-plugin-check-') as directory:
                work = Path(directory)
                manifest = builder.package(source, work / 'candidate.zip', work / 'candidate.json')
                value['package'] = manifest
                extracted = work / 'extracted'
                extract_package(work / 'candidate.zip', extracted, manifest)
                value['metadata'] = validate_metadata(extracted)
                if builder.collect_members(extracted)[0] != manifest['members']:
                    raise ValueError('extracted inventory differs from packaged source')
                scripts = extracted / 'skills/keyspilli-song/scripts'
                for helper in HELPERS:
                    for flag in ('--help', '--self-test'):
                        run_command([sys.executable, '-B', str(scripts / helper), flag], extracted, env, value['commands'])
                preflight = json.loads(run_command([sys.executable, '-B', str(scripts / 'check_checkout.py'), str(checkout), '--node', executable, '--discover'], extracted, env, value['commands']))
                value['preflight'] = preflight
                preparation = validate_preflight(preflight, checkout, executable)
                help_text = run_command([executable, '--import', 'tsx', str(checkout / 'packages/catalog/scripts/render-midi.ts'), '--help'], checkout, env, value['commands'])
                if 'Usage: render-midi.ts --input FILE --output FILE' not in help_text or '--soundfont' not in help_text:
                    raise ValueError('implemented render-midi CLI help is unavailable')
                value['renderMidi'] = {'status': 'help-verified', 'renderedAudio': False, 'capabilitiesQueried': False}
                with smoke_directory(checkout) as smoke:
                    source_bytes = synthetic_midi()
                    input_path = smoke / 'synthetic.mid'
                    input_path.write_bytes(source_bytes)
                    if preflight.get('deterministic_workflow', {}).get('status') == 'compatible':
                        request_path = smoke / 'request.json'
                        instructions = scripts.parent / 'SKILL.md'
                        pinning = json.loads(run_command([
                            sys.executable, '-B', str(scripts / 'pin_preparation_request.py'),
                            '--source', str(input_path), '--instruction', str(instructions),
                            '--title', 'Synthetic plugin compatibility', '--artist', 'Software control',
                            '--expected-source-sha256', sha256(source_bytes), '--output', str(request_path),
                        ], checkout, env, value['commands']))
                        if (pinning.get('status') != 'pinned' or pinning.get('requestPath') != str(request_path)
                                or pinning.get('requestSha256') != sha256(request_path.read_bytes())
                                or pinning.get('semanticAdmission') != 'not-run'):
                            raise ValueError('extracted helper did not retain the exact provisional request')
                        # Import the maintained host admission, not a mirrored Python schema.
                        admission = json.loads(run_command([
                            executable, '--import', 'tsx', '--input-type=module', '-e',
                            "import {admitRequest} from './apps/web/src/lib/prepare-workflow-pins.ts'; "
                            "const a = admitRequest(process.cwd(), process.argv[1]); "
                            "console.log(JSON.stringify({kind:a.request.kind, sourceSha256:a.sourceSha256, "
                            "instructions:a.request.instructions, files:a.files.length}));",
                            '--', str(request_path),
                        ], checkout, env, value['commands']))
                        if admission != {'kind': 'keyspilli-deterministic-preparation',
                                         'sourceSha256': sha256(source_bytes), 'files': 3,
                                         'instructions': [{'path': str(instructions),
                                                           'sha256': sha256(instructions.read_bytes())}]}:
                            raise ValueError('actual host admission differs from the selected input bytes')
                        value['requestPinning'] = {'status': 'passed', 'pinning': pinning, 'admission': admission,
                                                   'scope': 'Extracted request helper and actual host admission; no musical approval.'}
                    else:
                        value['requestPinning'] = {'status': 'unavailable',
                                                   'reason': 'No compatible deterministic host; ordinary preparation remains independent.'}
                    run = smoke / 'ordinary-run'
                    run_command([*preparation, str(input_path), str(run), 'Synthetic plugin compatibility', 'Software control'], checkout, env, value['commands'], timeout=180)
                    value['preparation'] = inspect_preparation(run, sha256(source_bytes))
                if smoke.exists():
                    raise ValueError('temporary catalog directory remains after child completion and cleanup')
                if builder.collect_members(source)[0] != manifest['members'] or builder.collect_members(extracted)[0] != manifest['members']:
                    raise ValueError('source or extracted package changed during compatibility checks')
            if smoke.exists() or work.exists():
                raise ValueError('temporary catalog or package directory remains after child completion and cleanup')
            value['temporaryCatalogsRemoved'] = True
            value['temporaryPackageRemoved'] = True
            value['status'] = 'passed'
        except (OSError, ValueError, KeyError, TypeError, sqlite3.Error, zipfile.BadZipFile, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            value['error'] = f'{type(error).__name__}: {error}'
        output.write(json.dumps(value, indent=2, sort_keys=True) + '\n')
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--checkout', required=True, type=Path)
    parser.add_argument('--node', required=True)
    parser.add_argument('--report', required=True, type=Path, help='Exclusive new JSON report outside the plugin source.')
    args = parser.parse_args(argv)
    try:
        result = check(args.source, args.checkout, args.node, args.report)
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')
    print(json.dumps({'status': result['status'], 'report': str(args.report.absolute()),
                      **({'error': result['error']} if 'error' in result else {})}))
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
