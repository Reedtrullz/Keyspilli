#!/usr/bin/env python3
"""Retain a byte-identical offline-tested plugin candidate, not an installed release.

Use the compatibility report from the same trusted CI execution. This compares
reproducible bytes to that report; it does not authenticate an arbitrary report,
repeat its tests, confer musical approval, or install/publish anything.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

MAX_REPORT_BYTES = 16 * 1024 * 1024


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'duplicate JSON field: {key}')
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f'invalid JSON constant: {value}')


def read_report(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('a regular report file is required')
    # Bound the read itself, not just the resulting decoded object.
    with path.open('rb') as handle:
        raw = handle.read(MAX_REPORT_BYTES + 1)
    if len(raw) > MAX_REPORT_BYTES:
        raise ValueError('report size exceeds 16 MiB')
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_fields,
                       parse_constant=reject_constant)
    if (not isinstance(value, dict) or type(value.get('schemaVersion')) is not int
            or value['schemaVersion'] != 1
            or value.get('kind') != 'keyspilli-plugin-offline-compatibility'
            or value.get('status') != 'passed' or not isinstance(value.get('package'), dict)):
        raise ValueError('a passed offline compatibility report is required')
    if (value.get('installedAdoption') is not False
            or value.get('productionAdmission') is not False
            or value.get('musicalAcceptance') != 'not-established'
            or value.get('temporaryCatalogsRemoved') is not True
            or value.get('temporaryPackageRemoved') is not True):
        raise ValueError('compatibility scope or cleanup is not the expected provisional contract')
    return raw, value


def retain(source, report, destination):
    source, destination = Path(source), Path(destination)
    if destination.exists() or destination.is_symlink():
        raise FileExistsError('an exclusive new destination is required')
    destination = destination.resolve()
    if destination.is_relative_to(source.resolve()):
        raise ValueError('destination must be outside the plugin source')
    if not destination.parent.is_dir():
        raise FileNotFoundError('destination parent must already exist')
    report_bytes, receipt = read_report(report)
    script = Path(__file__).with_name('package-keyspilli-plugin.py')
    spec = importlib.util.spec_from_file_location('retain_plugin_packager', script)
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    with tempfile.TemporaryDirectory(prefix='keyspilli-retain-') as temporary:
        temporary = Path(temporary)
        archive, manifest = temporary / 'keyspilli.zip', temporary / 'package-manifest.json'
        package = builder.package(source, archive, manifest)
        # Canonical JSON comparison preserves JSON types (unlike True == 1).
        canonical = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
        if canonical(package) != canonical(receipt['package']):
            raise ValueError('rebuilt candidate differs from the tested package')
        payload = {'keyspilli.zip': archive.read_bytes(),
                   'package-manifest.json': manifest.read_bytes(),
                   'compatibility.json': report_bytes}
        # Nothing is published until packaging, all references and receipt equality
        # pass. An interrupted copy is NOT success; CI uploads only on success.
        destination.mkdir()
        for name, content in payload.items():
            with (destination / name).open('xb') as handle:
                handle.write(content)
        for name, content in payload.items():
            if (destination / name).read_bytes() != content:
                raise ValueError(f'retained candidate changed during readback: {name}')
    return {'status': 'retained', 'destination': str(destination),
            'archiveSha256': package['archiveSha256'],
            'sourceTreeSha256': package['sourceTreeSha256'],
            'compatibilityReportSha256': hashlib.sha256(report_bytes).hexdigest(),
            'installedAdoption': False, 'productionAdmission': False,
            'musicalAcceptance': 'not-established'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--destination', required=True, type=Path)
    args = parser.parse_args()
    try:
        result = retain(args.source, args.report, args.destination)
    except (OSError, ValueError, TypeError, KeyError, RecursionError) as error:
        parser.exit(1, f'{type(error).__name__}: {error}\n')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
