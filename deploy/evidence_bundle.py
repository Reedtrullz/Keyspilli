import io
import hashlib
import json
import os
from pathlib import Path
import re
import tarfile
import shutil


def native_piano_omissions(store):
    rows = []
    for path in sorted((store.root / "evidence").glob("*/files/native-piano/*")):
        match = re.fullmatch(r"([0-9a-f]{64})\.ogg", path.name)
        if not path.is_file() or path.is_symlink() or match is None:
            raise ValueError("invalid native piano evidence member")
        run = path.parents[2].name
        reconstruction = json.loads((store.root / "evidence" / run / "reconstruction.json").read_text())
        entry = reconstruction.get("files", {}).get("native-piano/" + path.name)
        with path.open("rb") as stream:
            sha256 = hashlib.sha256(stream.read()).hexdigest()
        if (not entry or entry.get("sha256") != match.group(1) or entry.get("sha256") != sha256
                or entry.get("size") != path.stat().st_size or Path(entry.get("evidence", "")) != path):
            raise ValueError("native piano omission lacks matching sealed evidence")
        rows.append(dict(path=str(path.relative_to(store.root)), bytes=path.stat().st_size, sha256=sha256))
    return rows


def export_bundle(store, destination, omit_native_piano=False):
    destination = Path(destination).resolve()
    if destination.is_relative_to(store.root) or destination.exists():
        raise ValueError("bundle requires a fresh path outside managed storage")
    with store.lock():
        uncovered = [str(path) for record in (store.root / "runs").glob("*/run.json")
                     for path in store.external_paths(record.parent.name)]
        if uncovered:
            raise ValueError("bundle would omit uncollected external fixtures: " + ", ".join(uncovered))
        omissions = native_piano_omissions(store) if omit_native_piano else []
        omitted = {row["path"] for row in omissions}
        estimated = sum(p.lstat().st_size for p in store.root.rglob("*") if p.is_file() and not p.is_symlink())
        if shutil.disk_usage(destination.parent).free < estimated + store.reserve:
            raise ValueError("insufficient bundle destination space")
        with tarfile.open(destination, "x:gz", dereference=False, compresslevel=1) as archive:
            data = json.dumps(dict(schema="keyspilli-evidence-bundle/v1", root=str(store.root))).encode()
            info = tarfile.TarInfo("bundle.json")
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
            if omissions:
                payload = json.dumps(dict(schema="keyspilli-evidence-omissions/v1",
                    reason="Public native piano samples are pinned by the complete sealed reconstruction and fixture digest",
                    fixture="apps/web/scripts/fixtures/native-piano-assets.json", members=omissions),
                    indent=2, sort_keys=True).encode() + b"\n"
                info = tarfile.TarInfo("transport-omitted.json")
                info.size = len(payload)
                info.mode = 0o444
                archive.addfile(info, io.BytesIO(payload))
            for path in sorted(store.root.iterdir()):
                if path.name not in (".lock", "bundle.json"):
                    archive.add(path, arcname=path.name, recursive=True,
                                filter=lambda member: None if member.name in omitted else member)
        with destination.open("rb") as stream:
            os.fsync(stream.fileno())


def import_bundle(store, source):
    if list(store.root.iterdir()):
        raise ValueError("bundle import requires an empty managed root")
    with store.lock(), tarfile.open(source, "r:gz") as archive:
        members = archive.getmembers()
        metadata = archive.extractfile("bundle.json")
        if metadata is None:
            raise ValueError("bundle metadata missing")
        with metadata:
            document = json.load(metadata)
        if document.get("schema") != "keyspilli-evidence-bundle/v1":
            raise ValueError("unsupported bundle")
        old_root = document["root"]
        if not isinstance(old_root, str) or not old_root.startswith("/") or old_root == "/":
            raise ValueError("invalid bundle origin")
        names = set()
        unsafe = []
        for member in members:
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts or member.name in names:
                raise ValueError("unsafe or duplicate bundle path")
            names.add(member.name)
            if not (member.isfile() or member.isdir()):
                unsafe.append(dict(path=member.name, type=repr(member.type), link=member.linkname))
        store.admission(sum(member.size + 4096 for member in members))
        for member in members:
            target = store.root / member.name
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError("bundle file stream missing")
                with stream, target.open("xb") as out:
                    shutil.copyfileobj(stream, out)
                target.chmod(member.mode & 0o777)

        def rebase(value):
            if isinstance(value, str) and value.startswith(old_root + "/"):
                return str(store.root) + value[len(old_root):]
            if value == old_root:
                return str(store.root)
            if isinstance(value, list):
                return [rebase(item) for item in value]
            if isinstance(value, dict):
                return {key: rebase(item) for key, item in value.items()}
            return value

        for path in [*store.root.glob("runs/*/run.json"), *store.root.glob("evidence/*/reconstruction.json")]:
            value = rebase(json.loads(path.read_text()))
            if not isinstance(value, dict):
                raise ValueError("invalid imported document")
            if path.name == "run.json":
                value["originResources"] = value.get("resources", [])
                value["resources"] = []
                value["originRetainedResources"] = value.pop("retainedResources", [])
                value["originExternalScratch"] = value.pop("externalScratch", [])
                value["ownerIdentity"] = None
                value.pop("childIdentity", None)
            path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
        if unsafe:
            (store.root / "unsafe-bundle-entries.json").write_text(json.dumps(unsafe, indent=2) + "\n")
