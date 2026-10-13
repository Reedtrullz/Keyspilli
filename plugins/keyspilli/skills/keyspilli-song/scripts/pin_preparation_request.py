#!/usr/bin/env python3
"""Pin selected local MIDI/instruction bytes into a new deterministic request.

No network, provider, preparation, catalog or publication calls. Hashes identify
selected bytes; they do not prove the song, rights, PhrasePlan semantics or
musical quality. The maintained host must still perform full admission.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile

SOURCE_BYTES = 16 * 1024 * 1024
INSTRUCTION_BYTES = 1024 * 1024
PLAN_BYTES = 2 * 1024 * 1024
REQUEST_BYTES = 64 * 1024
# ECMAScript trim characters: metadata limits count UTF-16 units in the host.
JS_WHITESPACE = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


def checked_path(raw, label, new=False):
    text = os.fspath(raw)
    if (not isinstance(text, str) or not text or len(text) > 4096
            or '\\' in text or any(ord(c) < 32 or ord(c) == 127 for c in text)):
        raise ValueError(f'{label} path must be bounded and contain no control characters or backslashes')
    if '..' in Path(text).parts:
        raise ValueError(f'{label} path must not contain parent traversal')
    path = Path(os.path.abspath(text))
    if len(str(path)) > 4096:
        raise ValueError(f'{label} path exceeds 4096 characters')
    # Do not silently follow a source alias to a different location.
    for part in [*reversed(path.parents), path]:
        try:
            info = part.lstat()
        except FileNotFoundError:
            if part == path and new:
                return path
            raise FileNotFoundError(f'{label}{" parent" if new else ""} is missing: {part}') from None
        if stat.S_ISLNK(info.st_mode):
            raise ValueError(f'{label} path contains a symlink: {part}')
    if new:
        raise FileExistsError(f'an exclusive new output is required: {path}')
    return path


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def pin_file(path, limit, label):
    path = checked_path(path, label)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError(f'{label} must be a regular file')
    if before.st_size > limit:
        raise ValueError(f'{label} size exceeds {limit} bytes')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    fd = os.open(path, flags)
    digest, total, prefix = hashlib.sha256(), 0, b''
    with os.fdopen(fd, 'rb') as handle:
        opened = os.fstat(handle.fileno())
        if not stat.S_ISREG(opened.st_mode) or identity(opened) != identity(before):
            raise ValueError(f'{label} changed before reading')
        while True:
            chunk = handle.read(min(65536, limit + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise ValueError(f'{label} size exceeds {limit} bytes')
            prefix = (prefix + chunk[:14])[:14]
            digest.update(chunk)
        after = os.fstat(handle.fileno())
    if (identity(before) != identity(after) or total != before.st_size
            or identity(path.lstat()) != identity(before) or path.is_symlink()):
        raise ValueError(f'{label} changed while reading')
    return {'path': str(path), 'sha256': digest.hexdigest()}, identity(before), prefix


def metadata(value, label):
    if (not isinstance(value, str) or not value.strip(JS_WHITESPACE)
            or len(value.encode('utf-16-le')) // 2 > 256
            or any(ord(c) < 32 or ord(c) == 127 for c in value)):
        raise ValueError(f'{label} must contain 1 to 256 UTF-16 units without control characters')
    return value


def pin_request(source, instructions, output, title, artist, phrase_plan=None, expected_source_sha256=None):
    title, artist = metadata(title, 'title'), metadata(artist, 'artist')
    if not 1 <= len(instructions) <= 8:
        raise ValueError('supply 1 to 8 instruction files')
    if expected_source_sha256 is not None and not re.fullmatch(r'[0-9a-f]{64}', expected_source_sha256):
        raise ValueError('expected source pin must be a lowercase SHA-256')
    output = checked_path(output, 'output', new=True)
    plugin = Path(__file__).resolve().parents[3]
    if (plugin / 'source-members.json').is_file() and output.is_relative_to(plugin):
        raise ValueError('request output must be outside the plugin source')
    specifications = [(source, SOURCE_BYTES, 'source'),
                      *[(path, INSTRUCTION_BYTES, 'instruction') for path in instructions]]
    if phrase_plan is not None:
        specifications.append((phrase_plan, PLAN_BYTES, 'phrase plan'))
    observed = [pin_file(path, limit, label) for path, limit, label in specifications]
    pins = [value[0] for value in observed]
    if len({pin['path'] for pin in pins}) != len(pins):
        raise ValueError('source, instructions and phrase plan require distinct input paths')
    header = observed[0][2]
    if (len(header) < 14 or header[:4] != b'MThd'
            or int.from_bytes(header[4:8], 'big') < 6
            or int.from_bytes(header[4:8], 'big') + 8 > observed[0][1][2]):
        raise ValueError('source has an unsupported or truncated MIDI header')
    if expected_source_sha256 is not None and pins[0]['sha256'] != expected_source_sha256:
        raise ValueError('selected bytes do not match the expected source SHA-256')
    request = {'schemaVersion': 1, 'kind': 'keyspilli-deterministic-preparation',
               'sourceMidi': pins[0], 'instructions': pins[1:1 + len(instructions)],
               'title': title, 'artist': artist}
    if phrase_plan is not None:
        request['phrasePlan'] = pins[-1]
    raw = (json.dumps(request, sort_keys=True, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
    if len(raw) > REQUEST_BYTES:
        raise ValueError('request exceeds the host 64 KiB limit')
    # Recheck all files before writing. Later drift is still rejected by the host.
    for specification, original in zip(specifications, observed):
        if pin_file(*specification) != original:
            raise ValueError(f'{specification[2]} changed while constructing the request')
    checked_path(output, 'output', new=True)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    if output.read_bytes() != raw:
        raise ValueError('request changed during output readback')
    return {'status': 'pinned', 'requestPath': str(output),
            'requestSha256': hashlib.sha256(raw).hexdigest(),
            'sourceMidiSha256': pins[0]['sha256'], 'filesPinned': len(pins),
            'semanticAdmission': 'not-run', 'sourceIdentity': 'unknown',
            'preparationRun': False, 'providerCalls': 0,
            'musicalAcceptance': 'not-established'}


def self_test():
    with tempfile.TemporaryDirectory(prefix='keyspilli-pin-self-test-') as directory:
        root = Path(directory).resolve()
        source, instructions, output = root / 'source.mid', root / 'intent.md', root / 'request.json'
        events = b'\x00\x90\x3c\x50\x83\x60\x80\x3c\x00\x00\xff\x2f\x00'
        source.write_bytes(b'MThd\x00\x00\x00\x06\x00\x00\x00\x01\x01\xe0MTrk' + len(events).to_bytes(4, 'big') + events)
        instructions.write_text('Self-authored software control, not musical approval.\n', encoding='utf-8')
        result = pin_request(source, [instructions], output, 'Control', 'Software')
        request = json.loads(output.read_bytes())
        assert request['sourceMidi']['sha256'] == hashlib.sha256(source.read_bytes()).hexdigest()
        assert request['instructions'][0]['sha256'] == hashlib.sha256(instructions.read_bytes()).hexdigest()
        assert result['requestSha256'] == hashlib.sha256(output.read_bytes()).hexdigest()
        before = output.read_bytes()
        try:
            pin_request(source, [instructions], output, 'Other', 'Software')
        except FileExistsError:
            pass
        else:
            raise AssertionError('existing output was not refused')
        assert output.read_bytes() == before
    return {'status': 'passed', 'providerCalls': 0, 'musicalAcceptance': 'not-established',
            'scope': 'Offline request bytes, pins, readback and overwrite refusal only.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--source', type=Path)
    parser.add_argument('--instruction', action='append', type=Path, default=[])
    parser.add_argument('--output', type=Path)
    parser.add_argument('--title')
    parser.add_argument('--artist')
    parser.add_argument('--phrase-plan', type=Path)
    parser.add_argument('--expected-source-sha256')
    args = parser.parse_args()
    try:
        if args.self_test:
            if any((args.source, args.instruction, args.output, args.title, args.artist, args.phrase_plan,
                    args.expected_source_sha256 is not None)):
                raise ValueError('--self-test must be used without request arguments')
            result = self_test()
        else:
            if args.source is None or args.output is None or args.title is None or args.artist is None:
                raise ValueError('--source, --output, --title and --artist are required')
            result = pin_request(args.source, args.instruction, args.output, args.title, args.artist,
                                 args.phrase_plan, args.expected_source_sha256)
    except (OSError, ValueError, TypeError, UnicodeError) as error:
        parser.exit(1, f'{type(error).__name__}: {error}\n')
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
