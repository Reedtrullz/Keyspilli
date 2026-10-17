from dataclasses import dataclass
import json
import os
from pathlib import Path
import stat

MARKER = ".keyspilli-evidence-owner.json"


@dataclass(frozen=True)
class Lease:
    path: Path
    device: int
    inode: int

    @classmethod
    def decode(cls, value):
        if not isinstance(value, dict) or not isinstance(value.get("path"), str):
            raise ValueError("invalid external fixture lease")
        path = Path(value["path"])
        if not path.is_absolute() or not path.name.startswith("keyspilli-plugin-smoke-") or any(type(value.get(key)) is not int for key in ("device", "inode")):
            raise ValueError("invalid external fixture identity")
        return cls(path, value["device"], value["inode"])

    def present(self, store, doc):
        if not self.path.exists() and not self.path.is_symlink():
            return False
        info = self.path.lstat()
        if self.path.resolve() != self.path or not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != (self.device, self.inode):
            raise ValueError("external fixture identity changed")
        marker = self.path / MARKER
        marker_info = marker.lstat()
        if not stat.S_ISREG(marker_info.st_mode) or marker_info.st_nlink != 1:
            raise ValueError("linked/nonregular fixture marker")
        if json.loads(marker.read_text()) != dict(root=str(store.root), run=doc["id"], device=self.device, inode=self.inode):
            raise ValueError("external fixture ownership changed")
        return True


def register(store, doc, directory, save, protected):
    path = Path(directory).absolute()
    if doc["state"] != "running" or path.resolve() != path or path.is_relative_to(store.root) or any(path == p or path.is_relative_to(p) or p.is_relative_to(path) for p in protected):
        raise ValueError("unsafe external fixture path")
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_dev != store.root.stat().st_dev or list(path.iterdir()) or not path.name.startswith("keyspilli-plugin-smoke-"):
        raise ValueError("external fixture must be a fresh empty same-filesystem directory")
    value = dict(path=str(path), device=info.st_dev, inode=info.st_ino)
    save(path / MARKER, dict(root=str(store.root), run=doc["id"], device=info.st_dev, inode=info.st_ino))
    doc.setdefault("externalScratch", []).append(value)


def paths(store, doc):
    for value in doc.get("externalScratch", []):
        lease = Lease.decode(value)
        if lease.present(store, doc):
            yield lease.path


def usage(store, doc, bytes_used):
    return sum(bytes_used(path) for path in paths(store, doc))


def entries(store, doc):
    return sum(len(dirs) + len(names) for path in paths(store, doc) for _, dirs, names in os.walk(path, followlinks=False))


def collect(store, doc, durable_directory, sync_directory):
    for path in paths(store, doc):
        store.external_users(path)
        destination = store.root / "scratch" / doc["id"] / "external-fixtures" / path.name
        durable_directory(destination.parent)
        if destination.exists():
            raise ValueError("external fixture destination already exists")
        os.rename(path, destination)
        sync_directory(destination.parent)
        sync_directory(path.parent)
    doc.setdefault("collectedExternalScratch", []).extend(doc.pop("externalScratch", []))
