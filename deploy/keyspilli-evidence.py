#!/usr/bin/env python3
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import tarfile
import uuid
import importlib.util

GIB = 1024 ** 3
LABEL = "io.keyspilli.evidence.run"
SCHEMA = "keyspilli-evidence/v1"
PROTECTED = (
    Path("/var/lib/keyspilli-evidence/305-native-20261016/preserved"),
    Path("/var/lib/keyspilli-evidence/305-readiness-15cpu-20261016/final-native/data"),
    Path("/var/lib/keyspilli-evidence/storage-cleanup-20261017T005832Z"),
)


def helper(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    if spec is None or spec.loader is None:
        raise RuntimeError("evidence helper missing: " + name)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def digest(path):
    with path.open("rb") as stream:
        return stream_digest(stream)


def stream_digest(stream):
    h = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        h.update(block)
    return h.hexdigest()


def save(path, value):
    durable_directory(path.parent)
    temp = path.with_suffix(".new")
    with temp.open("w") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)
    sync_directory(path.parent)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def durable_directory(path):
    pending = []
    parent = path
    while not parent.exists():
        pending.append(parent)
        parent = parent.parent
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    for created in reversed(pending):
        sync_directory(created.parent)


def durable_bytes(path, payload):
    durable_directory(path.parent)
    if path.exists() or path.is_symlink():
        regular(path)
    if path.exists() and path.read_bytes() != payload:
        previous = path.with_name(path.name + "." + digest(path))
        if previous.exists():
            regular(previous)
            if digest(previous) != digest(path):
                raise ValueError("conflicting prior diagnostic bytes")
        else:
            os.rename(path, previous)
            sync_directory(path.parent)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".partial")
    with temp.open("xb") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)
    sync_directory(path.parent)


def regular(path):
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1:
        raise ValueError(f"linked/nonregular file: {path}")
    return s


def files(root):
    if not root.exists():
        return []
    result = []
    for parent, directories, names in os.walk(root, followlinks=False):
        for name in directories:
            if (Path(parent) / name).is_symlink():
                raise ValueError("symlink directory in managed storage")
        for name in names:
            path = Path(parent) / name
            regular(path)
            result.append(path)
    return sorted(result)


def bytes_used(root):
    total = 0
    for parent, directories, names in os.walk(root, followlinks=False):
        for name in [*directories, *names]:
            info = (Path(parent) / name).lstat()
            total += max(info.st_size, info.st_blocks * 512)
    return total


def process_identity(pid):
    if sys.platform.startswith("linux"):
        try:
            value = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
            if value[0] == "Z":
                return None
            return Path("/proc/sys/kernel/random/boot_id").read_text().strip() + ":" + value[19]
        except (FileNotFoundError, ProcessLookupError):
            return None
    result = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "lstart="], capture_output=True, text=True,
                            env={**os.environ, "LANG": "C", "LC_ALL": "C"})
    if result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip():
        return None
    if result.returncode != 0 or not result.stdout.strip():
        raise RuntimeError("process identity inspection failed")
    return result.stdout.strip()


class Store:
    def __init__(self, root):
        raw = Path(root).absolute()
        if raw != raw.resolve() or raw == Path("/") or any(raw == p or raw.is_relative_to(p) or p.is_relative_to(raw) for p in PROTECTED):
            raise ValueError("unsafe or protected managed root")
        self.root = raw
        self.verified = {}
        durable_directory(self.root)
        if self.root.stat().st_mode & 0o022:
            raise ValueError("managed root must not be group/world writable")
        for name in ("runs", "scratch", "evidence", "inputs"):
            if (self.root / name).resolve() != self.root / name:
                raise ValueError("managed directories cannot be symlinks")
        self.reserve = int(os.environ.get("KEYSPILLI_EVIDENCE_RESERVE_BYTES", 6 * GIB))
        self.limit = int(os.environ.get("KEYSPILLI_EVIDENCE_LIMIT_BYTES", 16 * GIB))
        self.max_entries = int(os.environ.get("KEYSPILLI_EVIDENCE_MAX_ENTRIES", 100000))
        if self.reserve < 0 or self.limit <= 0 or self.max_entries <= 0:
            raise ValueError("invalid storage budget")

    @contextlib.contextmanager
    def lock(self):
        with contextlib.ExitStack() as stack:
            if self.root.is_relative_to(Path("/var/lib/keyspilli-evidence")):
                backup = stack.enter_context(Path("/run/lock/keyspilli-backup.lock").open("a+"))
                fcntl.flock(backup, fcntl.LOCK_EX | fcntl.LOCK_NB)
            stream = stack.enter_context((self.root / ".lock").open("a+"))
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield

    def path(self, run):
        if not re.fullmatch(r"[a-f0-9]{32}", run):
            raise ValueError("invalid run ID")
        path = self.root / "runs" / run / "run.json"
        for target in (path, self.root / "scratch" / run, self.root / "evidence" / run):
            if target.resolve() != target:
                raise ValueError("managed run path is linked")
        regular(path)
        document = json.loads(path.read_text())
        if document.get("schema") != SCHEMA or document.get("id") != run or document.get("root") != str(self.root):
            raise ValueError("unowned run record")
        return path, document

    def admission(self, peak):
        pinned = set()
        for path in (self.root / "runs").glob("*/run.json"):
            for resource in json.loads(path.read_text()).get("retainedResources", []):
                pinned.add(resource["id"])
        retained_bytes = sum(int(self.docker("image", "inspect", "--format", "{{.Size}}", image).strip()) for image in pinned)
        if peak <= 0 or self.usage() + retained_bytes + peak > self.limit:
            raise ValueError("scratch/evidence budget exceeded; archive durable evidence or reduce estimated peak")
        available = shutil.disk_usage(self.root).free
        if available < peak + self.reserve:
            raise ValueError(f"insufficient space: available={available} required={peak + self.reserve}")

    def guard(self, run):
        self.admit_run_bytes(run, 0)

    def usage(self):
        external = helper("evidence_external")
        return bytes_used(self.root) + sum(external.usage(self, self.path(path.parent.name)[1], bytes_used)
            for path in (self.root / "runs").glob("*/run.json"))

    def register_external(self, run, directory):
        with self.lock():
            path, doc = self.path(run)
            helper("evidence_external").register(self, doc, directory, save, PROTECTED)
            save(path, doc)

    def admit_run_bytes(self, run, additional):
        _, doc = self.path(run)
        available = shutil.disk_usage(self.root).free
        managed_growth = self.usage() - doc.get("managedBytesAtStart", 0)
        docker_growth = doc["availableAtStart"] - available if doc["resources"] else 0
        spent = max(managed_growth, docker_growth)
        entries = sum(len(directories) + len(names) for _, directories, names in os.walk(self.root, followlinks=False))
        entries += helper("evidence_external").entries(self, doc)
        if available < self.reserve + doc.get("bundleReserveBytes", 0) + additional or spent + additional > doc["peakBytes"] or entries > self.max_entries:
            raise ValueError(f"storage reservation exceeded; stopping writer: spent={spent} peak={doc['peakBytes']} free={available} exportReserve={doc.get('bundleReserveBytes', 0)} entries={entries}")

    def begin(self, peak, pid, export_required=False):
        with self.lock():
            for path in (self.root / "runs").glob("*/run.json"):
                doc = json.loads(path.read_text())
                if doc.get("state") != "released":
                    raise ValueError("single-run reservation held; recover abandoned runs before admission")
            self.admission(peak)
            bundle_reserve = bytes_used(self.root) + peak + self.max_entries * 16384 + 16 * 1024 ** 2 if export_required else 0
            if shutil.disk_usage(self.root).free < self.reserve + peak + bundle_reserve:
                raise ValueError("insufficient space for writer peak, evidence export and reserve")
            run = uuid.uuid4().hex
            doc = dict(schema=SCHEMA, root=str(self.root), id=run, state="running", peakBytes=peak,
                       ownerPid=pid, ownerIdentity=process_identity(pid), started=time.time(), inputs={}, resources=[], pins=[],
                       availableAtStart=shutil.disk_usage(self.root).free, managedBytesAtStart=bytes_used(self.root), bundleReserveBytes=bundle_reserve)
            durable_directory(self.root / "scratch" / run)
            durable_directory(self.root / "evidence" / run)
            save(self.root / "runs" / run / "run.json", doc)
            return doc

    def environment(self, run):
        _, doc = self.path(run)
        if doc["state"] != "running":
            raise ValueError("run is not writable")
        return {**os.environ, "KEYSPILLI_EVIDENCE_ROOT": str(self.root), "KEYSPILLI_EVIDENCE_RUN": run,
                "KEYSPILLI_SCRATCH": str(self.root / "scratch" / run),
                "KEYSPILLI_EVIDENCE": str(self.root / "evidence" / run),
                "KEYSPILLI_DATA_DIR": str(self.root / "scratch" / run / "data"),
                "KEYSPILLI_BACKUP_DIR": str(self.root / "scratch" / run / "backups"),
                "TMPDIR": str(self.root / "scratch" / run),
                "KEYSPILLI_REAL_DOCKER": os.environ.get("KEYSPILLI_REAL_DOCKER", shutil.which("docker") or "docker"),
                "PATH": str(Path(__file__).with_name("evidence-bin")) + os.pathsep + os.environ["PATH"]}

    def register_restore(self, run, destination, manifest_path, planned=False):
        with self.lock():
            path, doc = self.path(run)
            base = self.root / "scratch" / run
            destination = Path(destination).resolve()
            if not destination.is_relative_to(base):
                raise ValueError("restore destination escapes owned scratch")
            manifest_path, manifest = committed_restore(manifest_path)
            archive = manifest_path.parent / manifest["archiveFile"]
            if digest(archive) != manifest["archiveSha256"]:
                raise ValueError("restore archive checksum mismatch")
            archive = self.acquire(archive, run)
            for file, key in ((destination / manifest["archiveFile"], "archive"), (destination / manifest["dbFile"], "db")):
                original = manifest_path.parent / manifest[key + "File"]
                cached = archive if key == "archive" else self.acquire(original, run)
                reference = dict(path=str(cached), sha256=manifest[key + "Sha256"])
                doc["inputs"][str(file.relative_to(base))] = reference
                if original.is_relative_to(base):
                    doc["inputs"][str(original.relative_to(base))] = reference
            with tarfile.open(archive, "r:gz") as stream:
                for member in stream:
                    safe_member(member)
                    if not member.isfile():
                        continue
                    target = destination / "runtime" / member.name
                    if not planned:
                        regular(target)
                    member_stream = stream.extractfile(member)
                    if member_stream is None:
                        raise ValueError("missing archive file stream")
                    with member_stream:
                        sha = stream_digest(member_stream)
                    if not planned and digest(target) != sha:
                        continue
                    doc["inputs"][str(target.relative_to(base))] = dict(path=str(archive),
                        archiveSha256=manifest["archiveSha256"], member=member.name, sha256=sha)
            save(path, doc)

    def reference_matches(self, source, sha):
        original = Path(source["path"])
        s = regular(original)
        identity = (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        cached = self.verified.get(str(original))
        if not cached or cached[0] != identity:
            cached = (identity, digest(original))
            self.verified[str(original)] = cached
        if "member" in source:
            return cached[1] == source["archiveSha256"] and sha == source["sha256"]
        return cached[1] == sha == source["sha256"]

    def copy(self, run, source, relative):
        with self.lock():
            path, doc = self.path(run)
            if doc["state"] != "running":
                raise ValueError("run is not writable")
            source = self.acquire(Path(source).resolve(), run)
            target = self.root / "scratch" / run / relative
            scratch = self.root / "scratch" / run
            if not target.resolve().is_relative_to(scratch) or target.resolve() == scratch:
                raise ValueError("copy target escapes scratch")
            self.admission(source.stat().st_size)
            self.admit_run_bytes(run, source.stat().st_size)
            sha = digest(source)
            entry = dict(path=str(source), sha256=sha, size=source.stat().st_size)
            doc["inputs"][str(target.relative_to(scratch))] = entry
            save(path, doc)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open("rb") as src, target.open("xb") as dst:
                shutil.copyfileobj(src, dst)
            if digest(target) != sha or digest(source) != sha:
                raise ValueError("input changed during copy")

    def acquire(self, source, run):
        regular(source)
        sha = digest(source)
        target = self.root / "inputs" / sha
        durable_directory(target.parent)
        if target.exists():
            regular(target)
            if digest(target) != sha:
                raise ValueError("immutable input pool checksum mismatch")
            return target
        self.admission(source.stat().st_size)
        self.admit_run_bytes(run, source.stat().st_size)
        self.path(run)
        temporary = target.with_suffix("." + run + ".partial")
        with source.open("rb") as src, temporary.open("xb") as dst:
            shutil.copyfileobj(src, dst)
            dst.flush()
            os.fsync(dst.fileno())
        if digest(temporary) != sha or digest(source) != sha:
            raise ValueError("input changed during acquisition; partial preserved")
        temporary.chmod(0o444)
        os.rename(temporary, target)
        sync_directory(target.parent)
        return target

    def resource(self, run, kind, name):
        with self.lock():
            path, doc = self.path(run)
            if doc["state"] != "running":
                raise ValueError("run is not writable")
            doc["resources"].append(dict(kind=kind, name=name))
            save(path, doc)

    def active(self, doc):
        return bool(doc["ownerIdentity"] and process_identity(doc["ownerPid"]) == doc["ownerIdentity"])

    def close_abandoned_child(self, doc):
        identity = doc.get("childIdentity")
        if not identity:
            return
        pid = doc["childPid"]
        current = process_identity(pid)
        if current is not None and current != identity:
            return
        if sys.platform.startswith("linux") and not identity.startswith(Path("/proc/sys/kernel/random/boot_id").read_text().strip() + ":"):
            return
        if current == identity:
            if os.getpgid(pid) != pid:
                raise ValueError("owned child group identity changed")
            os.killpg(pid, signal.SIGTERM)
            deadline = time.monotonic() + 3
            while process_identity(pid) == identity and time.monotonic() < deadline:
                time.sleep(.02)
            if process_identity(pid) == identity:
                os.killpg(pid, signal.SIGKILL)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            try:
                os.killpg(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(.02)
        raise ValueError("original child group still present; closure remains unresolved")

    def external_users(self, scratch):
        if not sys.platform.startswith("linux"):
            return
        current = os.getpid()
        for proc in Path("/proc").glob("[0-9]*"):
            if int(proc.name) == current:
                continue
            try:
                links = [proc / "cwd", proc / "root", *list((proc / "fd").iterdir())]
                for link in links:
                    try:
                        if Path(os.readlink(link).removesuffix(" (deleted)")).is_relative_to(scratch):
                            raise ValueError(f"scratch in use by process {proc.name}")
                    except (FileNotFoundError, ProcessLookupError):
                        pass
                for line in (proc / "maps").read_text().splitlines():
                    parts = line.split(maxsplit=5)
                    if len(parts) == 6 and parts[5].startswith("/") and Path(parts[5].removesuffix(" (deleted)")).is_relative_to(scratch):
                        raise ValueError(f"scratch mapped by process {proc.name}")
            except (FileNotFoundError, ProcessLookupError):
                continue
        if shutil.which("docker") or os.environ.get("KEYSPILLI_REAL_DOCKER"):
            ids = self.docker("ps", "-aq").split()
            if ids:
                for line in self.docker("inspect", "--format", "{{json .Mounts}}", *ids).splitlines():
                    for mount in json.loads(line):
                        source = Path(mount.get("Source", "/"))
                        if source == scratch or source.is_relative_to(scratch):
                            raise ValueError("scratch still mounted by a container")

    def builder_environment(self, run):
        self.path(run)
        configuration = self.root / "scratch" / run / "buildx-config"
        if configuration.resolve() != configuration:
            raise ValueError("builder configuration is linked")
        return {**os.environ, "BUILDX_CONFIG": str(configuration)}

    def docker(self, *args, buildx_run=None):
        real = os.environ.get("KEYSPILLI_REAL_DOCKER", shutil.which("docker") or "docker")
        return subprocess.run([real, *args], check=True, capture_output=True, text=True, timeout=60,
                              env=self.builder_environment(buildx_run) if buildx_run else None).stdout

    def image_pins(self, image, aliases=()):
        backups = Path(os.environ.get("KEYSPILLI_BACKUP_DIR", "/backups"))
        state = Path(os.environ.get("KEYSPILLI_STORAGE_STATE_DIR", "/var/lib/keyspilli-storage"))
        paths = [*backups.glob("backup-manifest-*.json"), *backups.glob(".keyspilli-offhost-*/backup-manifest-*.json"),
                 state / "current.json", state / "deployment.json"]
        paths += list(self.root.rglob("backup-manifest-*.json"))
        for path in paths:
            if path.exists():
                if not stat.S_ISREG(path.lstat().st_mode):
                    raise ValueError("nonregular recovery reference")
                value = json.loads(path.read_text())
                if any(reference in json.dumps(value) for reference in (image, *aliases)):
                    return str(path)
                if not isinstance(value, dict):
                    raise ValueError("malformed recovery reference")
                if path.name == "current.json":
                    ids = value.get("images")
                    if not isinstance(ids, list) or any(not isinstance(item, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", item) for item in ids):
                        raise ValueError("malformed accepted-current image references")
                elif path.name == "deployment.json":
                    ids, deployment_aliases = value.get("protectedIds"), value.get("images")
                    if not isinstance(ids, list) or not isinstance(deployment_aliases, list) or any(not isinstance(item, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", item) for item in ids) or any(not isinstance(item, str) or not re.fullmatch(r"[a-z0-9._/-]+:[A-Za-z0-9._-]+", item) for item in deployment_aliases):
                        raise ValueError("malformed deployment image references")
                    digests = value.get("digests", [])
                    if not isinstance(digests, list) or any(not isinstance(item, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", item) for item in digests):
                        raise ValueError("malformed deployment digests")
                else:
                    document = helper("keyspilli-storage").manifest_document(path)
                    images = document.get("images")
                    if not isinstance(images, dict) or any(not isinstance(images.get(role), dict) or not isinstance(images[role].get("id"), str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", images[role]["id"]) for role in ("web", "worker")):
                        raise ValueError("malformed backup image references")
        return None

    def cleanup_resources(self, doc):
        run = doc["id"]
        evidence = self.root / "evidence" / run
        model = helper("evidence_resources")
        resources = [model.decode(item, run) for item in doc["resources"]]
        if resources and doc.get("dockerIdentity") and self.docker("info", "--format", "{{.ID}}").strip() != doc["dockerIdentity"]:
            raise ValueError("Docker daemon identity changed before cleanup")
        for item in reversed(resources):
            kind, name = item.kind, item.name
            if kind == "container":
                ids = self.docker("ps", "-aq", "--filter", f"name=^/{name}$").split()
                if not ids:
                    continue
                info = json.loads(self.docker("inspect", ids[0]))[0]
                if (info.get("Config", {}).get("Labels") or {}).get(LABEL) != run:
                    raise ValueError("container ownership changed")
                try:
                    self.docker("stop", "--time", "3", ids[0])
                    real = os.environ.get("KEYSPILLI_REAL_DOCKER", shutil.which("docker") or "docker")
                    logs = subprocess.run([real, "logs", ids[0]], check=True, capture_output=True, timeout=30)
                    durable_bytes(evidence / f"container-{name}.stdout", logs.stdout)
                    durable_bytes(evidence / f"container-{name}.stderr", logs.stderr)
                    save(evidence / f"container-{name}-state.json", json.loads(self.docker("inspect", "--format", "{{json .State}}", ids[0])))
                except subprocess.CalledProcessError as error:
                    (evidence / f"container-{name}-logs-error.txt").write_text(str(error))
                    raise
                self.docker("rm", "--volumes", ids[0])
            elif kind == "builder":
                volume = "buildx_buildkit_" + name + "0_state"
                users = self.docker("ps", "-aq", "--filter", "volume=" + volume).split()
                if users:
                    expected = "/buildx_buildkit_" + name + "0"
                    if any(line != expected for line in self.docker("inspect", "--format", "{{.Name}}", *users).splitlines()):
                        raise ValueError("builder state is referenced by another container")
                names = self.docker("buildx", "ls", "--format", "{{.Name}}", buildx_run=run).split()
                if name in names:
                    self.docker("buildx", "rm", name, buildx_run=run)
                if volume in self.docker("volume", "ls", "-q", "--filter", "name=" + volume).split():
                    if self.docker("ps", "-aq", "--filter", "volume=" + volume).strip():
                        raise ValueError("builder state volume remains in use")
                    self.docker("volume", "rm", volume)
            elif kind == "image":
                ids = self.docker("image", "ls", "-q", "--no-trunc", name).split()
                if not ids:
                    continue
                info = json.loads(self.docker("image", "inspect", ids[0]))[0]
                if (info.get("Config", {}).get("Labels") or {}).get(LABEL) != run:
                    raise ValueError("image ownership changed")
                aliases = info.get("RepoTags") or []
                if aliases != [name] or info.get("RepoDigests"):
                    raise ValueError("image has additional protected references")
                pin = self.image_pins(ids[0], (name,))
                if pin:
                    doc.setdefault("retainedResources", []).append(dict(kind="image", id=ids[0], name=name, reason=pin))
                    continue
                if self.docker("ps", "-aq", "--filter", f"ancestor={ids[0]}").strip():
                    raise ValueError("image still used by a container")
                self.docker("image", "rm", "--no-prune", ids[0])
            else:
                raise ValueError("unknown resource kind")

    def finish(self, run, outcome, recovering=False):
        with self.lock():
            path, doc = self.path(run)
            if doc["pins"]:
                return doc
            if doc["state"] == "released":
                if doc.get("retainedResources"):
                    previous = json.loads(json.dumps(doc))
                    retry = {**doc, "resources": [dict(kind="image", name=item["name"]) for item in doc["retainedResources"]], "retainedResources": []}
                    self.cleanup_resources(retry)
                    doc["retainedResources"] = retry["retainedResources"]
                    if doc != previous:
                        save(path, doc)
                return doc
            if recovering and self.active(doc):
                return doc
            if recovering:
                self.close_abandoned_child(doc)
            evidence = self.root / "evidence" / run
            scratch = self.root / "scratch" / run
            try:
                self.cleanup_resources(doc)
                self.external_users(scratch)
                helper("evidence_external").collect(self, doc, durable_directory, sync_directory)
                save(path, doc)
                for partial in (self.root / "inputs").glob(f"*.{run}.partial"):
                    regular(partial)
                    self.external_users(partial)
                    destination = scratch / "incomplete-inputs" / partial.name
                    durable_directory(destination.parent)
                    os.rename(partial, destination)
                    sync_directory(partial.parent)
                    sync_directory(destination.parent)
                prior = evidence / "reconstruction.json"
                entries = json.loads(prior.read_text())["files"] if prior.exists() else {}
                for target in files(scratch):
                    rel = str(target.relative_to(scratch))
                    s = regular(target)
                    sha = digest(target)
                    source = doc["inputs"].get(rel)
                    reusable = False
                    if source and "sqlite" not in target.name:
                        try:
                            reusable = self.reference_matches(source, sha)
                        except (OSError, ValueError):
                            reusable = False
                    entry = dict(sha256=sha, size=s.st_size, mode=stat.S_IMODE(s.st_mode), mtimeNs=s.st_mtime_ns, uid=s.st_uid, gid=s.st_gid)
                    if reusable:
                        entry["source"] = source
                    else:
                        retained = evidence / "files" / rel
                        entry["evidence"] = str(retained)
                    entries[rel] = entry
                for entry in entries.values():
                    source = entry.get("source")
                    if source and Path(source["path"]).is_relative_to(scratch):
                        rel = str(Path(source["path"]).relative_to(scratch))
                        retained_source = entries.get(rel, {}).get("evidence")
                        if not retained_source:
                            raise ValueError("reconstruction input would be released")
                        entry["source"] = {**source, "path": retained_source}
                save(prior, dict(schema=SCHEMA, id=run, files=entries))
                for target in files(scratch):
                    entry = entries[str(target.relative_to(scratch))]
                    if digest(target) != entry["sha256"]:
                        raise ValueError("scratch changed during sealing")
                    if "evidence" in entry:
                        retained = Path(entry["evidence"])
                        durable_directory(retained.parent)
                        if retained.exists():
                            if digest(retained) != entry["sha256"]:
                                raise ValueError("conflicting evidence; cleanup refused")
                            target.unlink()
                        else:
                            with target.open("rb") as stream:
                                os.fsync(stream.fileno())
                            os.rename(target, retained)
                            sync_directory(retained.parent)
                        sync_directory(target.parent)
                for target in files(scratch):
                    entry = entries[str(target.relative_to(scratch))]
                    if digest(target) != entry["sha256"] or not self.reference_matches(entry["source"], entry["sha256"]):
                        raise ValueError("reconstruction input changed before unlink")
                    target.unlink()
                    sync_directory(target.parent)
                if scratch.exists():
                    shutil.rmtree(scratch)
                    sync_directory(scratch.parent)
                doc.update(state="released", outcome=outcome, finished=time.time())
                doc.pop("cleanupError", None)
            except Exception as error:
                doc["cleanupError"] = str(error)
                save(path, doc)
                raise
            save(path, doc)
            return doc

    def recover(self):
        results = []
        failures = []
        for path in sorted((self.root / "runs").glob("*/run.json")):
            try:
                results.append(self.finish(path.parent.name, "abandoned", recovering=True))
            except Exception as error:
                failures.append(dict(id=path.parent.name, error=str(error)))
        report = dict(runs=results, failures=failures, usageBytes=self.usage(), availableBytes=shutil.disk_usage(self.root).free)
        print(json.dumps(report, sort_keys=True))
        return 1 if failures else 0

    def reconstruct(self, run, destination):
        with self.lock():
            self.path(run)
            manifest = json.loads((self.root / "evidence" / run / "reconstruction.json").read_text())
            target = Path(destination).absolute()
            if target.exists() or target.is_symlink() or target != target.resolve() or any(target.is_relative_to(p) or p.is_relative_to(target) for p in PROTECTED):
                raise ValueError("reconstruction requires a fresh destination")
            entries = manifest["files"]
            archive_groups = {}
            for rel, entry in entries.items():
                if Path(rel).is_absolute() or ".." in Path(rel).parts:
                    raise ValueError("unsafe reconstruction path")
                source = Path(entry["evidence"]) if "evidence" in entry else None
                valid = digest(source) == entry["sha256"] if source else self.reference_matches(entry["source"], entry["sha256"])
                if not valid:
                    raise ValueError("reconstruction source checksum mismatch")
                if "source" in entry and "member" in entry["source"]:
                    source = entry["source"]
                    archive_groups.setdefault(source["path"], {}).setdefault(source["member"], []).append((rel, entry))
            for archive_path, members in archive_groups.items():
                found = set()
                with tarfile.open(archive_path, "r:gz") as archive:
                    for member in archive:
                        if member.name in members:
                            safe_member(member)
                            stream = archive.extractfile(member)
                            if stream is None or member.name in found:
                                raise ValueError("missing or duplicate reconstruction member")
                            with stream:
                                sha = stream_digest(stream)
                                if any(sha != entry["sha256"] for _, entry in members[member.name]):
                                    raise ValueError("reconstruction member checksum mismatch")
                            found.add(member.name)
                if found != set(members):
                    raise ValueError("missing reconstruction archive member")
            self.admission(sum(x["size"] for x in entries.values()))
            if shutil.disk_usage(target.parent).free < sum(x["size"] for x in entries.values()) + self.reserve:
                raise ValueError("insufficient reconstruction destination space")
            target.mkdir(parents=True, exist_ok=False)
            if target.is_relative_to(self.root / "scratch"):
                parts = target.relative_to(self.root / "scratch").parts
                path, writable = self.path(parts[0])
                if writable["state"] != "running":
                    raise ValueError("reconstruction run is not writable")
                for rel, entry in entries.items():
                    key = str((target / rel).relative_to(self.root / "scratch" / parts[0]))
                    writable["inputs"][key] = entry.get("source", dict(path=entry.get("evidence"), sha256=entry["sha256"]))
                save(path, writable)
            def materialize(rel, entry, src):
                out = target / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                with out.open("xb") as dst:
                    shutil.copyfileobj(src, dst)
                if digest(out) != entry["sha256"]:
                    raise ValueError("reconstruction copy checksum mismatch")
                out.chmod(entry["mode"])
                if os.geteuid() == 0:
                    os.chown(out, entry["uid"], entry["gid"])
                os.utime(out, ns=(entry["mtimeNs"], entry["mtimeNs"]))
            for rel, entry in entries.items():
                if "evidence" in entry or "member" not in entry["source"]:
                    source = Path(entry["evidence"]) if "evidence" in entry else Path(entry["source"]["path"])
                    with source.open("rb") as src:
                        materialize(rel, entry, src)
            for archive_path, members in archive_groups.items():
                with tarfile.open(archive_path, "r:gz") as archive:
                    for member in archive:
                        if member.name in members:
                            src = archive.extractfile(member)
                            if src is None:
                                raise ValueError("missing reconstruction member")
                            with src:
                                for rel, entry in members[member.name]:
                                    src.seek(0)
                                    materialize(rel, entry, src)


def committed_restore(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    regular(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    stamp = manifest.get("stamp", "")
    if manifest.get("complete") is not True or not isinstance(stamp, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}-\d{6}", stamp):
        raise ValueError("invalid committed restore manifest")
    for key, extension in (("db", "sqlite"), ("archive", "tar.gz")):
        name = f"{'artifacts' if key == 'archive' else 'db'}-{stamp}.{extension}"
        source = manifest_path.parent / name
        if manifest.get(key + "File") != name:
            raise ValueError("invalid committed restore filename")
        regular(source)
        if digest(source) != manifest.get(key + "Sha256"):
            raise ValueError("restore source checksum mismatch")
    return manifest_path, manifest


def safe_member(member):
    path = Path(member.name)
    allowed = {"artifacts", "seed-midi", "transcribed", "uploads", "manifest.json", "learner-review.json", "review-receipts", "harmony-candidates"}
    if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0].removeprefix("._") not in allowed or not (member.isfile() or member.isdir()):
        raise ValueError("unsafe archive member")


def restore_peak(manifest_path):
    manifest_path, manifest = committed_restore(manifest_path)
    archive = manifest_path.parent / manifest["archiveFile"]
    if archive.parent != manifest_path.parent or digest(archive) != manifest["archiveSha256"]:
        raise ValueError("invalid restore archive identity")
    with tarfile.open(archive, "r:gz") as stream:
        expanded = 0
        seen = set()
        for member in stream:
            safe_member(member)
            if member.name in seen:
                raise ValueError("duplicate archive member")
            seen.add(member.name)
            expanded += member.size + 4096
    return expanded + archive.stat().st_size + 3 * (manifest_path.parent / manifest["dbFile"]).stat().st_size + 128 * 1024 ** 2


def run_command(store, peak, command, restore_manifest=None, existing_run=None):
    doc = store.path(existing_run)[1] if existing_run else store.begin(peak, os.getpid())
    run = doc["id"]
    if restore_manifest:
        command = ["bash", str(Path(__file__).with_name("restore-drill.sh")), restore_manifest,
                   str(store.root / "scratch" / run / "restored"), *command]
    code = 1
    child = None
    log_path = store.root / "evidence" / run / ("step-" + uuid.uuid4().hex + ".log" if existing_run else "command.log")
    save(log_path.with_suffix(".command.json"), dict(argv=command, cwd=os.getcwd(), started=time.time()))

    def cancelled(signum, _frame):
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signum)
        raise InterruptedError(signum)

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, cancelled)
    try:
        if restore_manifest:
            store.register_restore(run, store.root / "scratch" / run / "restored", restore_manifest, planned=True)
        store.guard(run)
        with store.lock():
            path, current = store.path(run)
            current.update(childLauncherPid=os.getpid(), childPid=None, childIdentity=None)
            save(path, current)
        with log_path.open("wb") as log, log_path.open("rb") as reader:
            launch = [sys.executable, str(Path(__file__).with_name("evidence-child.py")), str(store.root), run, str(os.getpid()), *command]
            child = subprocess.Popen(launch, env=dict(os.environ) if existing_run else store.environment(run), stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            with store.lock():
                path, current = store.path(run)
                current.update(childPid=child.pid, childIdentity=process_identity(child.pid))
                save(path, current)
            while child.poll() is None:
                try:
                    child.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    try:
                        store.guard(run)
                    except ValueError:
                        log.write(b"\nstorage reservation exceeded; stopping writer\n")
                        log.flush()
                        cancelled(signal.SIGTERM, None)
                if existing_run:
                    chunk = reader.read(1024 * 1024)
                    if chunk:
                        sys.stdout.buffer.write(chunk)
                        sys.stdout.buffer.flush()
            code = child.returncode
            store.guard(run)
            log.flush()
            os.fsync(log.fileno())
            if existing_run:
                shutil.copyfileobj(reader, sys.stdout.buffer)
                sys.stdout.buffer.flush()
    except InterruptedError as error:
        code = 128 + error.args[0]
        if child is not None:
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
    except Exception as error:
        code = 1
        durable_bytes(log_path.with_suffix(".error.txt"), (str(error) + "\n").encode())
        raise
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        if child is not None and child.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        if log_path.exists():
            with log_path.open("rb") as stream:
                os.fsync(stream.fileno())
            sync_directory(log_path.parent)
        if not existing_run:
            doc = store.finish(run, code)
            print(json.dumps(dict(id=run, outcome=code, state=doc["state"], usageBytes=bytes_used(store.root))))
    return code if code >= 0 else 128 - code


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=os.environ.get("KEYSPILLI_EVIDENCE_ROOT", "/var/lib/keyspilli-evidence/managed-v1"))
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("begin", "run"):
        sub = commands.add_parser(name)
        sub.add_argument("--peak-bytes", type=int, required=True)
        if name == "begin":
            sub.add_argument("--owner-pid", type=int, default=os.getppid())
        else:
            sub.add_argument("args", nargs=argparse.REMAINDER)
    commands.add_parser("recover")
    sub = commands.add_parser("finish")
    sub.add_argument("id")
    sub = commands.add_parser("copy")
    sub.add_argument("source")
    sub.add_argument("relative")
    sub = commands.add_parser("reconstruct")
    sub.add_argument("id")
    sub.add_argument("destination")
    commands.add_parser("environment")
    sub = commands.add_parser("register-external")
    sub.add_argument("directory")
    for name in ("bundle", "import-bundle"):
        sub = commands.add_parser(name)
        sub.add_argument("file")
    sub = commands.add_parser("register-restore")
    sub.add_argument("destination")
    sub.add_argument("manifest")
    sub = commands.add_parser("restore")
    sub.add_argument("manifest")
    sub.add_argument("args", nargs=argparse.REMAINDER)
    sub = commands.add_parser("restore-preflight")
    sub.add_argument("manifest")
    sub.add_argument("destination")
    for name in ("pin", "unpin"):
        sub = commands.add_parser(name)
        sub.add_argument("id")
        if name == "pin":
            sub.add_argument("reason")
    args = parser.parse_args()
    if args.command == "restore-preflight" and "KEYSPILLI_EVIDENCE_ROOT" not in os.environ and args.root == "/var/lib/keyspilli-evidence/managed-v1":
        args.root = str(Path(args.destination).resolve().parent / ".keyspilli-evidence")
    store = Store(args.root)
    if args.command == "run":
        return run_command(store, args.peak_bytes, args.args[1:] if args.args[:1] == ["--"] else args.args)
    if args.command == "begin":
        print(json.dumps(store.begin(args.peak_bytes, args.owner_pid)))
    elif args.command == "copy":
        store.copy(os.environ["KEYSPILLI_EVIDENCE_RUN"], args.source, args.relative)
    elif args.command == "register-external":
        store.register_external(os.environ["KEYSPILLI_EVIDENCE_RUN"], args.directory)
    elif args.command == "register-restore":
        store.register_restore(os.environ["KEYSPILLI_EVIDENCE_RUN"], args.destination, args.manifest)
    elif args.command == "restore":
        return run_command(store, restore_peak(args.manifest), args.args, args.manifest)
    elif args.command == "restore-preflight":
        peak = restore_peak(args.manifest)
        with store.lock():
            store.admission(peak)
            destination = Path(args.destination).resolve()
            parent = destination.parent
            while not parent.exists():
                parent = parent.parent
            if shutil.disk_usage(parent).free < peak + store.reserve:
                raise ValueError("insufficient restore destination space")
    elif args.command == "environment":
        env = store.environment(os.environ["KEYSPILLI_EVIDENCE_RUN"])
        print(json.dumps({key: env[key] for key in ("KEYSPILLI_EVIDENCE_ROOT", "KEYSPILLI_EVIDENCE_RUN", "KEYSPILLI_SCRATCH", "KEYSPILLI_EVIDENCE", "KEYSPILLI_REAL_DOCKER", "TMPDIR", "PATH")}))
    elif args.command in ("bundle", "import-bundle"):
        spec = importlib.util.spec_from_file_location("evidence_bundle", Path(__file__).with_name("evidence_bundle.py"))
        if spec is None or spec.loader is None:
            raise RuntimeError("bundle helper missing")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if args.command == "bundle":
            module.export_bundle(store, args.file)
        else:
            module.import_bundle(store, args.file)
    elif args.command == "finish":
        print(json.dumps(store.finish(args.id, "finished")))
    elif args.command == "recover":
        return store.recover()
    elif args.command == "reconstruct":
        store.reconstruct(args.id, args.destination)
    else:
        with store.lock():
            path, doc = store.path(args.id)
            doc["pins"] = [args.reason] if args.command == "pin" else []
            save(path, doc)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"evidence lifecycle: {error}", file=sys.stderr)
        sys.exit(1)
