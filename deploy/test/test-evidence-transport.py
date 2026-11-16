#!/usr/bin/env python3
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evidence_transport import MIB, WIRE, pack, unpack


class TransportTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.bundle = self.root / 'canonical.tar.gz'
        self.rehearsal = self.root / 'rehearsal-out'
        self.rehearsal.mkdir()
        (self.rehearsal / 'copy').write_bytes(b'original bytes')
        self.parts = self.root / 'parts'
        self.target = self.root / 'reconstructed'
        self.archive([('bundle.json', b'{}'), ('safe/file', b'original bytes')])

    def archive(self, rows):
        with tarfile.open(self.bundle, 'w:gz') as out:
            for name, data in rows:
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                entry.mode = 0o640
                out.addfile(entry, io.BytesIO(data))

    def test_roundtrip_preserves_duplicate_paths_and_modes(self):
        manifest = pack(self.bundle, self.rehearsal, self.parts, 17 * MIB)
        self.assertEqual(manifest['members'][1]['sha256'], manifest['members'][2]['sha256'])
        unpack(self.parts / 'manifest.json', self.parts, self.target)
        path = self.target / 'bundle/safe/file'
        self.assertEqual(path.read_bytes(), (self.target / 'rehearsal-out/copy').read_bytes())
        self.assertEqual(path.stat().st_mode & 0o777, 0o640)

    def test_unsafe_and_duplicate_members_refused(self):
        for index, bad in enumerate(('../outside', 'bundle.json')):
            with self.subTest(bad=bad):
                self.archive([('bundle.json', b'{}'), (bad, b'not allowed')])
                with self.assertRaisesRegex(ValueError, 'unsafe|duplicate'):
                    pack(self.bundle, self.rehearsal, self.root / str(index), 17 * MIB)

    def test_corrupt_and_truncated_parts_do_not_publish(self):
        pack(self.bundle, self.rehearsal, self.parts, 17 * MIB)
        part = self.parts / 'part-00.bin'
        original = part.read_bytes()
        for data in (original[:-1], b'X' + original[1:]):
            part.write_bytes(data)
            with self.assertRaisesRegex(ValueError, 'truncated|digest mismatch'):
                unpack(self.parts / 'manifest.json', self.parts, self.target)
            self.assertFalse(self.target.exists())

    def test_oversized_aggregate_has_no_published_manifest(self):
        with self.assertRaisesRegex(ValueError, 'exceeds cap'):
            pack(self.bundle, self.rehearsal, self.parts, WIRE - 1)
        self.assertFalse((self.parts / 'manifest.json').exists())

    def test_manifest_cannot_add_or_redirect_a_member(self):
        pack(self.bundle, self.rehearsal, self.parts, 17 * MIB)
        path = self.parts / 'manifest.json'
        manifest = json.loads(path.read_bytes())
        row = manifest['members'][1]
        for bad in ('bundle/../../escape', 'bundle/bundle.json'):
            row['path'] = bad
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'unsafe|duplicate'):
                unpack(path, self.parts, self.target)
            self.assertFalse(self.target.exists())


if __name__ == '__main__':
    unittest.main()
