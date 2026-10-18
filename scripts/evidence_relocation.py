import argparse
from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import re
import shutil

MAX_BYTES = 32 * 1024 * 1024
RESERVE_BYTES = 6 * 1024 ** 3


@dataclass(frozen=True)
class Record:
    original: str
    stored: str
    digest: str
    size: int
    current: str | None
    current_digest: str | None


def relative_path(root: Path, value: object) -> Path:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("expected a normalized relative POSIX path")
    parts = PurePosixPath(value)
    if parts.is_absolute() or ".." in parts.parts or str(parts) != value:
        raise ValueError(f"unsafe relative path: {value}")
    path = root
    for part in parts.parts:
        path = path / part
        if path.is_symlink():
            raise ValueError(f"symlink is not a reconstruction input: {value}")
    return path


def digest_value(value: object) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[a-f0-9]{64}", value) is None:
        raise ValueError("expected a SHA-256 digest")
    return value


def record(root: Path, value: object) -> Record:
    if not isinstance(value, dict):
        raise ValueError("expected an evidence record")
    original, stored = value.get("originalPath"), value.get("originalStoredPath")
    for path in (original, stored):
        relative_path(root, path)
    if not isinstance(original, str) or not isinstance(stored, str) or not stored.startswith("evidence/"):
        raise ValueError("original bytes must be stored under evidence/")
    size = value.get("originalBytes")
    if not isinstance(size, int) or isinstance(size, bool) or not 0 <= size <= MAX_BYTES:
        raise ValueError("invalid original byte count")
    current = value.get("currentPath")
    current_digest = None
    if current is not None:
        relative_path(root, current)
        if not isinstance(current, str) or not current.startswith("evidence/"):
            raise ValueError("current copies must be stored under evidence/")
        current_digest = digest_value(value.get("currentSha256"))
    return Record(original, stored, digest_value(value.get("originalSha256")), size, current, current_digest)


def checked_bytes(path: Path, digest: str, size: int | None = None) -> bytes:
    if not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise ValueError(f"invalid or oversized evidence file: {path}")
    data = path.read_bytes()
    if (size is not None and len(data) != size) or sha256(data).hexdigest() != digest:
        raise ValueError(f"evidence integrity mismatch: {path}")
    return data


def verify(root: Path) -> list[tuple[Record, bytes]]:
    root = root.resolve(strict=True)
    manifest = relative_path(root, "evidence/relocations.json")
    if manifest.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("oversized relocation manifest")
    value: object = json.loads(manifest.read_bytes())
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("unsupported relocation manifest")
    moved, context = value.get("entries"), value.get("contextOriginals")
    if not isinstance(moved, list) or not isinstance(context, list):
        raise ValueError("expected moved and context record lists")
    records = [record(root, item) for item in [*moved, *context]]
    if not records or len({item.original for item in records}) != len(records):
        raise ValueError("missing or duplicate original paths")
    if sum(item.size for item in records) > MAX_BYTES:
        raise ValueError("reconstruction exceeds the 32 MiB bound")
    result = []
    for item in records:
        data = checked_bytes(relative_path(root, item.stored), item.digest, item.size)
        if item.current is not None and item.current_digest is not None:
            checked_bytes(relative_path(root, item.current), item.current_digest)
        result.append((item, data))
    return result


def reconstruct(root: Path, destination: Path) -> int:
    records = verify(root)
    root = root.resolve(strict=True)
    destination = destination.parent.resolve(strict=True) / destination.name
    relative_path(destination.parent, destination.name)
    if destination.exists():
        raise FileExistsError(f"destination already exists: {destination}")
    if destination.is_relative_to(root) or root.is_relative_to(destination):
        raise ValueError("reconstruction destination must be outside the source checkout")
    if shutil.disk_usage(destination.parent).free - sum(len(data) for _, data in records) < RESERVE_BYTES:
        raise OSError("reconstruction would breach the 6 GiB free-space reserve")
    destination.mkdir(mode=0o700)
    try:
        for item, data in records:
            target = relative_path(destination, item.original)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as stream:
                stream.write(data)
            checked_bytes(target, item.digest, item.size)
    except BaseException:
        shutil.rmtree(destination)
        raise
    return len(records)


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify frozen evidence or reconstruct its original tracked layout.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--reconstruct", type=Path)
    args = parser.parse_args()
    if args.reconstruct is not None:
        print(json.dumps({"reconstructedFiles": reconstruct(args.root, args.reconstruct)}))
    else:
        records = verify(args.root)
        print(json.dumps({"verifiedOriginalFiles": len(records), "originalBytes": sum(len(data) for _, data in records)}))


if __name__ == "__main__":
    main()
