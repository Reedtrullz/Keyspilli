#!/usr/bin/env bash
# Nightly backup: consistent SQLite snapshot plus the artifact and source
# material needed to reproduce the catalogue, with 14-day retention.
set -euo pipefail

DATA_DIR="${KEYSPILLI_DATA_DIR:-/data}"
BACKUP_DIR="${KEYSPILLI_BACKUP_DIR:-/backups}"
STAMP="$(date +%F-%H%M%S)"

mkdir -p "$BACKUP_DIR"
tmp_dir="$(mktemp -d "$BACKUP_DIR/.keyspilli-backup-$STAMP.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

if [[ ! -f "$DATA_DIR/db.sqlite" ]]; then
  echo "backup failed: missing SQLite database at $DATA_DIR/db.sqlite" >&2
  exit 1
fi
if [[ ! -d "$DATA_DIR/artifacts" ]]; then
  echo "backup failed: missing artifact directory at $DATA_DIR/artifacts" >&2
  exit 1
fi

db_tmp="$tmp_dir/db-$STAMP.sqlite"
archive_tmp="$tmp_dir/artifacts-$STAMP.tar.gz"

# Consistent snapshot via Python's sqlite3 online backup API.
python3 - "$DATA_DIR/db.sqlite" "$db_tmp" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
try:
    src.backup(dst)
    result = dst.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise RuntimeError(f"integrity_check returned {result!r}")
finally:
    dst.close()
    src.close()
PY

# Keep the historical artifacts-*.tar.gz name, but include persisted source
# material and provenance descriptors as well. Without these files a restore
# can appear healthy while making future reingest/repair impossible. Optional
# paths are included when present (fresh installs may not have uploads yet).
archive_paths=(artifacts)
source_dir_count=0
for candidate in seed-midi transcribed uploads manifest.json learner-review.json; do
  if [[ -e "$DATA_DIR/$candidate" ]]; then
    archive_paths+=("$candidate")
    if [[ -d "$DATA_DIR/$candidate" ]]; then
      source_dir_count=$((source_dir_count + 1))
    fi
  fi
done
if (( source_dir_count == 0 )); then
  echo "backup failed: no persisted source/provenance material found under $DATA_DIR" >&2
  exit 1
fi

tar -czf "$archive_tmp" -C "$DATA_DIR" "${archive_paths[@]}"
if ! tar -tzf "$archive_tmp" >/dev/null; then
  echo "backup failed: artifact/source archive did not pass tar validation" >&2
  exit 1
fi

# Publish both files only after the complete snapshot and archive have passed
# validation. A killed or full-disk run therefore cannot leave a dated file
# that looks like a usable backup.
mv "$db_tmp" "$BACKUP_DIR/db-$STAMP.sqlite"
mv "$archive_tmp" "$BACKUP_DIR/artifacts-$STAMP.tar.gz"

# Retention: 14 days
find "$BACKUP_DIR" -name 'db-*.sqlite' -mtime +14 -delete
find "$BACKUP_DIR" -name 'artifacts-*.tar.gz' -mtime +14 -delete

echo "backup complete: $BACKUP_DIR ($STAMP)"
