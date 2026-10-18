#!/usr/bin/env python3
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import tarfile
import hashlib
import unittest
import shutil
import importlib.util
import contextlib
from types import SimpleNamespace
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "keyspilli-evidence.py"


class Lifecycle(unittest.TestCase):
    def __init__(self, methodName="runTest"):
        super().__init__(methodName)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve() / "owned"
        self.source = self.root.parent / "source.mid"
        self.env = dict(os.environ)
        self.dead_pid = 0

    def setUp(self):
        self.addCleanup(self.temp.cleanup)
        self.source.write_bytes(b"MThd-immutable-input")
        dead = subprocess.Popen([sys.executable, "-c", "pass"])
        dead.wait(timeout=5)
        self.dead_pid = dead.pid
        self.env = {**os.environ, "KEYSPILLI_EVIDENCE_RESERVE_BYTES": "0",
                    "KEYSPILLI_EVIDENCE_LIMIT_BYTES": str(32 * 1024 * 1024)}

    def cli(self, *args, check=True):
        result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.root), *args],
                                env=self.env, capture_output=True, text=True, timeout=15)
        if check:
            logs = "" if result.returncode == 0 else "\n".join(path.read_text() for path in self.root.glob("evidence/*/command.log"))
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr + logs)
        return result

    def worker(self, body, exit_code=0):
        code = (
            "import os, pathlib, subprocess, sys; "
            "p=pathlib.Path(os.environ['KEYSPILLI_SCRATCH']); "
            f"subprocess.run([sys.executable,{str(SCRIPT)!r},'copy',{str(self.source)!r},'input.mid'],check=True); "
            "(p/'recording.wav').write_bytes(b'RIFF-unique-recording'); "
            "(p/'db.sqlite').write_bytes(b'unique-database'); "
            + body + f"; sys.exit({exit_code})"
        )
        return ["run", "--peak-bytes", "1048576", "--", sys.executable, "-c", code]

    def documents(self):
        return [json.loads(p.read_text()) for p in (self.root / "runs").glob("*/run.json")]

    def test_success_failure_and_repeated_cleanup_preserve_evidence_and_reconstruct(self):
        for exit_code in (0, 7):
            result = self.cli(*self.worker("print('raw-result')", exit_code), check=False)
            self.assertEqual(result.returncode, exit_code, result.stdout + result.stderr)
        self.assertEqual(len(self.documents()), 2)
        for doc in self.documents():
            run = doc["id"]
            self.assertFalse((self.root / "scratch" / run).exists())
            evidence = self.root / "evidence" / run
            self.assertEqual((evidence / "files/recording.wav").read_bytes(), b"RIFF-unique-recording")
            self.assertEqual((evidence / "files/db.sqlite").read_bytes(), b"unique-database")
            self.assertIn("raw-result", (evidence / "command.log").read_text())
            dest = self.root.parent / run
            self.cli("reconstruct", run, str(dest))
            self.assertEqual((dest / "input.mid").read_bytes(), self.source.read_bytes())
            self.assertEqual((dest / "recording.wav").read_bytes(), b"RIFF-unique-recording")
            self.assertNotEqual(self.cli("reconstruct", run, str(dest), check=False).returncode, 0)
        before = {str(p): p.read_bytes() for p in self.root.rglob("*") if p.is_file() and p.name != ".lock"}
        self.cli("recover")
        self.cli("recover")
        after = {str(p): p.read_bytes() for p in self.root.rglob("*") if p.is_file() and p.name != ".lock"}
        self.assertEqual(before, after)

    def test_changed_input_is_preserved_and_original_is_never_writable_shared(self):
        self.cli(*self.worker("(p/'input.mid').write_bytes(b'changed-source')"))
        self.assertEqual(self.source.read_bytes(), b"MThd-immutable-input")
        doc = self.documents()[0]
        evidence = self.root / "evidence" / doc["id"]
        self.assertEqual((evidence / "files/input.mid").read_bytes(), b"changed-source")

    def test_admission_refuses_peak_and_evidence_growth_before_work(self):
        result = self.cli("run", "--peak-bytes", str(33 * 1024 * 1024), "--", "false", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("budget", result.stderr)
        self.assertEqual(self.documents(), [])
        self.env["KEYSPILLI_EVIDENCE_RESERVE_BYTES"] = str(10 ** 18)
        result = self.cli(*self.worker("pass"), check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("space", result.stderr)
        self.assertEqual(self.documents(), [])

    def test_active_pinned_cancelled_and_abandoned(self):
        command = [sys.executable, str(SCRIPT), "--root", str(self.root),
                   *self.worker("(p/'ready').touch(); time=__import__('time'); time.sleep(30)")]
        proc = subprocess.Popen(command, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(lambda: proc.kill() if proc.poll() is None else None)
        deadline = time.monotonic() + 5
        while not list(self.root.glob("scratch/*/ready")) and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(list(self.root.glob("scratch/*/ready")))
        run = self.documents()[0]["id"]
        self.cli("recover")
        self.assertTrue((self.root / "scratch" / run).exists())
        self.assertNotEqual(self.cli("finish", run, check=False).returncode, 0)
        self.assertTrue((self.root / "scratch" / run).exists())
        self.assertNotEqual(self.cli(*self.worker("pass"), check=False).returncode, 0)
        proc.send_signal(signal.SIGTERM)
        proc.communicate(timeout=5)
        self.assertEqual(proc.returncode, 143)
        self.assertFalse((self.root / "scratch" / run).exists())
        begin = json.loads(self.cli("begin", "--peak-bytes", "1048576", "--owner-pid", str(self.dead_pid)).stdout)
        run = begin["id"]
        scratch = self.root / "scratch" / run
        (scratch / "diagnostic.txt").write_text("crash result")
        self.cli("pin", run, "current candidate")
        self.cli("recover")
        self.assertTrue(scratch.exists())
        self.cli("unpin", run)
        self.cli("recover")
        self.assertFalse(scratch.exists())
        self.assertEqual((self.root / "evidence" / run / "files/diagnostic.txt").read_text(), "crash result")

    def test_tampered_reference_and_unowned_paths_are_never_deleted(self):
        begin = json.loads(self.cli("begin", "--peak-bytes", "1048576", "--owner-pid", str(self.dead_pid)).stdout)
        env = {**self.env, "KEYSPILLI_EVIDENCE_ROOT": str(self.root), "KEYSPILLI_EVIDENCE_RUN": begin["id"]}
        subprocess.run([sys.executable, str(SCRIPT), "copy", str(self.source), "input.mid"], env=env, check=True, capture_output=True)
        self.source.write_bytes(b"tampered")
        scratch = self.root / "scratch" / begin["id"]
        self.cli("recover")
        destination = self.root.parent / "recovered-input"
        self.cli("reconstruct", begin["id"], str(destination))
        self.assertEqual((destination / "input.mid").read_bytes(), b"MThd-immutable-input")
        unknown = self.root / "scratch" / "not-registered"
        unknown.mkdir()
        (unknown / "keep").write_text("unowned")
        self.cli("recover")
        self.assertTrue((unknown / "keep").exists())
        self.assertFalse(scratch.exists())

    def test_external_source_retirement_after_sealing_cannot_break_reconstruction(self):
        self.cli(*self.worker("pass"))
        self.source.unlink()
        doc = self.documents()[0]
        destination = self.root.parent / "after-retirement"
        self.cli("reconstruct", doc["id"], str(destination))
        self.assertEqual((destination / "input.mid").read_bytes(), b"MThd-immutable-input")

    def test_failed_seal_bundle_preserves_unique_bytes_and_relocates(self):
        doc = json.loads(self.cli("begin", "--peak-bytes", "1048576", "--owner-pid", str(self.dead_pid)).stdout)
        scratch = self.root / "scratch" / doc["id"]
        (scratch / "unique.wav").write_bytes(b"RIFF-unsealed")
        (scratch / "outside-link").symlink_to(self.source)
        self.assertNotEqual(self.cli("recover", check=False).returncode, 0)
        bundle = self.root.parent / "failed.tar.gz"
        self.cli("bundle", str(bundle))
        imported = self.root.parent / "imported"
        result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(imported), "import-bundle", str(bundle)], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((imported / "scratch" / doc["id"] / "unique.wav").read_bytes(), b"RIFF-unsealed")
        self.assertFalse((imported / "scratch" / doc["id"] / "outside-link").exists())
        self.assertEqual(json.loads((imported / "unsafe-bundle-entries.json").read_text())[0]["path"], f"scratch/{doc['id']}/outside-link")

    def test_relocated_sealed_bundle_reconstructs_after_original_root_is_gone(self):
        self.cli(*self.worker("pass"))
        run = self.documents()[0]["id"]
        bundle = self.root.parent / "sealed.tar.gz"
        self.cli("bundle", str(bundle))
        self.source.unlink()
        archived = self.root.with_name("original-moved")
        self.root.rename(archived)
        self.root = self.root.with_name("relocated")
        self.cli("import-bundle", str(bundle))
        destination = self.root.parent / "portable"
        self.cli("reconstruct", run, str(destination))
        self.assertEqual((destination / "input.mid").read_bytes(), b"MThd-immutable-input")
        self.assertEqual((destination / "recording.wav").read_bytes(), b"RIFF-unique-recording")

    def test_external_volume_inheritance_never_reaches_docker(self):
        doc = json.loads(self.cli("begin", "--peak-bytes", "1048576", "--owner-pid", str(self.dead_pid)).stdout)
        sentinel = self.root.parent / "unowned-resource"
        sentinel.write_text("preserve")
        fake = self.root.parent / "docker"
        fake.write_text(f"#!/usr/bin/env python3\nfrom pathlib import Path\nPath({str(sentinel)!r}).unlink()\n")
        fake.chmod(0o755)
        env = {**self.env, "KEYSPILLI_EVIDENCE_ROOT": str(self.root), "KEYSPILLI_EVIDENCE_RUN": doc["id"], "KEYSPILLI_REAL_DOCKER": str(fake)}
        for option in (["--volumes-from", "production"], ["--volumes-from=production"], ["-v", str(self.root.parent) + ":/outside"]):
            result = subprocess.run([sys.executable, str(SCRIPT.with_name("evidence-docker.py")), "run", *option, "fixture", "true"], env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(sentinel.read_text(), "preserve")

    def test_actual_playwright_teardown_hands_catalog_to_managed_sealing(self):
        repository = SCRIPT.parent.parent
        if not (repository / "node_modules/tsx").exists():
            self.skipTest("requires repository Node dependencies")
        code = "import {mkdtempSync,writeFileSync,existsSync} from 'node:fs'; import {tmpdir} from 'node:os'; import {join} from 'node:path'; "
        code += f"import {{createRequire}} from 'node:module'; const teardown=createRequire(import.meta.url)({str(repository / 'apps/web/e2e/scratch-global-teardown.ts')!r}).default; "
        code += "const root=mkdtempSync(join(tmpdir(),'keyspilli-web-e2e-')); process.env.KEYSPILLI_E2E_SCRATCH_DIR=root; writeFileSync(join(root,'db.sqlite'),'unique-test-db'); teardown(); if(!existsSync(join(root,'db.sqlite'))) throw Error('teardown erased evidence');"
        self.cli("run", "--peak-bytes", "1048576", "--", self.env.get("KEYSPILLI_TEST_NODE", "node"), "--import", "tsx", "--input-type=module", "-e", code)
        run = self.documents()[0]["id"]
        databases = list((self.root / "evidence" / run / "files").glob("*/db.sqlite"))
        self.assertEqual(len(databases), 1)
        self.assertEqual(databases[0].read_text(), "unique-test-db")

    def test_actual_upload_evaluator_keeps_its_generated_database(self):
        repository = SCRIPT.parent.parent
        if not (repository / "node_modules/tsx").exists():
            self.skipTest("requires repository Node dependencies")
        self.env["KEYSPILLI_EVIDENCE_LIMIT_BYTES"] = str(128 * 1024 ** 2)
        code = "import {writeFileSync} from 'node:fs'; import {join} from 'node:path'; import {execFileSync} from 'node:child_process'; "
        code += f"import {{writeMidi}} from {str(repository / 'packages/midi/src/index.ts')!r}; "
        code += "const notes=Array.from({length:16},(_,i)=>[{midi:60+i%5,start:i*2,dur:1,vel:80,hand:'R'},{midi:48,start:i*2,dur:2,vel:65,hand:'L'},{midi:52,start:i*2,dur:2,vel:65,hand:'L'},{midi:55,start:i*2,dur:2,vel:65,hand:'L'}]).flat(); const source=join(process.env.KEYSPILLI_SCRATCH,'source.mid'); writeFileSync(source,writeMidi(notes,{tempoBpm:120,timeSig:[4,4]})); "
        code += f"execFileSync(process.execPath,['--import','tsx',{str(repository / 'apps/web/scripts/evaluate-upload-chords.mts')!r},source],{{stdio:'inherit'}});"
        self.cli("run", "--peak-bytes", str(64 * 1024 ** 2), "--", self.env.get("KEYSPILLI_TEST_NODE", "node"), "--import", "tsx", "--input-type=module", "-e", code)
        run = self.documents()[0]["id"]
        databases = list((self.root / "evidence" / run / "files").glob("keyspilli-upload-eval-*/db.sqlite"))
        self.assertEqual(len(databases), 1)
        with contextlib.closing(sqlite3.connect(databases[0])) as connection:
            self.assertGreater(connection.execute("select count(*) from songs").fetchone()[0], 0)

    def module(self):
        spec = importlib.util.spec_from_file_location("evidence_test_subject", SCRIPT)
        if spec is None or spec.loader is None:
            raise RuntimeError("test subject unavailable")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_every_recovery_reference_root_protects_its_image(self):
        module = self.module()
        store = module.Store(self.root)
        state, backups = self.root.parent / "state", self.root.parent / "backups"
        image = "sha256:" + "a" * 64
        paths = [state / "current.json", state / "deployment.json", backups / "backup-manifest-one.json",
                 backups / ".keyspilli-offhost-hold/backup-manifest-one.json", self.root / "scratch/run/backup-manifest-one.json",
                 self.root / "evidence/run/files/backup-manifest-one.json"]
        with mock.patch.dict(os.environ, {"KEYSPILLI_BACKUP_DIR": str(backups), "KEYSPILLI_STORAGE_STATE_DIR": str(state)}):
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps({"images": {"web": {"id": image}}}))
                self.assertEqual(store.image_pins(image), str(path))
                path.unlink()

    def test_invalid_known_recovery_records_never_mean_no_pin(self):
        module = self.module()
        store = module.Store(self.root)
        doc = store.begin(1048576, self.dead_pid)
        run = doc["id"]
        image = "sha256:" + "f" * 64
        name = f"keyspilli-evidence-{run}:" + "a" * 12
        store.resource(run, "image", name)
        removed = []

        def docker(*args):
            if args[:2] == ("image", "ls"):
                return image
            if args[:2] == ("image", "inspect"):
                return json.dumps([dict(Config={"Labels": {module.LABEL: run}}, RepoTags=[name], RepoDigests=[])])
            if args[:2] == ("image", "rm"):
                removed.append(args)
                return ""
            if args[0] == "ps":
                return ""
            raise AssertionError(args)

        state, backups = self.root.parent / "state", self.root.parent / "backups"
        current = state / "current.json"
        stamp = "2026-10-17-000001"
        filename = f"backup-manifest-{stamp}.json"
        nullable = dict(schemaVersion=1, complete=True, stamp=stamp, dbFile=f"db-{stamp}.sqlite", archiveFile=f"artifacts-{stamp}.tar.gz",
                        dbBytes=0, archiveBytes=0, dbSha256="a" * 64, archiveSha256="b" * 64, images={"web": {"id": None}, "worker": {"id": "sha256:" + "e" * 64}})
        paths = [current, state / "deployment.json", backups / filename,
                 backups / ".keyspilli-offhost-hold" / filename, self.root / "evidence/run" / filename]
        with mock.patch.object(store, "docker", docker), mock.patch.dict(os.environ, {"KEYSPILLI_BACKUP_DIR": str(backups), "KEYSPILLI_STORAGE_STATE_DIR": str(state)}):
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                for invalid in ({}, {"images": "invalid", "protectedIds": "invalid"}, {"images": ["sha256:bad"], "protectedIds": ["sha256:bad"]}, nullable):
                    path.write_text(json.dumps(invalid))
                    with self.assertRaises((ValueError, KeyError)):
                        store.finish(run, "failed")
                    self.assertEqual(removed, [])
                path.unlink()
            store.finish(run, "failed")
            self.assertEqual(len(removed), 1)

    def test_released_candidate_pin_blocks_retained_image_retry_until_unpinned(self):
        module = self.module()
        store = module.Store(self.root)
        doc = store.begin(1048576, self.dead_pid)
        run = doc["id"]
        image = "sha256:" + "f" * 64
        name = f"keyspilli-evidence-{run}:" + "a" * 12
        sentinel = self.root.parent / "image-resource"
        sentinel.write_bytes(b"owned-image")
        store.resource(run, "image", name)
        builder = f"keyspilli-evidence-{run}"
        store.resource(run, "builder", builder)
        builder_removals = []

        def docker(*args, **_options):
            if args[:2] == ("buildx", "ls"):
                return builder
            if args[:2] == ("buildx", "rm"):
                builder_removals.append(args)
                return ""
            if args[:2] == ("volume", "ls"):
                return ""
            if args[:2] == ("image", "ls"):
                return image if sentinel.exists() else ""
            if args[:2] == ("image", "inspect"):
                return json.dumps([dict(Config={"Labels": {module.LABEL: run}}, RepoTags=[name], RepoDigests=[])])
            if args[:2] == ("image", "rm"):
                sentinel.unlink()
                return ""
            if args[0] == "ps":
                return ""
            raise AssertionError(args)

        manifest = self.root / "evidence" / run / "backup-manifest-fixture.json"
        manifest.write_text(json.dumps({"images": {"web": {"id": image}}}))
        with mock.patch.object(store, "docker", docker):
            store.finish(run, "success")
            self.cli("pin", run, "current qualified candidate")
            manifest.rename(self.root.parent / "retired-reference.json")
            store.finish(run, "abandoned", recovering=True)
            self.assertEqual(sentinel.read_bytes(), b"owned-image")
            self.cli("unpin", run)
            store.finish(run, "abandoned", recovering=True)
            self.assertFalse(sentinel.exists())
            self.assertEqual(len(builder_removals), 1)
            self.assertFalse((self.root / "scratch" / run).exists())

    def test_copied_manifest_keeps_semantic_image_pins_after_seal_and_reconstruction(self):
        module = self.module()
        store = module.Store(self.root)
        doc = store.begin(1048576, self.dead_pid)
        image = "sha256:" + "e" * 64
        stamp = "2026-10-17-000003"
        source = self.root.parent / f"backup-manifest-{stamp}.json"
        source.write_text(json.dumps(dict(schemaVersion=1, complete=True, stamp=stamp, dbFile=f"db-{stamp}.sqlite", archiveFile=f"artifacts-{stamp}.tar.gz",
            dbBytes=0, archiveBytes=0, dbSha256="a" * 64, archiveSha256="b" * 64, images={"web": {"id": image}, "worker": {"id": "sha256:" + "f" * 64}})))
        store.copy(doc["id"], source, "renamed-input.json")
        self.assertIsNotNone(store.image_pins(image))
        store.finish(doc["id"], "success")
        source.unlink()
        for _ in range(2):
            self.assertIsNotNone(store.image_pins(image))
            store.finish(doc["id"], "abandoned", recovering=True)
        destination = self.root.parent / "manifest-reconstruction"
        store.reconstruct(doc["id"], destination)
        self.assertEqual(json.loads((destination / "renamed-input.json").read_text())["images"]["web"]["id"], image)

    def test_bundle_refuses_an_uncollected_external_lease_then_reconstructs_collected_bytes(self):
        module = self.module()
        store = module.Store(self.root)
        doc = store.begin(1048576, self.dead_pid)
        directory = self.root.parent / "keyspilli-plugin-smoke-export"
        directory.mkdir()
        store.register_external(doc["id"], directory)
        (directory / "unique.sqlite").write_bytes(b"unique-fixture")
        self.cli("pin", doc["id"], "candidate")
        bundle = self.root.parent / "leased.tar.gz"
        with self.assertRaises(ValueError):
            module.helper("evidence_bundle").export_bundle(store, bundle)
        self.assertFalse(bundle.exists())
        self.assertEqual((directory / "unique.sqlite").read_bytes(), b"unique-fixture")
        self.cli("unpin", doc["id"])
        store.finish(doc["id"], "recovered")
        module.helper("evidence_bundle").export_bundle(store, bundle)
        imported = module.Store(self.root.parent / "imported-lease")
        module.helper("evidence_bundle").import_bundle(imported, bundle)
        destination = self.root.parent / "reconstructed-lease"
        imported.reconstruct(doc["id"], destination)
        self.assertEqual((destination / "external-fixtures" / directory.name / "unique.sqlite").read_bytes(), b"unique-fixture")

    def test_export_capacity_is_reserved_before_admitting_a_hosted_writer(self):
        module = self.module()
        mib = 1024 ** 2
        free = [18 * mib]
        env = {"KEYSPILLI_EVIDENCE_RESERVE_BYTES": str(6 * mib), "KEYSPILLI_EVIDENCE_MAX_ENTRIES": "64"}
        with mock.patch.dict(os.environ, env), mock.patch.object(shutil, "disk_usage", lambda _: SimpleNamespace(free=free[0])):
            store = module.Store(self.root)
            with self.assertRaises(ValueError):
                store.begin(12 * mib, self.dead_pid, export_required=True)
            self.assertEqual(self.documents(), [])
            free[0] = 64 * mib
            doc = store.begin(12 * mib, self.dead_pid, export_required=True)
            scratch = self.root / "scratch" / doc["id"]
            payload = b"x" * (8 * mib)
            (scratch / "unique.bin").write_bytes(payload)
            (scratch / "unsafe").symlink_to(self.source)
            free[0] -= 8 * mib
            store.guard(doc["id"])
            with self.assertRaises(ValueError):
                store.finish(doc["id"], "failed")
            bundle = self.root.parent / "admitted.tar.gz"
            module.helper("evidence_bundle").export_bundle(store, bundle)
            with tarfile.open(bundle) as archive:
                stream = archive.extractfile(f"scratch/{doc['id']}/unique.bin")
                self.assertIsNotNone(stream)
                if stream is not None:
                    with stream:
                        self.assertEqual(stream.read(), payload)

    def test_file_budget_ignores_unowned_growth_but_keeps_peak_and_free_reserve(self):
        module = self.module()
        mib = 1024 ** 2
        free = [64 * mib]
        with mock.patch.dict(os.environ, {"KEYSPILLI_EVIDENCE_RESERVE_BYTES": str(6 * mib)}), mock.patch.object(shutil, "disk_usage", lambda _: SimpleNamespace(free=free[0])):
            store = module.Store(self.root)
            doc = store.begin(mib, self.dead_pid)
            free[0] = 20 * mib
            store.guard(doc["id"])
            output = self.root / "scratch" / doc["id"] / "unique.bin"
            output.write_bytes(b"x" * (2 * mib))
            with self.assertRaises(ValueError):
                store.guard(doc["id"])
            output.unlink()
            free[0] = 5 * mib
            with self.assertRaises(ValueError):
                store.guard(doc["id"])

    def test_live_accounting_tolerates_unlinked_chromium_temps_but_not_inspection_errors(self):
        module = self.module()
        store = module.Store(self.root)
        doc = store.begin(1048576, self.dead_pid)
        scratch = self.root / "scratch" / doc["id"]
        stable = scratch / "recording.wav"
        stable.write_bytes(b"unique-recording")
        transient = scratch / ".org.chromium.Chromium.transient"
        transient.mkdir()
        lstat = Path.lstat

        def disappearing(path, *args, **kwargs):
            if path == transient:
                transient.rmdir()
            return lstat(path, *args, **kwargs)

        with mock.patch.object(Path, "lstat", disappearing):
            store.guard(doc["id"])
        self.assertEqual(stable.read_bytes(), b"unique-recording")

        def inaccessible(path, *args, **kwargs):
            if path == stable:
                raise PermissionError("injected inspection failure")
            return lstat(path, *args, **kwargs)

        with mock.patch.object(Path, "lstat", inaccessible), self.assertRaises(PermissionError):
            store.guard(doc["id"])
        with mock.patch.object(os, "scandir", side_effect=PermissionError("injected directory inspection failure")):
            with self.assertRaises(PermissionError):
                store.guard(doc["id"])
            with self.assertRaises(PermissionError):
                module.files(scratch)
        store.finish(doc["id"], "success")
        self.assertEqual((self.root / "evidence" / doc["id"] / "files/recording.wav").read_bytes(), b"unique-recording")

    def test_actual_plugin_fixture_closes_its_lease_before_teardown(self):
        checker_path = SCRIPT.parents[1] / "scripts/check-keyspilli-plugin.py"
        if not checker_path.exists():
            self.skipTest("plugin checker absent from code-only native fixture")
        spec = importlib.util.spec_from_file_location("plugin_fixture_test", checker_path)
        if spec is None or spec.loader is None:
            raise RuntimeError("plugin checker missing")
        checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(checker)
        store = self.module().Store(self.root)
        doc = store.begin(1048576, self.dead_pid)
        env = {**self.env, **store.environment(doc["id"])}
        errors = []
        unlink = os.unlink
        execute = subprocess.run

        def lifecycle_command(argv, **kwargs):
            self.assertEqual(kwargs["env"].get("KEYSPILLI_REAL_DOCKER"), env["KEYSPILLI_REAL_DOCKER"])
            return execute(argv, **kwargs)

        def sample_after_marker_removal(path, *args, **kwargs):
            result = unlink(path, *args, **kwargs)
            if Path(path).name == ".keyspilli-evidence-owner.json":
                try:
                    store.guard(doc["id"])
                except OSError as error:
                    errors.append(type(error).__name__)
            return result

        with mock.patch.dict(os.environ, env), mock.patch.object(os, "unlink", sample_after_marker_removal), mock.patch.object(subprocess, "run", lifecycle_command):
            with checker.smoke_directory(SCRIPT.parents[1]) as directory:
                (directory / "synthetic.mid").write_bytes(b"unique-synthetic-control")
        self.assertEqual(errors, [])
        self.assertFalse(directory.exists())
        moved = self.root / "scratch" / doc["id"] / "external-fixtures" / directory.name
        self.assertEqual((moved / "synthetic.mid").read_bytes(), b"unique-synthetic-control")
        store.finish(doc["id"], "success")
        retained = self.root / "evidence" / doc["id"] / "files/external-fixtures" / directory.name
        self.assertEqual((retained / "synthetic.mid").read_bytes(), b"unique-synthetic-control")

        other = store.begin(1048576, self.dead_pid)
        env["KEYSPILLI_EVIDENCE_RUN"] = other["id"]
        refused: Path | None = None
        marker: Path | None = None
        identity: bytes | None = None
        with mock.patch.dict(os.environ, env), self.assertRaises(subprocess.CalledProcessError):
            with checker.smoke_directory(SCRIPT.parents[1]) as refusing_dir:
                refused = Path(refusing_dir)
                marker = refused / ".keyspilli-evidence-owner.json"
                identity = marker.read_bytes()
                marker.unlink()
                (refused / "result.sqlite").write_bytes(b"preserve-refused")
        assert refused is not None and marker is not None and identity is not None
        self.assertEqual((refused / "result.sqlite").read_bytes(), b"preserve-refused")
        marker.write_bytes(identity)
        store.finish(other["id"], "recovered")
        rejected = []

        def registration_failure(argv, **_kwargs):
            rejected.append(Path(argv[-1]))
            raise ValueError("injected registration failure before writes")

        with mock.patch.dict(os.environ, env), mock.patch.object(subprocess, "run", registration_failure), self.assertRaises(ValueError):
            with checker.smoke_directory(SCRIPT.parents[1]):
                self.fail("registration failure must not start fixture writes")
        self.assertEqual(len(rejected), 1)
        self.assertFalse(rejected[0].exists())

    def test_successful_builds_release_only_their_owned_builder_cache(self):
        fake = self.root.parent / "cache-docker"
        audit = self.root.parent / "docker-audit.jsonl"
        fake.write_text("#!" + sys.executable + "\n" + r'''
import json, os, pathlib, sys
args = sys.argv[1:]
root = pathlib.Path(os.environ["KEYSPILLI_SCRATCH"])
cache = root / "simulated-build-cache"
name = "keyspilli-evidence-" + os.environ["KEYSPILLI_EVIDENCE_RUN"]
with pathlib.Path(os.environ["FIXTURE_AUDIT"]).open("a") as log:
    log.write(json.dumps(args) + "\n")
if args[0] == "info":
    print("fixture-daemon")
elif args[:2] == ["buildx", "create"]:
    pass
elif args[:2] == ["buildx", "build"]:
    if cache.exists():
        sys.exit("previous build cache overlaps the next image build")
    cache.write_bytes(b"cache" * 1024)
    print("retained-build-result")
    if os.environ.get("FIXTURE_BUILD_FAILURE") == "1":
        sys.exit(17)
elif args[0] == "ps":
    print("a" * 64)
elif args[0] == "inspect":
    print(json.dumps([dict(Id="a" * 64, Name="/foreign" if os.environ.get("FIXTURE_FOREIGN") else "/buildx_buildkit_" + name + "0",
        Mounts=[dict(Type="volume", Name="buildx_buildkit_" + name + "0_state")])]))
elif args[:2] == ["buildx", "prune"]:
    assert args == ["buildx", "prune", "--builder", name, "--all", "--force"]
    assert pathlib.Path(os.environ["BUILDX_CONFIG"]) == root / "buildx-config"
    if os.environ.get("FIXTURE_PRUNE_FAILURE"):
        sys.exit(19)
    cache.unlink()
    print("retained-cache-release-result")
else:
    sys.exit("unexpected fixture operation: " + repr(args))
''')
        fake.chmod(0o700)
        self.env.update(KEYSPILLI_REAL_DOCKER=str(fake), FIXTURE_AUDIT=str(audit),
                        KEYSPILLI_EVIDENCE_LIMIT_BYTES=str(2 * 1024 ** 3))
        doc = json.loads(self.cli("begin", "--peak-bytes", str(1024 ** 3),
                                  "--owner-pid", str(self.dead_pid)).stdout)
        env = {**self.env, "KEYSPILLI_EVIDENCE_ROOT": str(self.root), "KEYSPILLI_EVIDENCE_RUN": doc["id"]}
        configured = json.loads(subprocess.check_output([sys.executable, str(SCRIPT), "environment"], env=env, text=True))
        env.update(configured)
        command = [str(SCRIPT.with_name("evidence-docker.py")), "build", "-t", "keyspilli-test:fixture", "."]
        for _ in range(2):
            result = subprocess.run([sys.executable, *command], env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertFalse((Path(configured["KEYSPILLI_SCRATCH"]) / "simulated-build-cache").exists())
        calls = [json.loads(line) for line in audit.read_text().splitlines()]
        self.assertEqual(sum(row[:2] == ["buildx", "create"] for row in calls), 1)
        self.assertEqual(sum(row[:2] == ["buildx", "prune"] for row in calls), 2)
        self.assertFalse(any(row[:2] == ["image", "rm"] for row in calls))
        records = self.documents()[0]
        self.assertEqual(sum(row["kind"] == "image" for row in records["resources"]), 2)
        logs = "".join(p.read_text() for p in (self.root / "evidence" / doc["id"]).glob("docker-*.log"))
        self.assertIn("retained-build-result", logs)
        self.assertIn("retained-cache-release-result", logs)
        audit.write_text("")
        result = subprocess.run([sys.executable, *command], env={**env, "FIXTURE_BUILD_FAILURE": "1"},
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 17, result.stdout + result.stderr)
        self.assertFalse(any(json.loads(row)[:2] == ["buildx", "prune"] for row in audit.read_text().splitlines()))
        cache = Path(configured["KEYSPILLI_SCRATCH"]) / "simulated-build-cache"
        cache.unlink()
        audit.write_text("")
        result = subprocess.run([sys.executable, *command], env={**env, "FIXTURE_FOREIGN": "1"},
                                capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("foreign or replaced", result.stderr)
        self.assertFalse(any(json.loads(row)[:2] == ["buildx", "prune"] for row in audit.read_text().splitlines()))
        cache.unlink()
        result = subprocess.run([sys.executable, *command], env={**env, "FIXTURE_PRUNE_FAILURE": "1"},
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 19, result.stdout + result.stderr)
        self.assertTrue(cache.exists())
        measurements = [json.loads(p.read_text()) for p in (self.root / "evidence" / doc["id"]).glob("builder-cache-*.json")]
        self.assertEqual(sorted(row["exitCode"] for row in measurements), [0, 0, 19])
        self.assertTrue(all(row["availableBefore"] > 0 and row["availableAfter"] > 0 for row in measurements))

    def test_private_builder_config_survives_a_different_finalizer_home(self):
        docker_peak = 1024 ** 3
        self.env["KEYSPILLI_EVIDENCE_LIMIT_BYTES"] = str(2 * docker_peak)
        fake = self.root.parent / "fake-docker"
        fake.write_text('#!' + sys.executable + '\n' +
            'import os,pathlib,sys\n'
            'args=sys.argv[1:]\n'
            f'record=pathlib.Path({str(self.root.parent / "builder-state")!r})\n'
            'if args[0]=="info": print("fixture-daemon")\n'
            'elif args[:2]==["buildx","create"]:\n'
            ' p=pathlib.Path(os.environ["BUILDX_CONFIG"]); p.mkdir(parents=True); (p/"builder").write_text(args[args.index("--name")+1]); record.write_text(args[args.index("--name")+1])\n'
            'elif args[:2]==["buildx","build"]: print("build-result")\n'
            'elif args[0]=="ps": print("a"*64) if record.exists() else None\n'
            'elif args[0]=="inspect":\n'
            ' import json; n=record.read_text(); print(json.dumps([dict(Id="a"*64,Name="/buildx_buildkit_"+n+"0",Mounts=[dict(Type="volume",Name="buildx_buildkit_"+n+"0_state")])]))\n'
            'elif args[:2]==["buildx","ls"]: print((pathlib.Path(os.environ["BUILDX_CONFIG"])/"builder").read_text())\n'
            'elif args[:2]==["buildx","rm"]: (pathlib.Path(os.environ["BUILDX_CONFIG"])/"builder").unlink(); record.unlink()\n')
        fake.chmod(0o700)
        self.env["KEYSPILLI_REAL_DOCKER"] = str(fake)
        code = 'import subprocess; subprocess.run(["docker","build","-t","keyspilli-test:fixture","."],check=True)'
        doc = json.loads(self.cli("begin", "--peak-bytes", str(docker_peak), "--owner-pid", str(self.dead_pid)).stdout)
        env = {**self.env, "KEYSPILLI_EVIDENCE_ROOT": str(self.root), "KEYSPILLI_EVIDENCE_RUN": doc["id"]}
        configured = json.loads(subprocess.check_output([sys.executable, str(SCRIPT), "environment"], env=env, text=True))
        result = subprocess.run([sys.executable, "-c", code], env={**env, **configured}, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.env["HOME"] = str(self.root.parent / "different-finalizer-home")
        self.cli("finish", doc["id"])
        self.assertFalse((self.root / "scratch" / doc["id"]).exists())
        self.assertIn("build-result", "".join(p.read_text() for p in (self.root / "evidence" / doc["id"]).glob("docker-*.log")))

    def test_builder_teardown_converges_only_for_its_recorded_container(self):
        module = self.module()
        for scenario in ("delayed", "foreign", "replaced", "unmounted-first", "unmounted-recorded"):
            with self.subTest(scenario=scenario):
                store = module.Store(self.root / scenario)
                doc = store.begin(1048576, self.dead_pid)
                name = f"keyspilli-evidence-{doc['id']}"
                volume = "buildx_buildkit_" + name + "0_state"
                store.resource(doc["id"], "builder", name)
                state = dict(removed=False, polls=0, volumeRemoved=False)
                if scenario == "unmounted-recorded":
                    path, recorded = store.path(doc["id"])
                    recorded["builderContainers"] = {name: ["a" * 64]}
                    module.save(path, recorded)

                def docker(*args, **_options):
                    if args[0] == "ps":
                        if scenario.startswith("unmounted"):
                            return "b" * 64 if args[-1].startswith("name=") else ""
                        if state["removed"]:
                            state["polls"] += 1
                            if scenario == "replaced":
                                return "b" * 64
                            if state["polls"] > 2:
                                return ""
                        return "a" * 64
                    if args[0] == "inspect":
                        return json.dumps([dict(Id=args[1], Name="/foreign" if scenario == "foreign" else "/buildx_buildkit_" + name + "0",
                                                Mounts=[] if scenario.startswith("unmounted") else [dict(Type="volume", Name=volume)])])
                    if args[:2] == ("buildx", "ls"):
                        return name
                    if args[:2] == ("buildx", "rm"):
                        state["removed"] = True
                        return ""
                    if args[:2] == ("volume", "ls"):
                        return volume
                    if args[:2] == ("volume", "rm"):
                        state["volumeRemoved"] = True
                        return ""
                    raise AssertionError(args)

                with mock.patch.object(store, "docker", docker):
                    if scenario == "delayed":
                        store.cleanup_resources(store.path(doc["id"])[1])
                        self.assertTrue(state["volumeRemoved"])
                        self.assertEqual(store.path(doc["id"])[1]["builderContainers"][name], ["a" * 64])
                    else:
                        with self.assertRaises(ValueError):
                            store.cleanup_resources(store.path(doc["id"])[1])
                        self.assertFalse(state["volumeRemoved"])
                        if scenario == "foreign" or scenario.startswith("unmounted"):
                            self.assertFalse(state["removed"])

    def test_checkout_fixture_lease_recovers_only_its_exact_directory(self):
        store = self.module().Store(self.root)
        doc = store.begin(1048576, self.dead_pid)
        directory = self.root.parent / "keyspilli-plugin-smoke-owned"
        directory.mkdir()
        store.register_external(doc["id"], directory)
        (directory / "result.sqlite").write_bytes(b"unique-crash-result")
        self.cli("pin", doc["id"], "active candidate")
        with self.assertRaises(ValueError):
            store.collect_external(doc["id"], directory)
        store.finish(doc["id"], "abandoned", recovering=True)
        self.assertTrue(directory.exists())
        self.cli("unpin", doc["id"])
        store.finish(doc["id"], "abandoned", recovering=True)
        self.assertFalse(directory.exists())
        self.assertEqual((self.root / "evidence" / doc["id"] / "files/external-fixtures" / directory.name / "result.sqlite").read_bytes(), b"unique-crash-result")
        store.finish(doc["id"], "abandoned", recovering=True)

        other = store.begin(1048576, self.dead_pid)
        directory.mkdir()
        store.register_external(other["id"], directory)
        original = directory.with_name(directory.name + "-moved")
        directory.rename(original)
        directory.mkdir()
        (directory / "unowned").write_bytes(b"preserve")
        with self.assertRaises(ValueError):
            store.finish(other["id"], "abandoned", recovering=True)
        self.assertEqual((directory / "unowned").read_bytes(), b"preserve")
        shutil.rmtree(directory)
        original.rename(directory)
        shutil.rmtree(directory)
        store.finish(other["id"], "success")

    def test_atomic_lease_collection_and_repeated_calls_preserve_bytes(self):
        store = self.module().Store(self.root)
        doc = store.begin(1048576, self.dead_pid)
        directory = self.root.parent / "keyspilli-plugin-smoke-atomic"
        directory.mkdir()
        store.register_external(doc["id"], directory)
        (directory / "control.mid").write_bytes(b"control-bytes")
        rename = os.rename
        samples = []

        def moved(source, destination):
            result = rename(source, destination)
            if Path(source) == directory:
                store.guard(doc["id"])
                samples.append("old lease absent, complete directory inside scratch")
            return result

        with mock.patch.object(os, "rename", moved):
            store.collect_external(doc["id"], directory)
        self.assertEqual(len(samples), 1)
        store.collect_external(doc["id"], directory)
        store.finish(doc["id"], "success")
        store.collect_external(doc["id"], directory)
        self.assertFalse(directory.exists())
        self.assertEqual((self.root / "evidence" / doc["id"] / "files/external-fixtures" / directory.name / "control.mid").read_bytes(), b"control-bytes")

    def test_job_shell_supervises_steps_and_retains_failure_and_budget_results(self):
        doc = json.loads(self.cli("begin", "--peak-bytes", "1048576", "--owner-pid", str(self.dead_pid)).stdout)
        env = {**self.env, "KEYSPILLI_EVIDENCE_ROOT": str(self.root), "KEYSPILLI_EVIDENCE_RUN": doc["id"],
               "KEYSPILLI_SCRATCH": str(self.root / "scratch" / doc["id"])}
        script = self.root.parent / "step.sh"
        script.write_text('echo raw-step-result\nexit 17\n')
        result = subprocess.run([sys.executable, str(SCRIPT.with_name("evidence-step.py")), str(script)], env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 17, result.stdout + result.stderr)
        self.assertIn("raw-step-result", result.stdout)
        script.write_text('"' + sys.executable + '" -c \'import os,pathlib,time; (pathlib.Path(os.environ["KEYSPILLI_SCRATCH"])/"large.bin").write_bytes(b"x"*2097152); time.sleep(20)\'\n')
        result = subprocess.run([sys.executable, str(SCRIPT.with_name("evidence-step.py")), str(script)], env=env, capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.cli("finish", doc["id"])
        evidence = self.root / "evidence" / doc["id"]
        self.assertEqual((evidence / "files/large.bin").stat().st_size, 2097152)
        self.assertEqual(len(list(evidence.glob("script-*.sh"))), 2)

    def test_final_container_logs_and_state_are_synced_before_removal(self):
        module = self.module()
        store = module.Store(self.root)
        doc = store.begin(1048576, self.dead_pid)
        run = doc["id"]
        name = f"keyspilli-evidence-{run}-" + "a" * 8
        store.resource(run, "container", name)
        events = []
        sync = os.fsync
        replace = os.replace

        def fsync(fd):
            events.append(("synced", os.fstat(fd).st_ino))
            sync(fd)

        def publish(source, destination):
            self.assertIn(("synced", Path(source).stat().st_ino), events)
            replace(source, destination)
            events.append(Path(destination).name)

        def docker(*args):
            if args[0] == "ps":
                return "exact-owned-id"
            if args[0] == "inspect":
                return json.dumps({"Running": False}) if "--format" in args else json.dumps([dict(Config={"Labels": {module.LABEL: run}})])
            if args[0] == "stop":
                return ""
            if args[0] == "rm":
                for suffix in (".stdout", ".stderr", "-state.json"):
                    event = f"container-{name}{suffix}"
                    self.assertIn(event, events)
                    self.assertIn(("synced", (self.root / "evidence" / run).stat().st_ino), events[events.index(event) + 1:])
                events.append("removed")
                return ""
            raise AssertionError(args)

        with mock.patch.object(store, "docker", docker), mock.patch.object(subprocess, "run", return_value=SimpleNamespace(stdout=b"out", stderr=b"err")), mock.patch.object(os, "fsync", fsync), mock.patch.object(os, "replace", publish):
            store.cleanup_resources(store.path(run)[1])
        self.assertIn("removed", events)

    def test_competing_admission_cannot_cross_the_real_lock(self):
        store = self.module().Store(self.root)
        with store.lock():
            result = self.cli("begin", "--peak-bytes", "1048576", "--owner-pid", str(self.dead_pid), check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.documents(), [])

    def test_unowned_resource_record_cannot_trigger_cleanup(self):
        doc = json.loads(self.cli("begin", "--peak-bytes", "1048576", "--owner-pid", str(self.dead_pid)).stdout)
        scratch = self.root / "scratch" / doc["id"]
        (scratch / "result").write_text("preserve")
        doc["resources"] = [{"kind": "builder", "name": "another-workers-builder"}]
        (self.root / "runs" / doc["id"] / "run.json").write_text(json.dumps(doc))
        result = self.cli("recover", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((scratch / "result").read_text(), "preserve")

    def test_interrupted_sealing_retries_the_durable_map_without_losing_moved_files(self):
        module = self.module()
        store = module.Store(self.root)
        doc = store.begin(1048576, self.dead_pid)
        scratch = self.root / "scratch" / doc["id"]
        (scratch / "a.wav").write_bytes(b"first-recording")
        (scratch / "b.sqlite").write_bytes(b"second-database")
        rename = os.rename

        def interrupted(source, destination):
            if Path(source).name == "b.sqlite":
                raise OSError("injected filesystem interruption")
            return rename(source, destination)

        with mock.patch.object(os, "rename", interrupted), self.assertRaises(OSError):
            store.finish(doc["id"], "failed")
        self.assertEqual((self.root / "evidence" / doc["id"] / "files/a.wav").read_bytes(), b"first-recording")
        self.assertEqual((scratch / "b.sqlite").read_bytes(), b"second-database")
        store.finish(doc["id"], "recovered")
        destination = self.root.parent / "after-interruption"
        store.reconstruct(doc["id"], destination)
        self.assertEqual((destination / "a.wav").read_bytes(), b"first-recording")
        self.assertEqual((destination / "b.sqlite").read_bytes(), b"second-database")

    def test_killed_supervisor_recovers_its_verified_child_and_keeps_results(self):
        command = [sys.executable, str(SCRIPT), "--root", str(self.root), *self.worker("(p/'ready').touch(); __import__('time').sleep(30)")]
        proc = subprocess.Popen(command, env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 5
        while not list(self.root.glob("scratch/*/ready")) and time.monotonic() < deadline:
            time.sleep(.02)
        self.assertTrue(list(self.root.glob("scratch/*/ready")))
        run = self.documents()[0]["id"]
        proc.kill()
        proc.communicate(timeout=5)
        self.cli("recover")
        self.assertFalse((self.root / "scratch" / run).exists())
        self.assertEqual((self.root / "evidence" / run / "files/recording.wav").read_bytes(), b"RIFF-unique-recording")

    def test_interrupted_input_acquisition_keeps_partial_bytes_and_original(self):
        module = self.module()
        store = module.Store(self.root)
        doc = store.begin(1048576, self.dead_pid)

        def interrupted(source, destination):
            destination.write(source.read(4))
            raise OSError("injected acquisition interruption")

        with mock.patch.object(shutil, "copyfileobj", interrupted), self.assertRaises(OSError):
            store.copy(doc["id"], self.source, "input.mid")
        store.finish(doc["id"], "failed")
        partials = list((self.root / "evidence" / doc["id"] / "files/incomplete-inputs").iterdir())
        self.assertEqual(len(partials), 1)
        self.assertEqual(partials[0].read_bytes(), b"MThd")
        self.assertFalse(list((self.root / "inputs").glob("*.partial")))
        self.assertEqual(self.source.read_bytes(), b"MThd-immutable-input")

    def test_cleanup_refuses_symlinks_and_retries_without_losing_results(self):
        doc = json.loads(self.cli("begin", "--peak-bytes", "1048576", "--owner-pid", str(self.dead_pid)).stdout)
        scratch = self.root / "scratch" / doc["id"]
        (scratch / "result.txt").write_text("unique")
        (scratch / "unsafe").symlink_to(self.source)
        result = self.cli("recover", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(scratch.exists())
        self.assertEqual(self.source.read_bytes(), b"MThd-immutable-input")
        (scratch / "unsafe").unlink()
        self.cli("recover")
        self.assertEqual((self.root / "evidence" / doc["id"] / "files/result.txt").read_text(), "unique")

    def test_live_process_using_abandoned_scratch_blocks_cleanup(self):
        if not sys.platform.startswith("linux"):
            self.skipTest("native /proc active-use check")
        doc = json.loads(self.cli("begin", "--peak-bytes", "1048576", "--owner-pid", str(self.dead_pid)).stdout)
        scratch = self.root / "scratch" / doc["id"]
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], cwd=scratch)
        try:
            self.assertNotEqual(self.cli("recover", check=False).returncode, 0)
            self.assertTrue(scratch.exists())
        finally:
            child.terminate()
            child.wait(timeout=5)
        self.cli("recover")
        self.assertFalse(scratch.exists())

    def test_peak_overrun_stops_the_writer_and_preserves_its_output(self):
        code = "import os,pathlib,time; p=pathlib.Path(os.environ['KEYSPILLI_SCRATCH']); (p/'large').write_bytes(b'x'*2097152); time.sleep(20)"
        result = self.cli("run", "--peak-bytes", "1048576", "--", sys.executable, "-c", code, check=False)
        self.assertNotEqual(result.returncode, 0)
        doc = self.documents()[0]
        self.assertFalse((self.root / "scratch" / doc["id"]).exists())
        self.assertEqual((self.root / "evidence" / doc["id"] / "files/large").stat().st_size, 2097152)

    def test_ephemeral_restore_reuses_archive_and_preserves_database_and_report(self):
        self.env["KEYSPILLI_EVIDENCE_LIMIT_BYTES"] = str(512 * 1024 ** 2)
        stamp = "2026-10-17-000001"
        backups = self.root.parent / "backups"
        backups.mkdir()
        db = backups / f"db-{stamp}.sqlite"
        with contextlib.closing(sqlite3.connect(db)) as connection:
            connection.execute("create table unique_result (value text)")
            connection.commit()
        archive = backups / f"artifacts-{stamp}.tar.gz"
        with tarfile.open(archive, "w:gz") as stream:
            stream.add(self.source, arcname="seed-midi/source.mid")
        manifest = backups / f"backup-manifest-{stamp}.json"
        manifest.write_text(json.dumps(dict(complete=True, stamp=stamp, dbFile=db.name, archiveFile=archive.name,
            dbSha256=hashlib.sha256(db.read_bytes()).hexdigest(), archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest())))
        result = subprocess.run(["bash", str(SCRIPT.with_name("restore-drill.sh")), "--ephemeral", str(manifest)],
            env={**self.env, "KEYSPILLI_EVIDENCE_ROOT": str(self.root)}, capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        doc = self.documents()[0]
        evidence = self.root / "evidence" / doc["id"]
        self.assertFalse((self.root / "scratch" / doc["id"]).exists())
        self.assertTrue((evidence / "files/restored/runtime/db.sqlite").exists())
        self.assertFalse((evidence / "files/restored" / archive.name).exists())
        self.assertEqual(json.loads((evidence / "files/restored/restore-report.json").read_text())["archiveValidation"], "passed")
        dest = self.root.parent / "reconstructed"
        archive.unlink()
        db.unlink()
        manifest.unlink()
        self.cli("reconstruct", doc["id"], str(dest))
        self.assertEqual((dest / "restored/runtime/seed-midi/source.mid").read_bytes(), self.source.read_bytes())

    def test_cold_restore_admits_all_three_large_database_copies(self):
        self.env["KEYSPILLI_EVIDENCE_LIMIT_BYTES"] = str(1024 ** 3)
        stamp = "2026-10-17-000002"
        backups = self.root.parent / "large-backup"
        backups.mkdir()
        db = backups / f"db-{stamp}.sqlite"
        with contextlib.closing(sqlite3.connect(db)) as connection:
            connection.execute("create table payload (value blob)")
            connection.execute("insert into payload values (zeroblob(?))", (144 * 1024 ** 2,))
            connection.commit()
        archive = backups / f"artifacts-{stamp}.tar.gz"
        with tarfile.open(archive, "w:gz") as stream:
            stream.add(self.source, arcname="seed-midi/source.mid")
        module = self.module()
        manifest = backups / f"backup-manifest-{stamp}.json"
        manifest.write_text(json.dumps(dict(complete=True, stamp=stamp, dbFile=db.name, archiveFile=archive.name,
            dbSha256=module.digest(db), archiveSha256=module.digest(archive))))
        result = subprocess.run(["bash", str(SCRIPT.with_name("restore-drill.sh")), "--ephemeral", str(manifest)],
            env={**self.env, "KEYSPILLI_EVIDENCE_ROOT": str(self.root)}, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        doc = self.documents()[0]
        evidence = self.root / "evidence" / doc["id"] / "files/restored"
        for path in (evidence / db.name, evidence / "runtime/db.sqlite"):
            with contextlib.closing(sqlite3.connect(path)) as connection:
                self.assertEqual(connection.execute("select length(value) from payload").fetchone()[0], 144 * 1024 ** 2)
        self.assertFalse((self.root / "scratch" / doc["id"]).exists())


if __name__ == "__main__":
    unittest.main()
