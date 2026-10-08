#!/usr/bin/env python3
"""Keyspilli-only retention and admission. No prune, force, or layer-store writes.

All host writers use the original backup flock. A deployment record bridges
Ansible's separate SSH tasks; abandoned records never expire automatically.
"""
import argparse
import contextlib
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import tarfile
import time
import uuid

GIB = 1024 ** 3
STAMP = re.compile(r"\d{4}-\d{2}-\d{2}-\d{6}")
ID = re.compile(r"sha256:[a-f0-9]{64}")
SOURCE = "https://github.com/Reedtrullz/Keyspilli"
REPOS = {"ghcr.io/reedtrullz/keyspilli", "ghcr.io/reedtrullz/keyspilli-worker"}
ROLLBACK = ("keyspilli:rollback", "keyspilli-worker:rollback")


def emit(event, **fields):
    print(json.dumps({"event": event, **fields}, sort_keys=True), flush=True)


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def regular(path):
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode):
        raise ValueError(f"not a regular file: {path}")
    return s


def identity(path):
    s = regular(path)
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_nlink)


def manifest_document(path):
    if regular(path).st_size > 32768:
        raise ValueError("oversized manifest")
    d = json.loads(path.read_text())
    if not isinstance(d, dict):
        raise ValueError("invalid manifest root")
    stamp = d.get("stamp")
    if (d.get("complete") is not True or type(d.get("schemaVersion")) is not int
            or d["schemaVersion"] != 1 or not isinstance(stamp, str)
            or not STAMP.fullmatch(stamp) or path.name != f"backup-manifest-{stamp}.json"):
        raise ValueError("invalid completion manifest")
    for key, name in (("db", f"db-{stamp}.sqlite"), ("archive", f"artifacts-{stamp}.tar.gz")):
        if (d.get(key + "File") != name or type(d.get(key + "Bytes")) is not int
                or not re.fullmatch(r"[a-f0-9]{64}", str(d.get(key + "Sha256", "")))):
            raise ValueError("invalid cohort names, sizes or hashes")
    return d


def verify_cohort(path):
    before = identity(path)
    d = manifest_document(path)
    if "retirement" in d:
        raise ValueError("cohort retirement pending; does not count as a recovery keeper")
    files = [path.parent / d[k + "File"] for k in ("db", "archive")]
    identities = {p: identity(p) for p in [path, *files]}
    for key, p in zip(("db", "archive"), files):
        if regular(p).st_size != d[key + "Bytes"] or sha256(p) != d[key + "Sha256"]:
            raise ValueError("cohort size/checksum mismatch")
    # Immutable mode prevents verification from creating new WAL/SHM sidecars.
    with contextlib.closing(sqlite3.connect(files[0].resolve().as_uri() + "?mode=ro&immutable=1", uri=True)) as db:
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("database integrity check failed")
    with tarfile.open(files[1], "r:gz") as archive:
        names = set()
        for member in archive:
            parts = Path(member.name).parts
            if (member.name.startswith("/") or ".." in parts or not parts
                    or parts[0].removeprefix("._") not in {"artifacts", "seed-midi", "transcribed", "uploads", "manifest.json", "learner-review.json", "review-receipts", "harmony-candidates"}
                    or not (member.isfile() or member.isdir())):
                raise ValueError("unsafe archive member")
            if parts:
                names.add(parts[0])
            if member.isfile():
                with archive.extractfile(member) as stream:
                    while stream.read(1024 * 1024):
                        pass
        if "artifacts" not in names or not names.intersection({"seed-midi", "transcribed", "uploads"}):
            raise ValueError("archive lacks artifacts or source material")
    # Read gzip to EOF too: tar may stop at its end marker before the trailer.
    with gzip.open(files[1], "rb") as stream:
        while stream.read(1024 * 1024):
            pass
    if identity(path) != before or any(identity(p) != v for p, v in identities.items()):
        raise ValueError("cohort changed during verification")
    return d, identities


def inventory_cohorts(root):
    verified, invalid = [], []
    for p in sorted(root.glob("backup-manifest-*.json"), reverse=True):
        try:
            d, identities = verify_cohort(p)
            verified.append((p, d, identities))
            emit("backup-verified", stamp=d["stamp"], bytes=d["dbBytes"] + d["archiveBytes"])
        except (OSError, ValueError, sqlite3.Error, tarfile.TarError, EOFError, KeyError, TypeError) as e:
            invalid.append(p)
            emit("preserve-backup", path=str(p), reason=str(e))
    return verified, invalid


def open_file(path):
    # Linux host safety check; fixtures on other systems use link/inode checks.
    target = regular(path)
    proc = Path("/proc")
    if not proc.exists():
        return False
    for process in proc.iterdir():
        if not process.name.isdigit():
            continue
        try:
            for fd in (process / "fd").iterdir():
                try:
                    s = fd.stat()
                    if (s.st_dev, s.st_ino) == (target.st_dev, target.st_ino):
                        return True
                except FileNotFoundError:
                    pass
        except FileNotFoundError:
            pass
        except PermissionError:
            raise RuntimeError("cannot establish backup open-file safety; run as root")
    return False


def retention(root, apply=False):
    good, invalid = inventory_cohorts(root)
    keep = good[:2]
    for _, d, _ in keep:
        emit("preserve-backup", stamp=d["stamp"], reason="two newest verified cohorts")
    # Resume only our persisted, fully verified deletion plans, and only while
    # two newer intact recovery cohorts still exist. Never expire a bad backup.
    for marker in invalid:
        try:
            d = manifest_document(marker)
        except (OSError, ValueError, KeyError, TypeError):
            continue  # unrelated ambiguous backups were already reported
        try:
            journal = d.get("retirement")
            if not journal:
                continue
            if len(keep) < 2 or d["stamp"] >= keep[-1][1]["stamp"]:
                raise RuntimeError("cannot resume retirement without two newer verified cohorts")
            expected_names = {d["dbFile"], d["archiveFile"], d["dbFile"] + "-wal", d["dbFile"] + "-shm"}
            if not isinstance(journal, dict) or not set(journal).issubset(expected_names):
                raise RuntimeError("invalid retirement journal")
            remaining = []
            for name, ident in journal.items():
                path = root / name
                if path.exists() or path.is_symlink():
                    if tuple(ident) != identity(path) or identity(path)[-1] != 1 or open_file(path):
                        raise RuntimeError("retirement member changed, linked or open")
                    remaining.append(path)
            emit("resume-backup-retirement" if apply else "would-resume-backup-retirement", stamp=d["stamp"], files=[str(p) for p in remaining])
            if apply:
                for path in remaining:
                    if identity(path) != tuple(journal[path.name]) or open_file(path):
                        raise RuntimeError("retirement member changed before unlink")
                    path.unlink()
                marker.unlink()
        except (OSError, ValueError, KeyError, TypeError) as e:
            raise RuntimeError(f"retirement recovery refused: {e}") from e
    # No expiry based on mtime. A failed new backup never counts as a keeper.
    for marker, d, identities in good[2:]:
        files = [root / d[k + "File"] for k in ("db", "archive")]
        sidecars = [Path(str(files[0]) + suffix) for suffix in ("-wal", "-shm")]
        try:
            for p in sidecars:
                if p.exists() or p.is_symlink():
                    identities[p] = identity(p)
                    if p.name.endswith("-wal") and regular(p).st_size:
                        raise ValueError("nonempty backup WAL")
                    files.append(p)
            for p, ident in identities.items():
                if identity(p) != ident or ident[-1] != 1 or open_file(p):
                    raise ValueError("changed, hardlinked or open cohort member")
            emit("delete-backup" if apply else "would-delete-backup", stamp=d["stamp"],
                 reason="older than two verified recovery cohorts", files=[str(p) for p in [*files, marker]])
            if apply:
                # Persist exact verified file identities before unlink. The
                # marker pins images until a later locked run finishes safely.
                d["retirement"] = {p.name: list(identities[p]) for p in files}
                atomic_json(marker, d)
                identities[marker] = identity(marker)
                for p in [*files, marker]:
                    if identity(p) != identities[p] or open_file(p):
                        raise RuntimeError("cohort changed before unlink")
                    p.unlink()
                emit("deleted-backup", stamp=d["stamp"], bytes=d["dbBytes"] + d["archiveBytes"])
        except (OSError, ValueError) as e:
            emit("preserve-backup", stamp=d["stamp"], reason=str(e))
            if any(not (root / d[k + "File"]).exists() for k in ("db", "archive")):
                raise RuntimeError("partial cohort deletion; remaining manifest pins recovery images") from e
    return keep, invalid


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with temp.open("w") as stream:
        json.dump(data, stream, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Policy:
    def __init__(self, backups, state, docker="docker", reserve=6 * GIB):
        self.backups, self.state, self.docker, self.reserve = Path(backups), Path(state), docker, reserve
        self.record = self.state / "deployment.json"
        self.current = self.state / "current.json"

    def run(self, *args, timeout=120):
        return subprocess.check_output([self.docker, *args], text=True, timeout=timeout).strip()

    def inspect(self, kind, ids):
        return json.loads(self.run(kind, "inspect", *ids)) if ids else []

    def images(self):
        ids = sorted(set(self.run("image", "ls", "-aq", "--no-trunc").splitlines()))
        return self.inspect("image", ids)

    def containers(self):
        ids = self.run("ps", "-aq", "--no-trunc").splitlines()
        return self.inspect("container", ids)

    def transaction(self, token=None):
        if self.record.exists():
            regular(self.record)
            record = json.loads(self.record.read_text())
            if token != record["token"]:
                raise RuntimeError("deployment pending; backups/cleanup refused; inspect deployment.json and explicitly resolve it")
            return record
        if token:
            raise RuntimeError("deployment token has no pending record")
        return None

    def protections(self, images):
        protected = {}
        def pin(i, reason):
            if not ID.fullmatch(str(i)):
                raise ValueError("unresolvable recovery image identity")
            protected.setdefault(i, []).append(reason)
        for c in self.containers():
            pin(c["Image"], "container:" + c["Name"])
        if self.current.exists():
            regular(self.current)
            for i in json.loads(self.current.read_text())["images"]:
                pin(i, "last accepted current pair")
        for image in images:
            for tag in image.get("RepoTags") or []:
                if tag in ROLLBACK:
                    pin(image["Id"], "designated rollback")
        # Include ambiguous/partially retired and replication-held manifests.
        # Malformed references stop image cleanup, never silently unpin it.
        paths = list(self.backups.glob("backup-manifest-*.json"))
        paths += list(self.backups.glob(".keyspilli-offhost-*/backup-manifest-*.json"))
        for p in paths:
            d = manifest_document(p)
            for role in ("web", "worker"):
                pin(d["images"][role]["id"], "backup:" + d["stamp"])
        if self.record.exists():
            record = json.loads(self.record.read_text())
            for i in record["protectedIds"]:
                pin(i, "in-progress deployment")
            for image in images:
                if set(image.get("RepoTags") or []).intersection(record["images"]):
                    pin(image["Id"], "in-progress deployment candidate")
                for ref, digest in zip(record["images"], record.get("digests", [])):
                    if ref.split(":")[0] + "@" + digest in (image.get("RepoDigests") or []):
                        pin(image["Id"], "in-progress deployment digest")
        return protected

    @staticmethod
    def scoped(image):
        tags = image.get("RepoTags") or []
        digests = image.get("RepoDigests") or []
        labels = image.get("Config", {}).get("Labels") or {}
        # Any unknown alias/digest is an additional operator recovery reference.
        owned = bool(tags or digests) and all(t.split(":")[0] in REPOS for t in tags) and all(t.split("@")[0] in REPOS for t in digests)
        return labels.get("org.opencontainers.image.source") == SOURCE and (owned or not tags and not digests)

    def clean_images(self, apply=False):
        images = self.images()
        pair = [c for c in self.containers() if c["Name"] in ("/keyspilli", "/keyspilli-worker")]
        if len(pair) != 2 and not self.current.exists() and not self.record.exists():
            emit("image-cleanup-blocked", reason="current pair missing and no accepted deployment record")
            return
        try:
            protected = self.protections(images)
        except (ValueError, KeyError, TypeError, OSError) as e:
            emit("image-cleanup-blocked", reason=f"ambiguous recovery reference: {e}")
            return
        for image in images:
            i = image["Id"]
            if i in protected:
                if self.scoped(image) or any(t in ROLLBACK for t in image.get("RepoTags") or []):
                    emit("preserve-image", id=i, reasons=protected[i])
                continue
            if not self.scoped(image):
                continue
            emit("delete-image" if apply else "would-delete-image", id=i, tags=image.get("RepoTags"),
                 reason="Keyspilli image with no container, rollback, backup or deployment reference")
            if apply:
                # Re-read every protection and alias before each exact removal.
                fresh = self.images()
                if i in self.protections(fresh):
                    raise RuntimeError("image gained a recovery reference")
                current = next(x for x in fresh if x["Id"] == i)
                if not self.scoped(current):
                    raise RuntimeError("image ownership/aliases changed")
                tags = current.get("RepoTags") or []
                # Docker refuses ID removal with multiple tags without force.
                # Remove exact aliases (after checking each identity), keeping
                # the final reference for the full-ID removal. Never force.
                for tag in tags[:-1]:
                    if self.inspect("image", [tag])[0]["Id"] != i:
                        raise RuntimeError("image tag moved")
                    self.run("image", "rm", "--no-prune", tag)
                self.run("image", "rm", "--no-prune", i)
                emit("deleted-image", id=i)

    def cleanup(self, apply=False, token=None):
        self.transaction(token)
        retention(self.backups, apply)
        self.clean_images(apply)

    def headroom(self, required, path):
        s = os.statvfs(path)
        free = s.f_bavail * s.f_frsize
        emit("headroom", path=str(path), freeBytes=free, operationBytes=required, reserveBytes=self.reserve,
             requiredBytes=required + self.reserve, freeInodes=s.f_favail)
        if free < required + self.reserve or s.f_favail < 10000:
            raise RuntimeError(f"insufficient disk headroom: need {required + self.reserve} bytes and 10000 free inodes; have {free} bytes/{s.f_favail} inodes")

    def backup_preflight(self, apply):
        self.cleanup(apply)
        _, invalid = inventory_cohorts(self.backups)
        if invalid:
            raise RuntimeError("unverified backup manifests remain; preserve good cohorts and resolve the reported files before creating another backup")
        for payload in self.backups.iterdir():
            match = re.fullmatch(r"(?:db-(\d{4}-\d{2}-\d{2}-\d{6})\.sqlite|artifacts-(\d{4}-\d{2}-\d{2}-\d{6})\.tar\.gz)", payload.name)
            if match and not (self.backups / f"backup-manifest-{match[1] or match[2]}.json").exists():
                raise RuntimeError(f"uncommitted backup payload {payload.name}; inspect failed publication before another backup")
        if list(self.backups.glob(".keyspilli-backup-*")):
            raise RuntimeError("unfinished backup staging exists; inspect and remove only the failed operation's staging before retrying")
        self.backup_headroom()

    def backup_headroom(self):
        worker = next(c for c in self.containers() if c["Name"] == "/keyspilli-worker")
        source = Path(next(m["Source"] for m in worker["Mounts"] if m["Destination"] == "/data"))
        # Include all source bytes, tar/gzip worst-case overhead and DB copy;
        # not the compressed size of yesterday's archive.
        raw = int(subprocess.check_output(["du", "-sb", str(source)], text=True).split()[0])
        self.headroom(raw * 11 // 10 + 128 * 1024 ** 2, self.backups)

    def begin(self, refs):
        self.transaction()
        if len(refs) != 2 or any(r.split(":")[0] not in REPOS or not re.fullmatch(r"[a-z0-9./-]+:(?:staging-)?[a-f0-9]{7,40}", r) for r in refs):
            raise ValueError("deployment requires two immutable Keyspilli release tags")
        if [r.split(":")[0] for r in refs] != ["ghcr.io/reedtrullz/keyspilli", "ghcr.io/reedtrullz/keyspilli-worker"]:
            raise ValueError("deployment requires web and worker pair")
        record = {"token": uuid.uuid4().hex, "images": refs, "protectedIds": sorted(self.protections(self.images())),
                  "startedAt": time.time(), "status": "pending"}
        atomic_json(self.record, record)
        emit("deployment-begun", token=record["token"], images=refs)
        return record

    def pull(self, token):
        record = self.transaction(token)
        if record is None:
            raise RuntimeError("pull requires a pending deployment token")
        self.cleanup(True, token)
        root = self.run("info", "--format", "{{.DockerRootDir}}")
        # Remote compressed manifest sizes cannot bound extraction. Enforce a
        # conservative per-role *uncompressed* release ceiling and reserve.
        # Each pull is checked again; post-pull image Size must fit the ceiling.
        for ref in record["images"]:
            ceiling = (4 if "keyspilli-worker:" in ref else 2) * GIB
            # Three copies allows compressed transfer, extraction and store
            # coexistence. Existing exact images require no new extraction.
            existing = [i for i in self.images() if ref in (i.get("RepoTags") or [])]
            if existing:
                if existing[0]["Size"] > ceiling:
                    raise RuntimeError("existing image exceeds release ceiling")
                if record.get("digests"):
                    expected = ref.split(":")[0] + "@" + record["digests"][record["images"].index(ref)]
                    if expected not in (existing[0].get("RepoDigests") or []):
                        raise RuntimeError("existing release tag does not match admitted digest")
                emit("pull-skipped", image=ref, id=existing[0]["Id"], reason="immutable release already present")
                continue
            self.headroom(3 * ceiling, root)
            # Inspect registry config Size is unavailable before pull. Exported
            # CI metadata admission must attest the uncompressed ceiling.
            if not record.get("sizeAdmission"):
                raise RuntimeError("new image pull requires CI uncompressed size admission; use begin --sizes WEB_BYTES WORKER_BYTES")
            digest = record["digests"][record["images"].index(ref)]
            immutable = ref.split(":")[0] + "@" + digest
            self.run("pull", immutable, timeout=900)
            image = self.inspect("image", [immutable])[0]
            self.run("tag", image["Id"], ref)
            image = self.inspect("image", [ref])[0]
            if image["Size"] > min(ceiling, record["sizeAdmission"][record["images"].index(ref)]):
                raise RuntimeError("pulled image exceeds admitted release size; pending record retained")
            record["protectedIds"] = sorted(set(record["protectedIds"] + [image["Id"]]))
            atomic_json(self.record, record)

    def finish(self, token):
        record = self.transaction(token)
        if record is None:
            raise RuntimeError("finish requires a pending deployment token")
        containers = {c["Name"]: c for c in self.containers()}
        for name, ref in zip(("/keyspilli", "/keyspilli-worker"), record["images"]):
            c = containers[name]
            expected = self.inspect("image", [ref])[0]["Id"]
            if (c["Image"] != expected or c["State"].get("Status") != "running"
                    or c["State"].get("Health", {}).get("Status") != "healthy"):
                raise RuntimeError("deployment not healthy at exact image pair; pending record retained")
        atomic_json(self.current, {"images": [containers[n]["Image"] for n in ("/keyspilli", "/keyspilli-worker")]})
        self.record.unlink()
        emit("deployment-finished", token=token)
        try:
            self.cleanup(True)
        except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as e:
            # A GC failure after service acceptance must not trigger rollback.
            emit("cleanup-deferred", reason=str(e))

    def resolve(self, token):
        record = self.transaction(token)
        if record is None:
            raise RuntimeError("resolve requires a pending deployment token")
        # Explicit operator action after inspecting a canceled/rolled-back run.
        # A concurrent pull owns the flock, so resolution cannot race it.
        for c in self.containers():
            if c["Name"] in ("/keyspilli", "/keyspilli-worker"):
                if (c["Image"] not in record["protectedIds"]
                        or c["State"].get("Status") != "running"
                        or c["State"].get("Health", {}).get("Status") != "healthy"):
                    raise RuntimeError("recovery pair is not healthy/protected")
        if len([c for c in self.containers() if c["Name"] in ("/keyspilli", "/keyspilli-worker")]) != 2:
            raise RuntimeError("recovery pair missing")
        self.record.unlink()
        emit("deployment-resolved", token=token, reason="operator confirmed healthy recovery pair")
        try:
            self.cleanup(True)
        except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as e:
            emit("cleanup-deferred", reason=str(e))


@contextlib.contextmanager
def lock(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("backup/deployment/cleanup lock busy")
        yield


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("command", choices=["cleanup", "backup-preflight", "backup-headroom", "retention", "verify", "begin", "pull", "finish", "resolve", "status"])
    p.add_argument("--backups", default="/backups")
    p.add_argument("--state", default="/var/lib/keyspilli-storage")
    p.add_argument("--lock", default="/run/lock/keyspilli-backup.lock")
    p.add_argument("--lock-held", action="store_true", help="only for a parent holding the shared flock")
    p.add_argument("--apply", action="store_true", help="cleanup defaults to dry run")
    p.add_argument("--docker", default="docker")
    p.add_argument("--token")
    p.add_argument("--images", nargs=2)
    p.add_argument("--sizes", nargs=2, type=int, help="CI attested uncompressed web/worker bytes")
    p.add_argument("--digests", nargs=2, help="CI registry digests matching the size admission")
    p.add_argument("--manifest", type=Path)
    p.add_argument("--reserve-bytes", type=int, default=6 * GIB)
    args = p.parse_args()
    if args.reserve_bytes < 0:
        p.error("reserve must be nonnegative")
    policy = Policy(args.backups, args.state, args.docker, args.reserve_bytes)
    with contextlib.nullcontext() if args.lock_held else lock(args.lock):
        if args.command == "verify":
            d, _ = verify_cohort(args.manifest)
            emit("backup-verified", stamp=d["stamp"])
        elif args.command == "retention":
            retention(Path(args.backups), args.apply)
        elif args.command == "cleanup":
            policy.cleanup(args.apply, args.token)
        elif args.command == "backup-preflight":
            policy.backup_preflight(args.apply)
        elif args.command == "backup-headroom":
            policy.transaction()
            policy.backup_headroom()
        elif args.command == "begin":
            if args.sizes and (not 0 < args.sizes[0] <= 2 * GIB or not 0 < args.sizes[1] <= 4 * GIB):
                raise ValueError("CI image size exceeds release ceiling")
            if args.sizes and (not args.digests or not all(ID.fullmatch(d) for d in args.digests)):
                raise ValueError("size admission requires matching registry digests")
            r = policy.begin(args.images or [])
            if args.sizes:
                r["sizeAdmission"] = args.sizes
                r["digests"] = args.digests
                atomic_json(policy.record, r)
        elif args.command == "pull":
            policy.pull(args.token)
        elif args.command == "finish":
            policy.finish(args.token)
        elif args.command == "resolve":
            policy.resolve(args.token)
        elif args.command == "status":
            emit("deployment-status", record=json.loads(policy.record.read_text()) if policy.record.exists() else None)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, KeyError, StopIteration, subprocess.SubprocessError) as e:
        emit("refused", reason=str(e))
        sys.exit(1)
