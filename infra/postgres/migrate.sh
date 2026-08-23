#!/usr/bin/env bash
# SQLite → Postgres cutover. Short maintenance window on the VPS.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/crm-app}"
DB="$APP_DIR/crm.db"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-/opt/vantegra/backups}"
SCHEMA="${PG_SCHEMA:-/opt/vantegra/infra/postgres/schema.sql}"
ENV_FILE="${ENV_FILE:-/opt/vantegra/infra/.env}"

if [[ ! -f "$DB" ]]; then
  echo "SQLite not found: $DB" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a
if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo "POSTGRES_PASSWORD missing in $ENV_FILE" >&2
  exit 1
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://vantegra:${POSTGRES_PASSWORD}@127.0.0.1:5432/vantegra}"
export SQLITE_PATH="$DB"
export PG_SCHEMA="$SCHEMA"

mkdir -p "$BACKUP_DIR"
systemctl stop crm >/dev/null 2>&1 || pm2 stop crm worker >/dev/null 2>&1 || pm2 stop crm >/dev/null 2>&1 || true

if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" "PRAGMA wal_checkpoint(FULL);"
fi
cp -a "$DB" "$BACKUP_DIR/crm_${STAMP}.db"
echo "BACKUP_OK $BACKUP_DIR/crm_${STAMP}.db"

node "$APP_DIR/scripts/migrate-sqlite-to-pg.js"

systemctl start crm >/dev/null 2>&1 || true
echo "Set DATABASE_URL in /var/www/crm-app/.env, then: systemctl restart crm"
echo "CUTOVER_SQL_OK"
