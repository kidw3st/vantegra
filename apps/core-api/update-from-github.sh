#!/bin/bash
# Safe CRM update from GitHub.
# Preserves existing SQLite DB (crm.db). Schema migrations run on app start.
# Does NOT run seed.js. Does NOT overwrite crm.db.

set -euo pipefail

# Real app cwd used by PM2 on this server
APP_DIR="${APP_DIR:-/var/www/crm-app/server}"
REPO_URL="${REPO_URL:-https://github.com/AndrewF250/CRM.git}"
BRANCH="${BRANCH:-main}"
BACKUP_DIR="${BACKUP_DIR:-/var/www/crm-app/backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"

echo "=== CRM update from GitHub ($BRANCH) ==="
echo "App dir: $APP_DIR"

mkdir -p "$BACKUP_DIR" "$APP_DIR" "$APP_DIR/uploads"

DB_PATH=""
for p in "$APP_DIR/crm.db" /var/www/crm-app/crm.db /var/www/crm-app/server/crm.db; do
  if [ -f "$p" ]; then DB_PATH="$p"; break; fi
done
if [ -z "$DB_PATH" ]; then
  DB_PATH="$(find /var/www -name 'crm.db' -type f 2>/dev/null | head -1 || true)"
fi

# Stop app before backing up so WAL is flushed into main DB
if command -v pm2 >/dev/null 2>&1; then
  echo "Stopping PM2 crm (flush WAL)..."
  pm2 stop crm 2>/dev/null || true
  sleep 1
fi

if [ -n "${DB_PATH:-}" ] && [ -f "$DB_PATH" ]; then
  echo "Found DB: $DB_PATH"
  # Checkpoint WAL into main file if possible
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" "PRAGMA wal_checkpoint(FULL);" 2>/dev/null || true
  fi
  cp -a "$DB_PATH" "$BACKUP_DIR/crm_${STAMP}.db"
  [ -f "${DB_PATH}-wal" ] && cp -a "${DB_PATH}-wal" "$BACKUP_DIR/crm_${STAMP}.db-wal" || true
  [ -f "${DB_PATH}-shm" ] && cp -a "${DB_PATH}-shm" "$BACKUP_DIR/crm_${STAMP}.db-shm" || true
  echo "Backup: $BACKUP_DIR/crm_${STAMP}.db"
else
  echo "WARNING: crm.db not found — will be created on first start."
fi

WORKDIR="/tmp/crm-update-$STAMP"
rm -rf "$WORKDIR"
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$WORKDIR"

SRC="$WORKDIR/server"
if [ ! -d "$SRC" ]; then SRC="$WORKDIR"; fi

echo "Syncing code from $SRC -> $APP_DIR (preserving DB & uploads)..."
rsync -a \
  --exclude 'crm.db' \
  --exclude 'crm.db-*' \
  --exclude '*.db' \
  --exclude '*.db-wal' \
  --exclude '*.db-shm' \
  --exclude 'uploads/' \
  --exclude 'backups/' \
  --exclude 'node_modules/' \
  --exclude '.git/' \
  "$SRC/" "$APP_DIR/"

# Keep canonical DB next to server.js
if [ -n "${DB_PATH:-}" ] && [ -f "$DB_PATH" ] && [ "$DB_PATH" != "$APP_DIR/crm.db" ]; then
  if [ ! -f "$APP_DIR/crm.db" ]; then
    echo "Copying DB to $APP_DIR/crm.db"
    cp -a "$DB_PATH" "$APP_DIR/crm.db"
  fi
fi

cd "$APP_DIR"
echo "npm install..."
npm install --omit=dev

# Ensure PM2 points at this directory
if command -v pm2 >/dev/null 2>&1; then
  echo "Starting/restarting PM2 app 'crm' in $APP_DIR ..."
  if pm2 describe crm >/dev/null 2>&1; then
    pm2 delete crm 2>/dev/null || true
  fi
  pm2 start "$APP_DIR/server.js" --name crm --cwd "$APP_DIR"
  pm2 save || true
else
  echo "PM2 not found — start manually: cd $APP_DIR && node server.js"
fi

rm -rf "$WORKDIR"
echo "=== Update complete ==="
echo "Old rows kept. New columns/tables applied by database.js on start."
if [ -n "${DB_PATH:-}" ]; then
  echo "Backup at: $BACKUP_DIR/crm_${STAMP}.db"
fi
