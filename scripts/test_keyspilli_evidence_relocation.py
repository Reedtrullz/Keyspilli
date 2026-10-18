from hashlib import sha256
from dataclasses import dataclass
import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest
from unittest.mock import patch

from scripts.evidence_relocation import checked_bytes, reconstruct, verify

ROOT = Path(__file__).resolve().parents[1]


class FrozenEvidenceTests(unittest.TestCase):
    def test_historical_baseline_and_packet_bytes_remain_available(self):
        controls = {
            "evidence/superpowers/2026-09-17-chords-v2-baseline.json": "c74d96a0da4652d8b04b903664ac488f11979549973c7aa5ccbceaf73aaf62de",
            "evidence/superpowers/2026-09-17-chords-v2-current-candidate-packet/manifest.json": "fbe1e6b64b3be87bdd6c556e605cfd482140703561c27abf19b2b12a5ac1ec14",
        }
        manifest = ROOT / "evidence/relocations.json"
        originals = {item["currentPath"]: item["originalStoredPath"]
                     for item in json.loads(manifest.read_text())["entries"]} if manifest.exists() else {}
        for path, expected in controls.items():
            with self.subTest(path=path):
                self.assertEqual(sha256((ROOT / originals.get(path, path)).read_bytes()).hexdigest(), expected)

    def test_historical_commit_links_keep_their_frozen_locations(self):
        report = ROOT / "evidence/superpowers/2026-09-17-chords-v2-current-candidate-packet/README.md"
        links = re.findall(r"https://github.com/Reedtrullz/Keyspilli/blob/([a-f0-9]{40})/([^\s)]+)", report.read_text())
        self.assertEqual(len(links), 2)
        for commit, path in links:
            with self.subTest(commit=commit, path=path):
                self.assertEqual(commit, "a423f382593182345cf95b3dea34dd8def2c3d2c")
                self.assertIn(path, {
                    "docs/superpowers/evidence/2026-09-17-chords-v2-current-candidate-packet/oops-development-64-108-original.webm",
                    "docs/superpowers/evidence/2026-09-17-chords-v2-current-candidate-packet/oops-development-64-108-current-automatic.webm",
                })

    def test_reconstruction_restores_frozen_paths_and_fixture_hashes(self):
        with tempfile.TemporaryDirectory(prefix="keyspilli-relocation-") as temporary:
            destination = Path(temporary) / "restored"
            records = verify(ROOT)
            self.assertEqual(reconstruct(ROOT, destination), len(records))
            for item, data in records:
                self.assertEqual((destination / item.original).read_bytes(), data)
            baseline = json.loads((destination / "docs/superpowers/evidence/2026-09-17-chords-v2-baseline.json").read_bytes())
            for kind, folder in (("productionFixtures", "2026-09-17-chords-v2-fixtures"),
                                 ("evaluationReservation", "2026-09-17-chords-v2-evaluation-fixtures")):
                for fixture in baseline[kind]:
                    for name, digest in fixture["fixtureFilesSha256"].items():
                        leaf = "a/notes.json" if name == "notes.json" else name
                        path = destination / "docs/superpowers/evidence" / folder / fixture["baseId"] / leaf
                        self.assertEqual(sha256(path.read_bytes()).hexdigest(), digest)

    def test_all_relocated_reports_keep_frozen_commit_urls(self):
        manifest = json.loads((ROOT / "evidence/relocations.json").read_bytes())
        pattern = re.compile(r'https://(?:github\.com/Reedtrullz/Keyspilli/blob|raw\.githubusercontent\.com/Reedtrullz/Keyspilli)/[a-f0-9]{40}/[^\s)"<>#\]]+')
        hosts = set()
        for item in manifest["entries"]:
            if not item["currentPath"].endswith(".md"):
                continue
            original = set(pattern.findall((ROOT / item["originalStoredPath"]).read_text()))
            current = set(pattern.findall((ROOT / item["currentPath"]).read_text()))
            hosts.update(url.split("/")[2] for url in original)
            with self.subTest(report=item["currentPath"]):
                self.assertFalse(original - current, f"historical URLs changed: {sorted(original - current)}")
        self.assertTrue({"github.com", "raw.githubusercontent.com"}.issubset(hosts))


@dataclass
class Fixture:
    parent: Path
    root: Path
    data: bytes
    source: Path
    entry: dict[str, str | int]
    destination: Path


class ReconstructionSafetyTests(unittest.TestCase):
    _fixture: Fixture | None = None

    @property
    def fixture(self) -> Fixture:
        if self._fixture is None:
            raise RuntimeError("fixture is not initialized")
        return self._fixture

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="keyspilli-relocation-")
        self.addCleanup(temporary.cleanup)
        parent = Path(temporary.name).resolve()
        root = parent / "source"
        (root / "evidence").mkdir(parents=True)
        data = b"unique original capture\x00\xff\n"
        source = root / "evidence/capture.bin"
        source.write_bytes(data)
        entry: dict[str, str | int] = {"originalPath": "docs/old/capture.bin", "originalStoredPath": "evidence/capture.bin",
                                      "originalSha256": sha256(data).hexdigest(), "originalBytes": len(data),
                                      "currentPath": "evidence/capture.bin", "currentSha256": sha256(data).hexdigest()}
        self._fixture = Fixture(parent, root, data, source, entry, parent / "restored")
        self.save_manifest()

    def save_manifest(self):
        (self.fixture.root / "evidence/relocations.json").write_text(json.dumps({"schemaVersion": 1, "entries": [self.fixture.entry], "contextOriginals": []}))

    def test_existing_destinations_and_repeated_checks_preserve_bytes(self):
        self.assertEqual(len(verify(self.fixture.root)), 1)
        self.assertEqual(len(verify(self.fixture.root)), 1)
        self.assertEqual(reconstruct(self.fixture.root, self.fixture.destination), 1)
        with self.assertRaises(FileExistsError):
            reconstruct(self.fixture.root, self.fixture.destination)
        self.assertEqual((self.fixture.destination / "docs/old/capture.bin").read_bytes(), self.fixture.data)
        self.assertEqual(self.fixture.source.read_bytes(), self.fixture.data)

    def test_tampering_is_rejected_before_any_output(self):
        self.fixture.source.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "integrity"):
            reconstruct(self.fixture.root, self.fixture.destination)
        self.assertFalse(self.fixture.destination.exists())
        self.assertEqual(self.fixture.source.read_bytes(), b"tampered")

    def test_traversal_and_symlink_inputs_are_rejected(self):
        self.fixture.entry["originalPath"] = "../outside.bin"
        self.save_manifest()
        with self.assertRaisesRegex(ValueError, "unsafe relative"):
            reconstruct(self.fixture.root, self.fixture.destination)
        self.fixture.entry["originalPath"] = "docs/old/capture.bin"
        self.save_manifest()
        outside = self.fixture.parent / "outside.bin"
        outside.write_bytes(self.fixture.data)
        self.fixture.source.unlink()
        self.fixture.source.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "symlink"):
            reconstruct(self.fixture.root, self.fixture.destination)
        self.assertEqual(outside.read_bytes(), self.fixture.data)
        self.assertFalse(self.fixture.destination.exists())

    def test_parent_alias_cannot_write_into_the_source_checkout(self):
        alias = self.fixture.parent / "alias"
        alias.symlink_to(self.fixture.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "outside the source"):
            reconstruct(self.fixture.root, alias / "restored")
        self.assertFalse((self.fixture.root / "restored").exists())

    def test_insufficient_space_stops_before_creating_the_destination(self):
        usage = shutil.disk_usage(self.fixture.parent)
        with patch("scripts.evidence_relocation.shutil.disk_usage", return_value=usage._replace(free=0)):
            with self.assertRaisesRegex(OSError, "reserve"):
                reconstruct(self.fixture.root, self.fixture.destination)
        self.assertFalse(self.fixture.destination.exists())

    def test_interrupted_and_failed_writes_release_only_the_new_output(self):
        for failure in (KeyboardInterrupt(), OSError("write interrupted")):
            def check(path, digest, size=None, failure=failure):
                if path.is_relative_to(self.fixture.destination):
                    raise failure
                return checked_bytes(path, digest, size)
            with self.subTest(failure=type(failure).__name__), patch("scripts.evidence_relocation.checked_bytes", side_effect=check):
                with self.assertRaises(type(failure)):
                    reconstruct(self.fixture.root, self.fixture.destination)
            self.assertFalse(self.fixture.destination.exists())
            self.assertEqual(self.fixture.source.read_bytes(), self.fixture.data)


if __name__ == "__main__":
    unittest.main()
