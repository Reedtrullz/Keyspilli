import io
import json
import os
from pathlib import Path
import tarfile
import shutil


def export_bundle(store, destination):
    destination = Path(destination).resolve()
    if destination.is_relative_to(store.root) or destination.exists():
        raise ValueError("bundle requires a fresh path outside managed storage")
    with store.lock():
        estimated = sum(p.lstat().st_size for p in store.root.rglob("*") if p.is_file() and not p.is_symlink())
        if shutil.disk_usage(destination.parent).free < estimated + store.reserve:
            raise ValueError("insufficient bundle destination space")
        with tarfile.open(destination, "x:gz", dereference=False, compresslevel=1) as archive:
            data = json.dumps(dict(schema="keyspilli-evidence-bundle/v1", root=str(store.root))).encode()
            info = tarfile.TarInfo("bundle.json")
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
            for path in sorted(store.root.iterdir()):
                if path.name not in (".lock", "bundle.json"):
                    archive.add(path, arcname=path.name, recursive=True)
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
