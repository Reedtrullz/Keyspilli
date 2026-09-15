#!/usr/bin/env bash
# Non-destructive backup restore drill into a new, empty destination.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 MANIFEST.json FRESH_DESTINATION" >&2
  exit 2
fi

manifest="$1"
destination="$2"
[[ -f "$manifest" ]] || { echo "restore drill: manifest not found" >&2; exit 1; }
[[ ! -e "$destination" ]] || { echo "restore drill: destination must not already exist" >&2; exit 1; }
mkdir -p "$destination"

python3 - "$manifest" "$destination" <<'PY'
import hashlib
import json
import re
import shutil
import sqlite3
import sys
import tarfile
from pathlib import Path

manifest_path = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
root = manifest_path.parent
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

stamp = manifest.get("stamp")
db_name = manifest.get("dbFile")
archive_name = manifest.get("archiveFile")
if (
    manifest.get("complete") is not True
    or not isinstance(stamp, str)
    or not re.fullmatch(r"\d{4}-\d{2}-\d{2}-\d{6}", stamp)
    or db_name != f"db-{stamp}.sqlite"
    or archive_name != f"artifacts-{stamp}.tar.gz"
    or Path(db_name).name != db_name
    or Path(archive_name).name != archive_name
):
    raise SystemExit("restore drill: invalid committed pair manifest")

db_source = root / db_name
archive_source = root / archive_name
if not db_source.is_file() or not archive_source.is_file():
    raise SystemExit("restore drill: committed pair is incomplete")

def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

if sha256(db_source) != manifest.get("dbSha256") or sha256(archive_source) != manifest.get("archiveSha256"):
    raise SystemExit("restore drill: source checksum mismatch")

db_copy = destination / db_name
archive_copy = destination / archive_name
shutil.copyfile(db_source, db_copy)
shutil.copyfile(archive_source, archive_copy)
if sha256(db_copy) != manifest["dbSha256"] or sha256(archive_copy) != manifest["archiveSha256"]:
    raise SystemExit("restore drill: copied checksum mismatch")

with sqlite3.connect(f"file:{db_copy}?mode=ro", uri=True) as database:
    if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("restore drill: SQLite integrity check failed")

extract_root = destination
with tarfile.open(archive_copy, "r:gz") as archive:
    members = archive.getmembers()
    for member in members:
        member_path = Path(member.name)
        if member_path.is_absolute() or ".." in member_path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit(f"restore drill: unsafe archive member {member.name!r}")
    archive.extractall(extract_root)

print(json.dumps({
    "status": "passed",
    "manifest": str(manifest_path),
    "destination": str(destination),
    "db": db_name,
    "archive": archive_name,
    "members": len(members),
}, sort_keys=True))
PY
