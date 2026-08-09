#!/usr/bin/env bash
# Nightly backup: sqlite dump + artifacts tarball, 14-day retention.
set -euo pipefail

DATA_DIR="${KEYSPILLI_DATA_DIR:-/data}"
BACKUP_DIR="${KEYSPILLI_BACKUP_DIR:-/backups}"
STAMP="$(date +%F-%H%M%S)"

mkdir -p "$BACKUP_DIR"

# Consistent snapshot via Python's sqlite3 online backup API.
python3 - "$DATA_DIR/db.sqlite" "$BACKUP_DIR/db-$STAMP.sqlite" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close()
src.close()
PY

tar -czf "$BACKUP_DIR/artifacts-$STAMP.tar.gz" -C "$DATA_DIR" artifacts 2>/dev/null || true

# Retention: 14 days
find "$BACKUP_DIR" -name 'db-*.sqlite' -mtime +14 -delete
find "$BACKUP_DIR" -name 'artifacts-*.tar.gz' -mtime +14 -delete

echo "backup complete: $BACKUP_DIR ($STAMP)"
