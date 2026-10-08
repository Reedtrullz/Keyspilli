#!/usr/bin/env python3
"""Recovery-reference, failure, concurrency and bounded-cycle fixtures."""
import contextlib
import copy
import fcntl
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / "deploy" / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


storage = module("storage", "keyspilli-storage.py")
layers = module("layers", "keyspilli-layer-report.py")


def image_id(n):
    return "sha256:" + f"{n:064x}"


def make_image(n, repo="keyspilli", tags=None):
    return {"Id": image_id(n), "RepoTags": tags or [f"ghcr.io/reedtrullz/{repo}:{n:012x}"],
            "RepoDigests": [], "Size": 100, "Created": f"2026-10-{n:02d}",
            "RootFS": {"Layers": [image_id(99), image_id(n + 100)]},
            "Config": {"Labels": {"org.opencontainers.image.source": storage.SOURCE}}}


def cohort(root, n, pair):
    stamp = f"2026-10-08-{n:06d}"
    db = root / f"db-{stamp}.sqlite"
    with contextlib.closing(sqlite3.connect(db)) as c:
        c.execute("CREATE TABLE recovery (cycle INTEGER)")
        c.execute("INSERT INTO recovery VALUES (?)", (n,))
        c.commit()
    archive = root / f"artifacts-{stamp}.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name in ("artifacts", "seed-midi"):
            info = tarfile.TarInfo(name)
            info.type = tarfile.DIRTYPE
            tar.addfile(info)
        data = b"fixture recovery source"
        info = tarfile.TarInfo("artifacts/notes.mid")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    d = {"schemaVersion": 1, "stamp": stamp, "complete": True,
         "images": {"web": {"id": pair[0]}, "worker": {"id": pair[1]}}}
    for key, path in (("db", db), ("archive", archive)):
        d.update({key + "File": path.name, key + "Bytes": path.stat().st_size, key + "Sha256": storage.sha256(path)})
    marker = root / f"backup-manifest-{stamp}.json"
    marker.write_text(json.dumps(d))
    return marker


class FakePolicy(storage.Policy):
    def __init__(self, root):
        super().__init__(root / "backups", root / "state", reserve=0)
        self.backups.mkdir()
        self.catalog, self.running, self.calls = [], [], []

    def images(self):
        return copy.deepcopy(self.catalog)

    def containers(self):
        return copy.deepcopy(self.running)

    def inspect(self, kind, ids):
        return [copy.deepcopy(next(i for i in self.catalog if ref == i["Id"] or ref in (i["RepoTags"] or []) or ref in (i["RepoDigests"] or []))) for ref in ids]

    def run(self, *args, timeout=120):
        self.calls.append(args)
        if args[:2] == ("image", "rm"):
            ref = args[-1]
            image = next(i for i in self.catalog if i["Id"] == ref or ref in i["RepoTags"])
            if ref in image["RepoTags"]:
                image["RepoTags"].remove(ref)
            else:
                self.catalog.remove(image)
            return "deleted"
        if args[0] == "info":
            return str(self.backups)
        raise AssertionError(args)

    def set_pair(self, pair, healthy=True):
        self.running = [{"Name": name, "Image": i,
                         "State": {"Status": "running", "Health": {"Status": "healthy" if healthy else "unhealthy"}}}
                        for name, i in zip(("/keyspilli", "/keyspilli-worker"), pair)]


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.policy = FakePolicy(self.root)
        self.output = io.StringIO()
        self.capture = contextlib.redirect_stdout(self.output)
        self.capture.__enter__()
        self.addCleanup(self.capture.__exit__, None, None, None)

    def test_two_newest_full_verified_cohorts_and_sidecars(self):
        markers = [cohort(self.policy.backups, n, [image_id(1), image_id(2)]) for n in range(1, 5)]
        old = self.policy.backups / "db-2026-10-08-000001.sqlite"
        Path(str(old) + "-shm").write_bytes(b"sidecar")
        Path(str(old) + "-wal").write_bytes(b"")
        storage.retention(self.policy.backups)
        self.assertTrue(all(p.exists() for p in markers))
        self.assertIn("would-delete-backup", self.output.getvalue())
        storage.retention(self.policy.backups, True)
        self.assertEqual(sorted(self.policy.backups.glob("backup-manifest*")), markers[-2:])
        self.assertEqual(len(list(self.policy.backups.iterdir())), 6)
        for p in markers[-2:]:
            storage.verify_cohort(p)

    def test_failed_and_corrupt_new_backups_never_displace_good(self):
        good = [cohort(self.policy.backups, n, [image_id(1), image_id(2)]) for n in (1, 2)]
        bad = cohort(self.policy.backups, 3, [image_id(3), image_id(4)])
        (self.policy.backups / "artifacts-2026-10-08-000003.tar.gz").write_bytes(b"truncated")
        storage.retention(self.policy.backups, True)
        self.assertTrue(all(p.exists() for p in [*good, bad]))
        # Even corrupt cohort payloads retain their explicit recovery images.
        self.policy.set_pair([image_id(1), image_id(2)])
        self.policy.catalog = [make_image(i) for i in (1, 2, 3, 4, 5)]
        self.policy.clean_images(True)
        self.assertEqual({i["Id"] for i in self.policy.catalog}, {image_id(i) for i in (1, 2, 3, 4)})

    def test_hash_matching_invalid_sqlite_or_archive_not_accepted(self):
        good = [cohort(self.policy.backups, n, [image_id(1), image_id(2)]) for n in (1, 2)]
        for n, key in ((3, "db"), (4, "archive")):
            m = cohort(self.policy.backups, n, [image_id(1), image_id(2)])
            d = json.loads(m.read_text())
            f = self.policy.backups / d[key + "File"]
            f.write_bytes(b"hash-matching invalid recovery payload")
            d[key + "Bytes"], d[key + "Sha256"] = f.stat().st_size, storage.sha256(f)
            m.write_text(json.dumps(d))
        storage.retention(self.policy.backups, True)
        self.assertTrue(all(p.exists() for p in good))

    def test_hardlinks_and_open_payloads_protect_entire_cohort(self):
        for n in (1, 2, 3):
            cohort(self.policy.backups, n, [image_id(1), image_id(2)])
        old = self.policy.backups / "db-2026-10-08-000001.sqlite"
        linked = self.root / "replication-held"
        os.link(old, linked)
        storage.retention(self.policy.backups, True)
        self.assertTrue(old.exists())
        linked.unlink()
        with patch.object(storage, "open_file", side_effect=lambda p: p == old):
            storage.retention(self.policy.backups, True)
        self.assertTrue(old.exists())

    def test_partial_unlink_pins_images_and_reports_failure(self):
        markers = [cohort(self.policy.backups, n, [image_id(1), image_id(2)]) for n in (1, 2, 3)]
        unlink = Path.unlink
        def fail(p, *args, **kwargs):
            if p.name == "artifacts-2026-10-08-000001.tar.gz":
                raise PermissionError("injected disk error")
            return unlink(p, *args, **kwargs)
        with patch.object(Path, "unlink", fail), self.assertRaisesRegex(RuntimeError, "partial cohort"):
            storage.retention(self.policy.backups, True)
        self.assertTrue(markers[0].exists())
        self.assertTrue(all(p.exists() for p in markers[1:]))
        self.policy.catalog = [make_image(1), make_image(2)]
        self.assertEqual(set(self.policy.protections(self.policy.catalog)), {image_id(1), image_id(2)})
        storage.retention(self.policy.backups, True)
        self.assertFalse(markers[0].exists())
        self.assertTrue(all(p.exists() for p in markers[1:]))

    def test_current_rollback_stopped_foreign_alias_and_pending_pins(self):
        self.policy.catalog = [make_image(n) for n in range(1, 8)]
        self.policy.set_pair([image_id(1), image_id(2)])
        self.policy.running.append({"Name": "/stopped", "Image": image_id(3), "State": {"Status": "exited"}})
        self.policy.catalog[3]["RepoTags"].append("keyspilli:rollback")
        self.policy.catalog[4]["RepoTags"].append("owner-recovery:keep")
        self.policy.catalog[5]["RepoTags"].append("ghcr.io/reedtrullz/keyspilli:abcdef012345")
        self.policy.clean_images(True)
        self.assertEqual({i["Id"] for i in self.policy.catalog}, {image_id(n) for n in range(1, 6)})
        self.assertTrue(all("--force" not in call and "--no-prune" in call for call in self.policy.calls))

    def test_multiple_tags_removed_without_force_or_parent_prune(self):
        self.policy.set_pair([image_id(8), image_id(9)])
        self.policy.catalog = [make_image(1, tags=["ghcr.io/reedtrullz/keyspilli:1111111", "ghcr.io/reedtrullz/keyspilli:2222222"])]
        self.policy.clean_images(True)
        self.assertEqual(self.policy.calls, [("image", "rm", "--no-prune", "ghcr.io/reedtrullz/keyspilli:1111111"),
                                             ("image", "rm", "--no-prune", image_id(1))])

    def test_pending_deployment_blocks_competing_work_and_never_expires(self):
        self.policy.catalog = [make_image(1), make_image(2, "keyspilli-worker")]
        self.policy.set_pair([image_id(1), image_id(2)])
        refs = [i["RepoTags"][0] for i in self.policy.catalog]
        record = self.policy.begin(refs)
        record["startedAt"] = 0
        storage.atomic_json(self.policy.record, record)
        with self.assertRaisesRegex(RuntimeError, "deployment pending"):
            self.policy.cleanup(True)
        with self.assertRaisesRegex(RuntimeError, "deployment pending"):
            self.policy.begin(refs)
        self.policy.running[0]["State"]["Health"]["Status"] = "unhealthy"
        with self.assertRaisesRegex(RuntimeError, "not healthy"):
            self.policy.finish(record["token"])
        self.assertTrue(self.policy.record.exists())
        self.policy.set_pair([image_id(1), image_id(2)])
        self.policy.resolve(record["token"])
        self.assertFalse(self.policy.record.exists())

    def test_low_headroom_cleans_eligible_images_then_refuses_pull(self):
        self.policy.catalog = [make_image(1), make_image(2, "keyspilli-worker"), make_image(3)]
        self.policy.set_pair([image_id(1), image_id(2)])
        refs = ["ghcr.io/reedtrullz/keyspilli:aaaaaaa", "ghcr.io/reedtrullz/keyspilli-worker:aaaaaaa"]
        record = self.policy.begin(refs)
        with patch.object(self.policy, "headroom", side_effect=RuntimeError("insufficient disk headroom")):
            with self.assertRaisesRegex(RuntimeError, "insufficient disk headroom"):
                self.policy.pull(record["token"])
        self.assertNotIn(image_id(3), {i["Id"] for i in self.policy.catalog})
        self.assertFalse(any(c[0] == "pull" for c in self.policy.calls))
        self.assertTrue(self.policy.record.exists())

    def test_real_flock_competing_process_refuses_before_mutation(self):
        path = self.root / "lock"
        with path.open("w") as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            result = subprocess.run([sys.executable, str(ROOT / "deploy/keyspilli-storage.py"), "retention",
                                     "--lock", str(path), "--backups", str(self.policy.backups), "--apply"], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("lock busy", result.stdout)

    def test_twelve_backup_deployment_cycles_remain_bounded_and_healthy(self):
        totals = []
        for cycle in range(1, 13):
            pair_images = [make_image(2 * cycle, "keyspilli"), make_image(2 * cycle + 1, "keyspilli-worker")]
            self.policy.catalog.extend(pair_images)
            previous = [c["Image"] for c in self.policy.running]
            record = self.policy.begin([i["RepoTags"][0] for i in pair_images])
            for image in self.policy.catalog:
                image["RepoTags"] = [t for t in image["RepoTags"] if t not in storage.ROLLBACK]
                if image["Id"] in previous:
                    image["RepoTags"].append(storage.ROLLBACK[previous.index(image["Id"])])
            pair = [i["Id"] for i in pair_images]
            self.policy.set_pair(pair)
            self.policy.finish(record["token"])
            cohort(self.policy.backups, cycle, pair)
            self.policy.cleanup(True)
            good, invalid = storage.inventory_cohorts(self.policy.backups)
            self.assertFalse(invalid)
            self.assertEqual(len(good), min(cycle, 2))
            protected = self.policy.protections(self.policy.images())
            self.assertTrue(set(protected).issubset({i["Id"] for i in self.policy.catalog}))
            self.assertLessEqual(len(self.policy.catalog), 4)
            totals.append(sum(p.stat().st_size for p in self.policy.backups.iterdir()))
        self.assertLess(max(totals[2:]) - min(totals[2:]), 128)
        print("12 cycles: 2 verified cohorts, <=4 recovery images, payload variation <128 bytes", file=sys.stderr)

    def test_layer_chain_reconciliation_and_missing_metadata(self):
        a, b, c = image_id(1), image_id(2), image_id(3)
        records = {a: {"parent": None}, b: {"parent": a}, c: {"parent": b}}
        self.assertEqual(layers.closure({c}, records), {a, b, c})
        self.assertEqual(len(layers.chains([a, b, c])), 3)
        with self.assertRaisesRegex(ValueError, "inconsistent"):
            layers.closure({image_id(4)}, records)


if __name__ == "__main__":
    unittest.main(verbosity=2)
