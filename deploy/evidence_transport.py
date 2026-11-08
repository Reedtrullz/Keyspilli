#!/usr/bin/env python3
"""Pack sealed rehearsal files once per digest and restore their complete member set."""
import argparse
from contextlib import closing
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import tempfile


MIB = 1024 * 1024
PART = 7 * MIB
WIRE = 64 * MIB
EXPANDED = 512 * MIB
SCHEMA = 'keyspilli-evidence-transport/v1'
SHA = re.compile(r'[0-9a-f]{64}')


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def member_path(name):
    p = PurePosixPath(name)
    require(not p.is_absolute() and p.as_posix() == name and name != '.'
            and '..' not in p.parts and '\\' not in name and '\x00' not in name, 'unsafe member path')
    return p


def hash_file(file):
    digest = hashlib.sha256()
    with file.open('rb') as src:
        for chunk in iter(lambda: src.read(MIB), b''):
            digest.update(chunk)
    return digest.hexdigest()


def files(bundle, output):
    with tarfile.open(bundle, 'r:gz') as archive:
        for member in archive:
            name = 'bundle/' + member.name
            require(member.isfile() or member.isdir(), 'unsupported canonical bundle member')
            yield name, member.mode, member.size, archive.extractfile(member) if member.isfile() else None
    require(not output.is_symlink(), 'linked rehearsal root')
    for path in sorted(output.rglob('*')):
        name = 'rehearsal-out/' + path.relative_to(output).as_posix()
        require(not path.is_symlink() and (path.is_dir() or path.is_file()), 'unsafe rehearsal member')
        st = path.stat()
        if path.is_dir():
            yield name, st.st_mode & 0o777, 0, None
        else:
            with path.open('rb') as stream:
                yield name, st.st_mode & 0o777, st.st_size, stream


def save_blob(source, target, size):
    digest = hashlib.sha256()
    remaining = size
    with target.open('xb') as out:
        while remaining:
            data = source.read(min(remaining, MIB))
            require(bool(data), 'truncated source member')
            out.write(data)
            digest.update(data)
            remaining -= len(data)
        require(not source.read(1), 'member exceeds declared size')
    return digest.hexdigest()


def pack(bundle, output, dest, transfer_reserve):
    require(type(transfer_reserve) is int and 0 < transfer_reserve < WIRE, 'invalid wire reserve')
    dest.mkdir()
    members, seen = [], set()
    expanded = 0
    with tempfile.TemporaryDirectory(prefix='packing-', dir=dest) as name:
        scratch = Path(name)
        candidate = scratch / 'entry'
        for path, mode, size, stream in files(bundle, output):
            member_path(path)
            require(path not in seen, 'duplicate member')
            seen.add(path)
            require(0 <= mode <= 0o777 and size >= 0, 'unsafe member mode or size')
            expanded += size
            require(expanded <= EXPANDED, 'expanded size exceeds cap')
            row = dict(path=path, mode=mode, bytes=size, sha256=None)
            if stream is not None:
                with closing(stream):
                    sha = save_blob(stream, candidate, size)
                row['sha256'] = sha
                blob = scratch / sha
                if blob.exists():
                    candidate.unlink()
                else:
                    candidate.rename(blob)
            members.append(row)
        require('bundle/bundle.json' in seen, 'missing canonical bundle metadata')
        stream_path = scratch / 'blobs.tar.gz'
        with stream_path.open('xb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, compresslevel=6) as zipped:
            with tarfile.open(fileobj=zipped, mode='w|') as archive:
                for blob in sorted(scratch.glob('[0-9a-f]*')):
                    if not SHA.fullmatch(blob.name):
                        continue
                    info = tarfile.TarInfo(blob.name)
                    info.size = blob.stat().st_size
                    with blob.open('rb') as body:
                        archive.addfile(info, body)
        parts = []
        with stream_path.open('rb') as src:
            for index in range(10):
                data = src.read(PART)
                if not data:
                    break
                name = f'part-{index:02d}.bin'
                with (dest / name).open('xb') as out:
                    out.write(data)
                parts.append(dict(name=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
            require(not src.read(1), 'too many transport parts')
        manifest = dict(schema=SCHEMA, canonicalArchiveSha256=hash_file(bundle),
                        members=members, parts=parts, expandedBytes=expanded)
        raw = json.dumps(manifest, separators=(',', ':')).encode()
        require(len(raw) <= MIB and len(raw) + sum(p['bytes'] for p in parts) <= WIRE - transfer_reserve,
                'transport payload plus reserved receipt, logs and wrappers exceeds cap')
        with (dest / 'manifest.json').open('xb') as out:
            out.write(raw)
    return manifest


def unpack(manifest_path, parts_dir, dest):
    require(manifest_path.stat().st_size <= MIB, 'manifest exceeds cap')
    manifest = json.loads(manifest_path.read_bytes())
    require(manifest.get('schema') == SCHEMA and SHA.fullmatch(manifest.get('canonicalArchiveSha256', '')),
            'invalid transport identity')
    members = manifest['members']
    expected, paths = {}, set()
    expanded = 0
    for row in members:
        path = member_path(row['path'])
        require(path.parts[0] in ('bundle', 'rehearsal-out') and len(path.parts) > 1
                and path not in paths, 'duplicate or out-of-scope member')
        paths.add(path)
        size, mode, sha = row['bytes'], row['mode'], row['sha256']
        require(type(size) is int and size >= 0 and type(mode) is int and 0 <= mode <= 0o777, 'unsafe member')
        expanded += size
        require(expanded <= EXPANDED, 'expanded size exceeds cap')
        if sha is None:
            require(size == 0, 'nonempty directory')
        else:
            require(isinstance(sha, str) and SHA.fullmatch(sha), 'invalid member digest')
            require(expected.setdefault(sha, size) == size, 'conflicting member size')
    require(expanded == manifest['expandedBytes'] and PurePosixPath('bundle/bundle.json') in paths,
            'incomplete member manifest')
    parts = manifest['parts']
    require(0 < len(parts) <= 10, 'invalid part count')
    require(not dest.exists(), 'reconstruction destination already exists')
    with tempfile.TemporaryDirectory(prefix='reconstruct-', dir=dest.parent) as name:
        scratch = Path(name)
        assembled = scratch / 'blobs.tar.gz'
        total = manifest_path.stat().st_size
        with assembled.open('xb') as out:
            for i, part in enumerate(parts):
                require(part['name'] == f'part-{i:02d}.bin', 'wrong part order')
                size = part['bytes']
                require(type(size) is int and 0 < size <= PART and total + size <= WIRE, 'invalid part size')
                require(expanded + sum(expected.values()) + 2 * (total + size) <= EXPANDED,
                        'owned reconstruction work exceeds cap')
                source = parts_dir / part['name']
                require(source.is_file() and not source.is_symlink() and source.stat().st_size == size,
                        'missing or truncated part')
                data = source.read_bytes()
                require(len(data) == size and hashlib.sha256(data).hexdigest() == part['sha256'], 'part digest mismatch')
                out.write(data)
                total += size
        found = set()
        with gzip.open(assembled, 'rb') as zipped, tarfile.open(fileobj=zipped, mode='r|') as archive:
            for member in archive:
                sha = member.name
                require(sha in expected and sha not in found and member.isfile()
                        and member.size == expected[sha], 'unexpected or duplicate blob')
                found.add(sha)
                body = archive.extractfile(member)
                require(body is not None, 'missing blob')
                if body is not None:
                    with body:
                        require(save_blob(body, scratch / sha, member.size) == sha, 'blob digest mismatch')
            trailing = zipped.read(10241)
            require(len(trailing) <= 10240 and not any(trailing), 'non-padding bytes after blob archive')
        require(found == expected.keys(), 'missing blob')
        stage = scratch / 'files'
        stage.mkdir()
        directories = []
        for row in sorted(members, key=lambda item: item['path']):
            target = stage / row['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            if row['sha256'] is None:
                target.mkdir(exist_ok=True)
                directories.append((target, row['mode']))
            else:
                with (scratch / row['sha256']).open('rb') as body:
                    require(save_blob(body, target, row['bytes']) == row['sha256'], 'reconstruction digest mismatch')
                target.chmod(row['mode'])
        for target, mode in reversed(directories):
            target.chmod(mode)
        stage.rename(dest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('pack')
    p.add_argument('bundle', type=Path)
    p.add_argument('rehearsal_out', type=Path)
    p.add_argument('dest', type=Path)
    p.add_argument('--transfer-reserve', type=int, required=True)
    u = commands.add_parser('unpack')
    u.add_argument('manifest', type=Path)
    u.add_argument('parts', type=Path)
    u.add_argument('dest', type=Path)
    args = parser.parse_args()
    manifest = (pack(args.bundle, args.rehearsal_out, args.dest, args.transfer_reserve)
                if args.command == 'pack' else unpack(args.manifest, args.parts, args.dest))
    print(json.dumps(dict(status='PASS', expandedBytes=manifest['expandedBytes'])))


if __name__ == '__main__':
    main()
