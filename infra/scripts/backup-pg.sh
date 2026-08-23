#!/usr/bin/env bash
# Daily Postgres dump. Peer-auth as postgres — no password in this script.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/vantegra/backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
KEEP_DUMP_DAYS="${KEEP_DUMP_DAYS:-7}"
KEEP_SQLITE_DAYS="${KEEP_SQLITE_DAYS:-14}"
DUMP="$BACKUP_DIR/vantegra_${STAMP}.dump"
TMP="/tmp/vantegra_${STAMP}.dump"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

su - postgres -c "pg_dump -Fc -f '$TMP' vantegra"
mv "$TMP" "$DUMP"
chmod 600 "$DUMP"

find "$BACKUP_DIR" -name 'vantegra_*.dump' -mtime "+$KEEP_DUMP_DAYS" -delete
find "$BACKUP_DIR" -name 'crm_*.db' -mtime "+$KEEP_SQLITE_DAYS" -delete
find "$BACKUP_DIR" -name 'vantegra_*.sql' -mtime "+$KEEP_DUMP_DAYS" -delete

echo "BACKUP_OK $DUMP $(du -h "$DUMP" | awk '{print $1}')"
